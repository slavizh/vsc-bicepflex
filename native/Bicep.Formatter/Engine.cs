using System.Text.Json;
using System.Text.RegularExpressions;
using Bicep.Core;
using Bicep.Core.Diagnostics;
using Bicep.Core.Extensions;
using Bicep.Core.Navigation;
using Bicep.Core.Parsing;
using Bicep.Core.PrettyPrintV2;
using Bicep.Core.Semantics;
using Bicep.Core.SourceGraph;
using Bicep.Core.Syntax;
using Bicep.Core.Text;
using Bicep.IO.Abstraction;

sealed partial class Engine(BicepCompiler compiler, IOUri uri, FormatOptions options, bool parameters)
{
    private BicepSourceFile Parse(string source, bool originalInput = false)
    {
        var file = (BicepSourceFile)compiler.SourceFileFactory.CreateSourceFile(
            uri, source, parameters ? typeof(BicepParamFile) : typeof(BicepFile));
        var errors = file.LexingErrorLookup.Concat(file.ParsingErrorLookup).ToArray();
        if (errors.Length > 0)
        {
            var first = errors[0];
            var position = Math.Min(first.Span.Position, source.Length);
            var line = source.AsSpan(0, position).Count('\n') + 1;
            var column = position - (position > 0 ? source.LastIndexOf('\n', position - 1) : -1);
            throw originalInput
                ? new FormatterException("BICEP_SYNTAX_ERROR", $"{first.Code} at line {line}, column {column}: {first.Message}", line, column, first.Code)
                : new FormatterException("BICEP_SAFETY_CHECK_FAILED", $"Formatting produced invalid Bicep syntax ({first.Code}). No output was applied; please report this input.");
        }
        return file;
    }

    private SemanticModel Bind(BicepSourceFile file)
    {
        var workspace = new ActiveSourceFileSet();
        workspace.UpsertSourceFiles([file]);
        return compiler.CreateCompilationWithoutRestore(uri, workspace).GetEntrypointSemanticModel();
    }

    public string Format(string source)
    {
        options.Validate();
        var original = Parse(source, originalInput: true);
        var originalTree = new SyntaxTree(original.ProgramSyntax);
        var fingerprint = originalTree.Fingerprint(original.ProgramSyntax);
        var model = Bind(original);
        var diagnostics = DiagnosticCounts(model);
        var ignored = CaptureProtected(source, originalTree);

        source = NormalizeNames(source, originalTree, ignored.Keys.ToHashSet());
        var parsed = Parse(source);
        var tree = new SyntaxTree(parsed.ProgramSyntax);
        model = Bind(parsed);
        var layout = new Layout(tree, new Ordering(model, tree, options), options, ignored.Keys.ToHashSet());
        var rewritten = layout.Rewrite(parsed.ProgramSyntax);
        var formatted = PrettyPrinterV2.PrintValid(rewritten, options.Printer);

        formatted = Finish(formatted, ignored);
        if (options.BicepLogicalCallLayout == "inline")
        {
            formatted = InlineLogicalCalls(formatted, ignored.Keys.ToHashSet());
        }
        formatted = IndentNestedTernaries(formatted, ignored.Keys.ToHashSet());
        formatted = ApplyHeaderPolicies(formatted, ignored.Keys.ToHashSet());
        if (options.BicepLoopLayout != "expanded")
        {
            formatted = CompactObjectLoops(formatted, ignored.Keys.ToHashSet());
        }
        formatted = NormalizeInlineSpacing(formatted, ignored.Keys.ToHashSet());
        var final = Parse(formatted);
        var finalTree = new SyntaxTree(final.ProgramSyntax);
        if (fingerprint != finalTree.Fingerprint(final.ProgramSyntax))
        {
            throw new FormatterException("BICEP_SAFETY_CHECK_FAILED", "Formatting changed the syntax structure. No output was applied; please report this input.");
        }
        if (!Comments(originalTree).SequenceEqual(Comments(finalTree)))
        {
            throw new FormatterException("BICEP_SAFETY_CHECK_FAILED", "Formatting changed comment or directive text. No output was applied; please report this input.");
        }
        var introduced = DiagnosticCounts(Bind(final)).Where(kv => kv.Value > diagnostics.GetValueOrDefault(kv.Key)).Select(kv => kv.Key).ToArray();
        if (introduced.Length > 0)
        {
            throw new FormatterException("BICEP_SAFETY_CHECK_FAILED", $"Formatting would introduce Bicep diagnostics: {string.Join("; ", introduced)}");
        }
        return formatted;
    }

    private static Dictionary<string, int> DiagnosticCounts(SemanticModel model) =>
        model.GetAllDiagnostics().GroupBy(d => $"{d.Level}:{d.Code}:{d.Message}")
            .ToDictionary(group => group.Key, group => group.Count());

    private static IEnumerable<string> Comments(SyntaxTree tree) => tree.Tokens
        .SelectMany(t => t.LeadingTrivia.Concat(t.TrailingTrivia))
        .Where(t => t.Type != SyntaxTriviaType.Whitespace)
        .Select(t => t.Text.TrimStart().StartsWith('#')
            ? Regex.Replace(t.Text.Trim(), @"\s+", " ")
            : t.Text.ReplaceLineEndings("\n"))
        .Order(StringComparer.Ordinal);

    private string NormalizeInlineSpacing(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var tokens = tree.Tokens.OrderBy(token => token.Span.Position).ToArray();
        var changes = new List<TextEdit>();
        for (var index = 1; index < tokens.Length; index++)
        {
            var previous = tokens[index - 1];
            var current = tokens[index];
            var start = previous.Span.GetEndPosition();
            var length = current.Span.Position - start;
            if (length < 2 || previous.Type == TokenType.NewLine ||
                start > 0 && source[start - 1] == '\n' ||
                protectedSpans.Any(span => span.Position <= start && span.GetEndPosition() >= start + length) ||
                source.AsSpan(start, length).IndexOfAnyExcept(' ', '\t') >= 0)
            {
                continue;
            }
            changes.Add(new(start, length, " "));
        }
        return TextEdit.Apply(source, changes);
    }

    private static Dictionary<string, string> CaptureProtected(string source, SyntaxTree tree)
    {
        var captured = new Dictionary<string, string>();
        foreach (var node in tree.Nodes.Where(n => n is ITopLevelDeclarationSyntax))
        {
            var start = node.Span.Position;
            var lineStart = source.LastIndexOf('\n', Math.Max(0, start - 1));
            var previousLineEnd = lineStart;
            var previousLineStart = previousLineEnd > 0 ? source.LastIndexOf('\n', previousLineEnd - 1) + 1 : 0;
            var previousLine = previousLineEnd >= 0 ? source[previousLineStart..previousLineEnd].Trim() : "";
            var hasDirective = tree.Within(node).Any(t => t.LeadingTrivia.Concat(t.TrailingTrivia).Any(trivia => trivia.Text.TrimStart().StartsWith('#')));
            if (previousLine == "// prettier-ignore" || hasDirective)
            {
                captured.Add(tree.Id(node), SyntaxTree.Slice(source, node));
            }
        }
        return captured;
    }

    private string NormalizeNames(string source, SyntaxTree tree, HashSet<string> ignored)
    {
        var changes = new List<TextEdit>();
        bool Protected(SyntaxBase node)
        {
            while (true)
            {
                if (node is ITopLevelDeclarationSyntax && ignored.Contains(tree.Id(node))) return true;
                if (!tree.Parents.TryGetValue(node, out var parent)) return false;
                node = parent;
            }
        }
        foreach (var node in tree.Nodes)
        {
            if (Protected(node)) continue;
            var key = node switch
            {
                ObjectPropertySyntax { Key: StringSyntax text } => text,
                ObjectTypePropertySyntax { Key: StringSyntax text } => text,
                _ => null,
            };
            if (options.BicepQuoteProperties == "as-needed" && key?.TryGetLiteralValue() is string name &&
                Identifier().IsMatch(name) && !SyntaxTree.HasComments(key))
            {
                changes.Add(new(key.Span.Position, key.Span.Length, name));
            }
            if (options.BicepLambdaParentheses == "avoid" && node is LambdaSyntax { VariableSection: VariableBlockSyntax block } &&
                block.Arguments.Length == 1 && !SyntaxTree.HasComments(block))
            {
                changes.Add(new(block.Span.Position, block.Span.Length, block.Arguments[0].Name.IdentifierName));
            }
            if (options.BicepLambdaParentheses == "always" && node is LambdaSyntax { VariableSection: LocalVariableSyntax local })
            {
                changes.Add(new(local.Span.Position, local.Span.Length, $"({SyntaxTree.Slice(source, local)})"));
            }
        }
        return TextEdit.Apply(source, changes);
    }

    private string Finish(string source, Dictionary<string, string> ignored)
    {
        var parsed = Parse(source);
        var tree = new SyntaxTree(parsed.ProgramSyntax);
        var changes = new List<TextEdit>();
        var protectedSpans = new List<TextSpan>();
        foreach (var node in tree.Nodes.Where(n => n is ITopLevelDeclarationSyntax))
        {
            if (ignored.TryGetValue(tree.Id(node), out var raw))
            {
                if (protectedSpans.Any(s => s.Position <= node.Span.Position && s.GetEndPosition() >= node.Span.GetEndPosition())) continue;
                protectedSpans.Add(node.Span);
                changes.Add(new(node.Span.Position, node.Span.Length, raw));
            }
        }
        bool IsProtected(SyntaxBase node) => protectedSpans.Any(s =>
            s.Position <= node.Span.Position && s.GetEndPosition() >= node.Span.GetEndPosition());

        foreach (var decorator in tree.Nodes.OfType<DecoratorSyntax>())
        {
            if (IsProtected(decorator)) continue;
            if (Layout.DecoratorName(decorator) == "description" && !SyntaxTree.HasComments(decorator))
            {
                var rendered = PrettyPrinterV2.PrintValid(decorator, options.Printer with { Width = int.MaxValue, InsertFinalNewline = false }).TrimEnd('\r', '\n');
                if (options.BicepDescriptionWidth == "wrap")
                {
                    var lineStart = source.LastIndexOf('\n', Math.Max(0, decorator.Span.Position - 1)) + 1;
                    var indent = source[lineStart..decorator.Span.Position];
                    var arguments = decorator.Expression switch
                    {
                        FunctionCallSyntax call => call.Arguments,
                        InstanceFunctionCallSyntax call => call.Arguments,
                        _ => [],
                    };
                    if (arguments.Length != 1 || !indent.All(c => c is ' ' or '\t') ||
                        !rendered.Contains('\n') && (indent + rendered).Replace("\t", new string(' ', options.TabWidth)).Length <= options.PrintWidth)
                    {
                        continue;
                    }
                    var argument = arguments[0].Expression;
                    var argumentText = SyntaxTree.Slice(source, argument);
                    var callPrefix = source[decorator.Span.Position..arguments[0].Span.Position].TrimEnd(' ', '\t', '\r', '\n');
                    var padding = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
                    rendered = callPrefix + "\n" + indent + padding + argumentText + "\n" + indent + ")";
                }
                changes.Add(new(decorator.Span.Position, decorator.Span.Length, rendered));
            }
        }
        if (options.BicepDeclarationSpacing != "preserve" || options.BicepImportSpacing is "compact" or "separate" ||
            options.BicepParameterSpacing == "description")
        {
            foreach (var container in tree.Nodes.Where(n => n is ProgramSyntax or ObjectSyntax))
            {
                if (IsProtected(container)) continue;
                var nodes = tree.Children[container].Where(n => n is not Token).ToList();
                for (var index = 1; index < nodes.Count; index++)
                {
                    var current = nodes[index];
                    var previous = nodes[index - 1];
                    if (current is not ITopLevelDeclarationSyntax && previous is not ITopLevelDeclarationSyntax) continue;
                    var start = previous.Span.GetEndPosition();
                    var length = current.Span.Position - start;
                    var gap = source.Substring(start, length);
                    var consecutiveImports = previous is CompileTimeImportDeclarationSyntax &&
                        current is CompileTimeImportDeclarationSyntax &&
                        string.IsNullOrWhiteSpace(gap[(gap.IndexOf('\n') + 1)..]);
                    var spacing = consecutiveImports && options.BicepImportSpacing != "inherit"
                        ? options.BicepImportSpacing : options.BicepDeclarationSpacing;
                    if (options.BicepParameterSpacing == "description" &&
                        previous is ParameterDeclarationSyntax previousParameter &&
                        current is ParameterDeclarationSyntax currentParameter &&
                        string.IsNullOrWhiteSpace(gap))
                    {
                        spacing = previousParameter.Decorators.Any(d => Layout.DecoratorName(d) == "description") ||
                            currentParameter.Decorators.Any(d => Layout.DecoratorName(d) == "description")
                            ? "separate" : "compact";
                    }
                    if (spacing == "preserve") continue;
                    var normalized = DeclarationGap().Replace(gap,
                        match => match.Groups[1].Value + (spacing == "separate" ? "\n" : ""), 1);
                    if (normalized != gap) changes.Add(new(start, length, normalized));
                }
            }
        }
        return TextEdit.Apply(source, changes).TrimEnd('\r', '\n') + "\n";
    }

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex Identifier();

    [GeneratedRegex(@"^([^\n]*\n)(?:[ \t]*\n)*")]
    private static partial Regex DeclarationGap();

    private static TextSpan[] ProtectedSpans(SyntaxTree tree, HashSet<string> ignored) => tree.Nodes
        .Where(n => n is ITopLevelDeclarationSyntax && ignored.Contains(tree.Id(n)))
        .Select(n => n.Span)
        .Concat(tree.Tokens.Where(t => t.Type != TokenType.NewLine && t.Text.Contains('\n')).Select(t => t.Span))
        .Concat(tree.Tokens.SelectMany(t => t.LeadingTrivia.Concat(t.TrailingTrivia))
            .Where(t => t.Type != SyntaxTriviaType.Whitespace && t.Text.Contains('\n')).Select(t => t.Span))
        .ToArray();

    private string InlineLogicalCalls(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var changes = new List<TextEdit>();
        foreach (var condition in tree.Nodes.OfType<IfConditionSyntax>())
        {
            var expression = condition.ConditionExpression;
            var logical = tree.Nodes.OfType<BinaryOperationSyntax>().Where(node =>
                node.Span.Position >= expression.Span.Position &&
                node.Span.GetEndPosition() <= expression.Span.GetEndPosition() &&
                node.OperatorToken.Type is TokenType.LogicalOr or TokenType.LogicalAnd).ToArray();
            if (logical.Length == 0) continue;
            foreach (var call in tree.Nodes.Where(node =>
                node is FunctionCallSyntax or InstanceFunctionCallSyntax &&
                logical.Any(binary => binary.Span.Position <= node.Span.Position &&
                    binary.Span.GetEndPosition() >= node.Span.GetEndPosition()) &&
                source.AsSpan(node.Span.Position, node.Span.Length).Contains('\n')))
            {
                if (changes.Any(edit => edit.Start <= call.Span.Position &&
                    edit.Start + edit.Length >= call.Span.GetEndPosition()) ||
                    SyntaxTree.HasComments(call) ||
                    protectedSpans.Any(span => span.Position < call.Span.GetEndPosition() &&
                        span.GetEndPosition() > call.Span.Position)) continue;
                var inline = PrettyPrinterV2.PrintValid(call, options.Printer with
                {
                    Width = int.MaxValue,
                    InsertFinalNewline = false,
                }).TrimEnd('\r', '\n');
                if (!inline.Contains('\n'))
                    changes.Add(new(call.Span.Position, call.Span.Length, inline));
            }
        }
        return TextEdit.Apply(source, changes);
    }

    private string IndentNestedTernaries(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        if (indent.Length == 0) return source;
        var dedents = new Dictionary<int, int>();
        foreach (var ternary in tree.Nodes.OfType<TernaryOperationSyntax>())
        {
            var parent = tree.Parents.GetValueOrDefault(ternary);
            while (parent is not null && parent is not TernaryOperationSyntax)
                parent = tree.Parents.GetValueOrDefault(parent);
            if (parent is null ||
                source.LastIndexOf('\n', ternary.ConditionExpression.Span.Position) ==
                source.LastIndexOf('\n', ternary.Question.Span.Position)) continue;
            for (var newline = source.IndexOf('\n', ternary.ConditionExpression.Span.GetEndPosition());
                newline >= 0 && newline + 1 < ternary.Span.GetEndPosition();
                newline = source.IndexOf('\n', newline + 1))
            {
                var start = newline + 1;
                if (protectedSpans.Any(span => span.Position < start && span.GetEndPosition() > start)) continue;
                dedents[start] = dedents.GetValueOrDefault(start) + 1;
            }
        }
        var changes = new List<TextEdit>();
        foreach (var (start, levels) in dedents)
        {
            var length = 0;
            for (var level = 0; level < levels && source.AsSpan(start + length).StartsWith(indent); level++)
                length += indent.Length;
            if (length > 0) changes.Add(new(start, length, ""));
        }
        return TextEdit.Apply(source, changes);
    }

    private string ApplyHeaderPolicies(string source, HashSet<string> ignored)
    {
        if (options.BicepUnionLayout == "auto" && options.BicepConditionalHeader == "inline") return source;
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        bool IsProtected(SyntaxBase node) => protectedSpans.Any(s => s.Position <= node.Span.Position && s.GetEndPosition() >= node.Span.GetEndPosition());
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        string LineIndent(int position)
        {
            var start = source.LastIndexOf('\n', Math.Max(0, position - 1)) + 1;
            var end = start;
            while (end < source.Length && source[end] is ' ' or '\t') end++;
            return source[start..end];
        }
        var changes = new List<TextEdit>();
        if (options.BicepUnionLayout == "multiline")
        {
            foreach (var union in tree.Nodes.OfType<UnionTypeSyntax>())
            {
                if (IsProtected(union)) continue;
                var members = union.Children.OfType<UnionTypeMemberSyntax>().ToArray();
                if (members.Length < 2) continue;
                var previous = tree.Tokens.LastOrDefault(t => t.Type != TokenType.NewLine && t.Span.GetEndPosition() <= union.Span.Position);
                if (previous is null) continue;
                var padding = LineIndent(previous.Span.Position) + indent;
                var start = previous.Span.GetEndPosition();
                foreach (var member in members)
                {
                    var gap = source[start..member.Value.Span.Position];
                    if (gap.All(c => char.IsWhiteSpace(c) || c == '|'))
                    {
                        changes.Add(new(start, gap.Length, "\n" + padding + "| "));
                    }
                    start = member.Value.Span.GetEndPosition();
                }
            }
        }
        source = TextEdit.Apply(source, changes);
        if (options.BicepConditionalHeader == "inline") return source;
        // Reparse after union edits so conditional offsets remain authoritative.
        tree = new SyntaxTree(Parse(source).ProgramSyntax);
        protectedSpans = ProtectedSpans(tree, ignored);
        changes = [];
        var indents = new Dictionary<int, int>();
        foreach (var condition in tree.Nodes.OfType<IfConditionSyntax>())
        {
            if (IsProtected(condition) || !tree.Parents.TryGetValue(condition, out var parent) ||
                parent is not ResourceDeclarationSyntax and not ModuleDeclarationSyntax ||
                condition.Body is not ObjectSyntax body) continue;
            var keyword = condition.Keyword.Span.Position;
            var start = keyword;
            while (start > 0 && source[start - 1] is ' ' or '\t') start--;
            if (start == 0 || source[start - 1] != '=') continue;
            var lineStart = source.LastIndexOf('\n', keyword) + 1;
            var header = source[lineStart..body.OpenBrace.Span.GetEndPosition()];
            if (header.Contains('\n')) continue;
            var width = header.Replace("\t", new string(' ', options.TabWidth)).Length +
                indents.GetValueOrDefault(lineStart) * options.TabWidth;
            if (options.BicepConditionalHeader == "auto" && width <= options.PrintWidth) continue;
            changes.Add(new(start, keyword - start, "\n" + LineIndent(keyword) +
                string.Concat(Enumerable.Repeat(indent, indents.GetValueOrDefault(lineStart) + 1))));
            for (var newline = source.IndexOf('\n', body.OpenBrace.Span.GetEndPosition());
                newline >= 0 && newline < body.CloseBrace.Span.Position;
                newline = source.IndexOf('\n', newline + 1))
            {
                var position = newline + 1;
                if (protectedSpans.Any(s => s.Position < position && s.GetEndPosition() > position)) continue;
                indents[position] = indents.GetValueOrDefault(position) + 1;
            }
        }
        foreach (var (position, levels) in indents)
        {
            if (indent.Length > 0) changes.Add(new(position, 0, string.Concat(Enumerable.Repeat(indent, levels))));
        }
        return TextEdit.Apply(source, changes);
    }

    private string CompactObjectLoops(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        var changes = new List<TextEdit>();
        var dedents = new Dictionary<int, int>();
        foreach (var loop in tree.Nodes.OfType<ForSyntax>())
        {
            if (protectedSpans.Any(s => s.Position <= loop.Span.Position && s.GetEndPosition() >= loop.Span.GetEndPosition())) continue;
            var body = loop.Body switch
            {
                ObjectSyntax value => value,
                IfConditionSyntax { Body: ObjectSyntax value } => value,
                _ => null,
            };
            if (body is null) continue;
            var openEnd = loop.OpenSquare.Span.GetEndPosition();
            var openGap = source[openEnd..loop.ForKeyword.Span.Position];
            var closeStart = body.CloseBrace.Span.GetEndPosition();
            var closeGap = source[closeStart..loop.CloseSquare.Span.Position];
            if (!openGap.Contains('\n') || !string.IsNullOrWhiteSpace(openGap) ||
                !string.IsNullOrWhiteSpace(closeGap)) continue;
            var lineStart = source.LastIndexOf('\n', loop.OpenSquare.Span.Position) + 1;
            var prefix = source[lineStart..openEnd];
            var header = source[loop.ForKeyword.Span.Position..body.OpenBrace.Span.GetEndPosition()];
            if (header.Contains('\n')) continue;
            var width = (prefix + header).Replace("\t", new string(' ', options.TabWidth)).Length -
                dedents.GetValueOrDefault(lineStart) * options.TabWidth;
            if (width > options.PrintWidth) continue;

            changes.Add(new(openEnd, openGap.Length, ""));
            changes.Add(new(closeStart, closeGap.Length, ""));
            // Remove only structural indentation. Multiline literal/comment contents
            // and ignored declarations must remain byte-for-byte intact.
            for (var newline = source.IndexOf('\n', body.OpenBrace.Span.GetEndPosition());
                newline >= 0 && newline < body.CloseBrace.Span.Position;
                newline = source.IndexOf('\n', newline + 1))
            {
                var start = newline + 1;
                if (protectedSpans.Any(s => s.Position < start && s.GetEndPosition() > start)) continue;
                dedents[start] = dedents.GetValueOrDefault(start) + 1;
            }
        }
        foreach (var (start, levels) in dedents)
        {
            if (changes.Any(edit => edit.Start <= start && edit.Start + edit.Length > start)) continue;
            var length = 0;
            for (var level = 0; level < levels && indent.Length > 0 &&
                source.AsSpan(start + length).StartsWith(indent); level++)
            {
                length += indent.Length;
            }
            if (length > 0) changes.Add(new(start, length, ""));
        }
        return TextEdit.Apply(source, changes);
    }
}
