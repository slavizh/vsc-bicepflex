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
    private readonly Dictionary<string, string> authorLayout = [];
    private readonly Dictionary<string, bool> authorConditionalNextLine = [];
    private readonly Dictionary<string, bool> authorCompactLoops = [];
    private readonly Dictionary<string, bool[]> authorUnionBreaks = [];
    private readonly Dictionary<string, bool[]> authorCallBreaks = [];

    private string? Original(SyntaxTree tree, SyntaxBase node) =>
        authorLayout.GetValueOrDefault(tree.Path(node));

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
        foreach (var node in originalTree.Nodes.Where(node => node is
            ObjectSyntax or ObjectTypeSyntax or ArraySyntax or UnionTypeSyntax or
            FunctionCallSyntax or InstanceFunctionCallSyntax or DecoratorSyntax or
            IfConditionSyntax or ForSyntax))
        {
            authorLayout[originalTree.Path(node)] = SyntaxTree.Slice(source, node);
        }
        foreach (var condition in originalTree.Nodes.OfType<IfConditionSyntax>())
        {
            if (!originalTree.Parents.TryGetValue(condition, out var parent) ||
                parent is not ResourceDeclarationSyntax and not ModuleDeclarationSyntax) continue;
            var equals = source.LastIndexOf('=', condition.Keyword.Span.Position);
            if (equals >= 0)
                authorConditionalNextLine[originalTree.Path(condition)] =
                    source.AsSpan(equals, condition.Keyword.Span.Position - equals).Contains('\n');
        }
        foreach (var loop in originalTree.Nodes.OfType<ForSyntax>())
        {
            authorCompactLoops[originalTree.Path(loop)] =
                !source.AsSpan(loop.OpenSquare.Span.GetEndPosition(),
                    loop.ForKeyword.Span.Position - loop.OpenSquare.Span.GetEndPosition()).Contains('\n');
        }
        foreach (var union in originalTree.Nodes.OfType<UnionTypeSyntax>())
        {
            var members = union.Children.OfType<UnionTypeMemberSyntax>().ToArray();
            var previous = originalTree.Tokens.LastOrDefault(t => t.Type != TokenType.NewLine &&
                t.Span.GetEndPosition() <= union.Span.Position);
            var start = previous?.Span.GetEndPosition() ?? union.Span.Position;
            authorUnionBreaks[originalTree.Path(union)] = members.Select(member =>
            {
                var broken = source.AsSpan(start, member.Value.Span.Position - start).Contains('\n');
                start = member.Value.Span.GetEndPosition();
                return broken;
            }).ToArray();
        }
        foreach (var call in originalTree.Nodes.Where(node => node is FunctionCallSyntax or InstanceFunctionCallSyntax))
        {
            if (CallParts(originalTree, call) is not { } parts) continue;
            var start = parts.Open.Span.GetEndPosition();
            var breaks = parts.Arguments
                .Select(argument =>
                {
                    var broken = source.AsSpan(start, argument.Span.Position - start).Contains('\n');
                    start = argument.Span.GetEndPosition();
                    return broken;
                })
                .ToArray();
            authorCallBreaks[originalTree.Path(call)] =
                [.. breaks, source.AsSpan(start, parts.Close.Span.Position - start).Contains('\n')];
        }
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
        if (options.BicepObjectLayout == "preserve" || options.BicepArrayLayout == "preserve" ||
            options.BicepUnionLayout == "preserve" || options.BicepIfConditionLayout == "preserve" ||
            options.BicepLogicalCallLayout == "preserve")
        {
            var wide = Finish(PrettyPrinterV2.PrintValid(rewritten, options.Printer with { Width = int.MaxValue }), ignored);
            formatted = PreserveCompactLayouts(formatted, wide, ignored.Keys.ToHashSet());
        }
        if (options.BicepIfConditionLayout == "preserve" || options.BicepLogicalCallLayout == "preserve")
            formatted = PreserveCallBreaks(formatted, ignored.Keys.ToHashSet());
        if (options.BicepIfConditionLayout == "inline" || options.BicepLogicalCallLayout == "inline")
        {
            formatted = InlineConfiguredCalls(formatted, ignored.Keys.ToHashSet());
        }
        formatted = NormalizeTernaryIndentation(formatted, ignored.Keys.ToHashSet());
        formatted = ApplyHeaderPolicies(formatted, ignored.Keys.ToHashSet());
        formatted = CompactTernaryObjectProperties(formatted, ignored.Keys.ToHashSet());
        formatted = CompactObjectArgumentCalls(formatted, ignored.Keys.ToHashSet());
        if (options.BicepLoopLayout != "expanded")
        {
            formatted = CompactObjectLoops(formatted, ignored.Keys.ToHashSet());
            formatted = CompactExpressionLoops(formatted, ignored.Keys.ToHashSet());
        }
        formatted = NormalizeLambdaIndentation(formatted, ignored.Keys.ToHashSet());
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

    private string PreserveCompactLayouts(string source, string wide, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var wideTree = new SyntaxTree(Parse(wide).ProgramSyntax);
        var wideNodes = wideTree.Nodes
            .Where(node => node is ObjectSyntax or ObjectTypeSyntax or ArraySyntax or UnionTypeSyntax or
                FunctionCallSyntax or InstanceFunctionCallSyntax)
            .ToDictionary(wideTree.Path, node => node);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var candidates = new List<TextEdit>();
        foreach (var node in tree.Nodes)
        {
            var eligible = node switch
            {
                ObjectSyntax or ObjectTypeSyntax => options.BicepObjectLayout == "preserve",
                ArraySyntax => options.BicepArrayLayout == "preserve",
                UnionTypeSyntax => options.BicepUnionLayout == "preserve",
                FunctionCallSyntax or InstanceFunctionCallSyntax =>
                    CallLayout(tree, node) == "preserve",
                _ => false,
            };
            if (!eligible || Original(tree, node) is not string original || original.Contains('\n') ||
                !SyntaxTree.Slice(source, node).Contains('\n') || SyntaxTree.HasComments(node) ||
                protectedSpans.Any(span => span.Position < node.Span.GetEndPosition() &&
                    span.GetEndPosition() > node.Span.Position) ||
                !wideNodes.TryGetValue(tree.Path(node), out var wideNode)) continue;
            var compact = SyntaxTree.Slice(wide, wideNode);
            if (!compact.Contains('\n'))
                candidates.Add(new(node.Span.Position, node.Span.Length, compact));
        }
        var changes = new List<TextEdit>();
        foreach (var candidate in candidates.OrderBy(edit => edit.Start).ThenByDescending(edit => edit.Length))
        {
            if (!changes.Any(edit => edit.Start <= candidate.Start &&
                edit.Start + edit.Length >= candidate.Start + candidate.Length))
                changes.Add(candidate);
        }
        return TextEdit.Apply(source, changes);
    }

    private static (Token Open, SyntaxBase[] Arguments, Token Close)? CallParts(SyntaxTree tree, SyntaxBase call)
    {
        var tokens = tree.Within(call).ToArray();
        var open = tokens.FirstOrDefault(token => token.Text == "(");
        var close = tokens.LastOrDefault(token => token.Text == ")");
        var arguments = call switch
        {
            FunctionCallSyntax function => function.Arguments.Cast<SyntaxBase>().ToArray(),
            InstanceFunctionCallSyntax function => function.Arguments.Cast<SyntaxBase>().ToArray(),
            _ => [],
        };
        return open is not null && close is not null && arguments.Length > 0
            ? (open, arguments, close) : null;
    }

    private string PreserveCallBreaks(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        var changes = new List<TextEdit>();
        foreach (var call in tree.Nodes.Where(node => node is FunctionCallSyntax or InstanceFunctionCallSyntax))
        {
            if (CallLayout(tree, call) != "preserve" ||
                !authorCallBreaks.TryGetValue(tree.Path(call), out var breaks) ||
                SyntaxTree.HasComments(call) ||
                protectedSpans.Any(span => span.Position < call.Span.GetEndPosition() &&
                    span.GetEndPosition() > call.Span.Position) ||
                CallParts(tree, call) is not { } parts || breaks.Length != parts.Arguments.Length + 1) continue;
            var lineStart = source.LastIndexOf('\n', call.Span.Position) + 1;
            var padding = source[lineStart..call.Span.Position].TakeWhile(c => c is ' ' or '\t');
            var leading = string.Concat(padding);
            var start = parts.Open.Span.GetEndPosition();
            for (var index = 0; index < parts.Arguments.Length; index++)
            {
                var argument = parts.Arguments[index];
                var gap = source[start..argument.Span.Position];
                if (gap.All(c => char.IsWhiteSpace(c) || c == ','))
                {
                    var desired = breaks[index] ? (index == 0 ? "" : ",") + "\n" + leading + indent :
                        index == 0 ? "" : ", ";
                    if (gap != desired) changes.Add(new(start, gap.Length, desired));
                }
                start = argument.Span.GetEndPosition();
            }
            var closing = source[start..parts.Close.Span.Position];
            if (closing.All(char.IsWhiteSpace))
            {
                var desired = breaks[^1] ? "\n" + leading : "";
                if (closing != desired) changes.Add(new(start, closing.Length, desired));
            }
        }
        return TextEdit.Apply(source, changes);
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
                var authoredBreaks = authorCallBreaks.GetValueOrDefault(tree.Path(decorator.Expression));
                if (options.BicepDescriptionWidth == "wrap" ||
                    options.BicepDescriptionWidth == "preserve" && authoredBreaks is [_, _] &&
                    authoredBreaks.Contains(true))
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
                        options.BicepDescriptionWidth == "wrap" && !rendered.Contains('\n') &&
                        (indent + rendered).Replace("\t", new string(' ', options.TabWidth)).Length <= options.PrintWidth)
                    {
                        continue;
                    }
                    var argument = arguments[0].Expression;
                    var argumentText = SyntaxTree.Slice(source, argument);
                    var callPrefix = source[decorator.Span.Position..arguments[0].Span.Position].TrimEnd(' ', '\t', '\r', '\n');
                    var padding = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
                    rendered = options.BicepDescriptionWidth == "preserve"
                        ? callPrefix + (authoredBreaks![0] ? "\n" + indent + padding : "") +
                            argumentText + (authoredBreaks[1] ? "\n" + indent : "") + ")"
                        : callPrefix + "\n" + indent + padding + argumentText + "\n" + indent + ")";
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
                    if (previous is ParameterDeclarationSyntax && current is ParameterDeclarationSyntax &&
                        options.BicepParameterSpacing == "preserve")
                        spacing = "preserve";
                    if (options.BicepParameterSpacing == "description" &&
                        previous is ParameterDeclarationSyntax previousParameter &&
                        current is ParameterDeclarationSyntax currentParameter &&
                        (string.IsNullOrWhiteSpace(gap) || HasAttachedParameterComment(gap)))
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

    [GeneratedRegex(@"(?ms)^[ \t]*(?://[^\n]*|/\*.*?\*/)\n[ \t]*\z")]
    private static partial Regex AttachedParameterComment();

    private static bool HasAttachedParameterComment(string gap)
    {
        var firstNewline = gap.IndexOf('\n');
        return firstNewline >= 0 &&
            gap.AsSpan(0, firstNewline).IndexOfAnyExcept(' ', '\t') < 0 &&
            AttachedParameterComment().IsMatch(gap) &&
            !gap.Contains("prettier-ignore", StringComparison.Ordinal);
    }

    private static TextSpan[] ProtectedSpans(SyntaxTree tree, HashSet<string> ignored) => tree.Nodes
        .Where(n => n is ITopLevelDeclarationSyntax && ignored.Contains(tree.Id(n)))
        .Select(n => n.Span)
        .Concat(tree.Tokens.Where(t => t.Type != TokenType.NewLine && t.Text.Contains('\n')).Select(t => t.Span))
        .Concat(tree.Tokens.SelectMany(t => t.LeadingTrivia.Concat(t.TrailingTrivia))
            .Where(t => t.Type != SyntaxTriviaType.Whitespace && t.Text.Contains('\n')).Select(t => t.Span))
        .ToArray();

    private string? CallLayout(SyntaxTree tree, SyntaxBase call)
    {
        var node = call;
        while (tree.Parents.TryGetValue(node, out var parent))
        {
            if (parent is BinaryOperationSyntax binary &&
                binary.OperatorToken.Type is TokenType.LogicalOr or TokenType.LogicalAnd)
                return options.BicepLogicalCallLayout;
            if (parent is IfConditionSyntax)
                return options.BicepIfConditionLayout;
            node = parent;
        }
        return null;
    }

    private string InlineConfiguredCalls(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var changes = new List<TextEdit>();
        foreach (var call in tree.Nodes.Where(node =>
            node is FunctionCallSyntax or InstanceFunctionCallSyntax &&
            source.AsSpan(node.Span.Position, node.Span.Length).Contains('\n') &&
            CallLayout(tree, node) == "inline"))
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
        return TextEdit.Apply(source, changes);
    }

    private string NormalizeTernaryIndentation(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        if (indent.Length == 0) return source;
        var dedents = new Dictionary<int, int>();
        var indents = new Dictionary<int, int>();
        static bool CompoundBranch(SyntaxBase expression) => expression switch
        {
            ObjectSyntax or ArraySyntax or ForSyntax or FunctionCallSyntax or InstanceFunctionCallSyntax => true,
            ParenthesizedExpressionSyntax parenthesized => CompoundBranch(parenthesized.Expression),
            _ => false,
        };
        static bool DirectBranch(SyntaxBase branch, TernaryOperationSyntax nested) => branch switch
        {
            ParenthesizedExpressionSyntax parenthesized => DirectBranch(parenthesized.Expression, nested),
            _ => ReferenceEquals(branch, nested),
        };
        void CollectLines(Dictionary<int, int> levels, int begin, int end)
        {
            for (var newline = source.IndexOf('\n', begin);
                newline >= 0 && newline + 1 < end;
                newline = source.IndexOf('\n', newline + 1))
            {
                var start = newline + 1;
                if (protectedSpans.Any(span => span.Position < start && span.GetEndPosition() > start)) continue;
                levels[start] = levels.GetValueOrDefault(start) + 1;
            }
        }
        foreach (var ternary in tree.Nodes.OfType<TernaryOperationSyntax>())
        {
            var conditionWraps = source.LastIndexOf('\n', ternary.ConditionExpression.Span.Position) !=
                source.LastIndexOf('\n', ternary.Question.Span.Position);
            var parent = tree.Parents.GetValueOrDefault(ternary);
            if (parent is ForSyntax loop && ReferenceEquals(loop.Body, ternary) && conditionWraps)
            {
                CollectLines(indents, ternary.ConditionExpression.Span.GetEndPosition(), ternary.Span.GetEndPosition());
            }
            while (parent is not null && parent is not TernaryOperationSyntax)
                parent = tree.Parents.GetValueOrDefault(parent);
            if (parent is TernaryOperationSyntax enclosing && conditionWraps &&
                (DirectBranch(enclosing.TrueExpression, ternary) ||
                 DirectBranch(enclosing.FalseExpression, ternary)))
            {
                CollectLines(dedents, ternary.ConditionExpression.Span.GetEndPosition(), ternary.Span.GetEndPosition());
            }
            foreach (var (separator, branch) in new[]
                {
                    (ternary.Question, ternary.TrueExpression),
                    (ternary.Colon, ternary.FalseExpression),
                })
            {
                if (CompoundBranch(branch) &&
                    source.LastIndexOf('\n', separator.Span.Position) == source.LastIndexOf('\n', branch.Span.Position))
                {
                    CollectLines(dedents, branch.Span.Position, branch.Span.GetEndPosition());
                }
            }
        }
        var changes = new List<TextEdit>();
        foreach (var start in dedents.Keys.Concat(indents.Keys).Distinct())
        {
            var levels = indents.GetValueOrDefault(start) - dedents.GetValueOrDefault(start);
            if (levels > 0)
            {
                changes.Add(new(start, 0, string.Concat(Enumerable.Repeat(indent, levels))));
                continue;
            }
            var length = 0;
            for (var level = 0; level < -levels && source.AsSpan(start + length).StartsWith(indent); level++)
                length += indent.Length;
            if (length > 0) changes.Add(new(start, length, ""));
        }
        return TextEdit.Apply(source, changes);
    }

    private string NormalizeLambdaIndentation(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var indent = options.UseTabs ? "\t" : new string(' ', options.TabWidth);
        if (indent.Length == 0) return source;
        var dedents = new Dictionary<int, int>();
        foreach (var lambda in tree.Nodes.OfType<LambdaSyntax>())
        {
            if (SyntaxTree.HasComments(lambda) ||
                protectedSpans.Any(span => span.Position < lambda.Span.GetEndPosition() &&
                    span.GetEndPosition() > lambda.Span.Position)) continue;
            var arrow = tree.Within(lambda).LastOrDefault(token =>
                token.Text == "=>" && token.Span.GetEndPosition() <= lambda.Body.Span.Position);
            if (arrow is null) continue;
            var headerStart = source.LastIndexOf('\n', arrow.Span.Position) + 1;
            var bodyStart = source.LastIndexOf('\n', lambda.Body.Span.Position) + 1;
            if (bodyStart <= headerStart) continue;
            var headerEnd = headerStart;
            while (headerEnd < source.Length && source[headerEnd] is ' ' or '\t') headerEnd++;
            var headerIndent = source[headerStart..headerEnd];
            if (source[bodyStart..lambda.Body.Span.Position] != headerIndent + indent) continue;
            for (var start = bodyStart; start < lambda.Body.Span.GetEndPosition();)
            {
                if (!protectedSpans.Any(span => span.Position < start && span.GetEndPosition() > start) &&
                    source.AsSpan(start).StartsWith(indent))
                    dedents[start] = dedents.GetValueOrDefault(start) + 1;
                var next = source.IndexOf('\n', start);
                if (next < 0) break;
                start = next + 1;
            }
        }
        return TextEdit.Apply(source, dedents
            .Where(pair => source.AsSpan(pair.Key).StartsWith(
                string.Concat(Enumerable.Repeat(indent, pair.Value))))
            .Select(pair => new TextEdit(pair.Key, pair.Value * indent.Length, "")));
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
        if (options.BicepUnionLayout is "multiline" or "preserve")
        {
            foreach (var union in tree.Nodes.OfType<UnionTypeSyntax>())
            {
                if (IsProtected(union)) continue;
                var members = union.Children.OfType<UnionTypeMemberSyntax>().ToArray();
                if (members.Length < 2) continue;
                var breaks = authorUnionBreaks.GetValueOrDefault(tree.Path(union));
                if (options.BicepUnionLayout == "preserve" && breaks is null) continue;
                var previous = tree.Tokens.LastOrDefault(t => t.Type != TokenType.NewLine && t.Span.GetEndPosition() <= union.Span.Position);
                if (previous is null) continue;
                var padding = LineIndent(previous.Span.Position) + indent;
                var start = previous.Span.GetEndPosition();
                for (var index = 0; index < members.Length; index++)
                {
                    var member = members[index];
                    var gap = source[start..member.Value.Span.Position];
                    if (gap.All(c => char.IsWhiteSpace(c) || c == '|'))
                    {
                        var broken = options.BicepUnionLayout == "multiline" ||
                            index < breaks?.Length && breaks[index];
                        changes.Add(new(start, gap.Length, broken
                            ? "\n" + padding + "| "
                            : index == 0 ? " " : " | "));
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
        if (options.BicepConditionalHeader == "compact")
        {
            changes = [];
            foreach (var condition in tree.Nodes.OfType<IfConditionSyntax>())
            {
                if (options.BicepIfConditionLayout == "wrap" ||
                    IsProtected(condition) || !tree.Parents.TryGetValue(condition, out var parent) ||
                    parent is not ResourceDeclarationSyntax and not ModuleDeclarationSyntax ||
                    !SyntaxTree.Slice(source, condition.ConditionExpression).Contains('\n') ||
                    SyntaxTree.HasComments(condition.ConditionExpression) ||
                    protectedSpans.Any(span => span.Position < condition.ConditionExpression.Span.GetEndPosition() &&
                        span.GetEndPosition() > condition.ConditionExpression.Span.Position) ||
                    tree.Nodes.Where(node => node is FunctionCallSyntax or InstanceFunctionCallSyntax &&
                        node.Span.Position >= condition.ConditionExpression.Span.Position &&
                        node.Span.GetEndPosition() <= condition.ConditionExpression.Span.GetEndPosition())
                        .Any(call => CallLayout(tree, call) switch
                        {
                            "wrap" => SyntaxTree.Slice(source, call).Contains('\n'),
                            "preserve" => authorCallBreaks.GetValueOrDefault(tree.Path(call))?.Contains(true) == true,
                            _ => false,
                        })) continue;
                var inline = PrettyPrinterV2.PrintValid(condition.ConditionExpression, options.Printer with
                {
                    Width = int.MaxValue,
                    InsertFinalNewline = false,
                }).TrimEnd('\r', '\n');
                if (!inline.Contains('\n'))
                    changes.Add(new(condition.ConditionExpression.Span.Position,
                        condition.ConditionExpression.Span.Length, inline));
            }
            source = TextEdit.Apply(source, changes);
            tree = new SyntaxTree(Parse(source).ProgramSyntax);
            protectedSpans = ProtectedSpans(tree, ignored);
        }
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
            if (options.BicepConditionalHeader == "preserve" &&
                !authorConditionalNextLine.GetValueOrDefault(tree.Path(condition))) continue;
            if ((options.BicepConditionalHeader is "auto" or "compact") && width <= options.PrintWidth) continue;
            changes.Add(new(start, keyword - start, "\n" + LineIndent(keyword) +
                string.Concat(Enumerable.Repeat(indent, indents.GetValueOrDefault(lineStart) + 1))));
            if (options.BicepConditionalHeader != "compact")
            {
                for (var newline = source.IndexOf('\n', body.OpenBrace.Span.GetEndPosition());
                    newline >= 0 && newline < body.CloseBrace.Span.Position;
                    newline = source.IndexOf('\n', newline + 1))
                {
                    var position = newline + 1;
                    if (protectedSpans.Any(s => s.Position < position && s.GetEndPosition() > position)) continue;
                    indents[position] = indents.GetValueOrDefault(position) + 1;
                }
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
            if (options.BicepLoopLayout == "preserve" &&
                !authorCompactLoops.GetValueOrDefault(tree.Path(loop))) continue;
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
            var preserveHeader = loop.Body is IfConditionSyntax && options.BicepIfConditionLayout == "preserve" &&
                authorCompactLoops.GetValueOrDefault(tree.Path(loop));
            if (header.Contains('\n') && options.BicepLoopLayout != "preserve" && !preserveHeader) continue;
            var spaceBeforeColon = loop.Body is IfConditionSyntax && loop.Expression is ParenthesizedExpressionSyntax &&
                loop.Expression.Span.GetEndPosition() == loop.Colon.Span.Position;
            var width = (prefix + header).Replace("\t", new string(' ', options.TabWidth)).Length -
                dedents.GetValueOrDefault(lineStart) * options.TabWidth + (spaceBeforeColon ? 1 : 0);
            if (width > options.PrintWidth && options.BicepLoopLayout != "preserve" &&
                (loop.Body is not IfConditionSyntax || options.BicepIfConditionLayout != "inline" && !preserveHeader)) continue;

            if (spaceBeforeColon)
                changes.Add(new(loop.Colon.Span.Position, 0, " "));
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

    private sealed class InlineObjectArguments : SyntaxRewriteVisitor
    {
        protected override SyntaxBase RewriteInternal(SyntaxBase syntax)
        {
            var rewritten = base.RewriteInternal(syntax);
            return rewritten is ObjectSyntax obj
                ? new ObjectSyntax(obj.OpenBrace,
                    obj.Children.Where(node => node is not Token { Type: TokenType.NewLine }),
                    obj.CloseBrace)
                : rewritten;
        }
    }

    private string RemoveInlineObjectBracePadding(string expression)
    {
        if (!expression.Contains('{')) return expression;
        const string prefix = "var __bicepflex_inline = ";
        var tree = new SyntaxTree(Parse(prefix + expression + "\n").ProgramSyntax);
        var changes = new List<TextEdit>();
        foreach (var obj in tree.Nodes.OfType<ObjectSyntax>())
        {
            var contents = tree.Children[obj].Where(node => node is not Token).ToArray();
            if (contents.Length == 0) continue;
            var left = obj.OpenBrace.Span.GetEndPosition() - prefix.Length;
            var first = contents[0].Span.Position - prefix.Length;
            var last = contents[^1].Span.GetEndPosition() - prefix.Length;
            var right = obj.CloseBrace.Span.Position - prefix.Length;
            if (left < 0 || right > expression.Length ||
                expression.AsSpan(left, first - left).IndexOfAnyExcept(' ', '\t') >= 0 ||
                expression.AsSpan(last, right - last).IndexOfAnyExcept(' ', '\t') >= 0) continue;
            if (first > left) changes.Add(new(left, first - left, ""));
            if (right > last) changes.Add(new(last, right - last, ""));
        }
        return TextEdit.Apply(expression, changes);
    }

    private string? RenderCompactExpression(SyntaxBase expression)
    {
        var body = options.BicepObjectLayout == "preserve"
            ? expression
            : new InlineObjectArguments().Rewrite(expression);
        var inline = PrettyPrinterV2.PrintValid(body, options.Printer with
        {
            Width = int.MaxValue,
            InsertFinalNewline = false,
        }).TrimEnd('\r', '\n');
        return inline.Contains('\n') ? null : RemoveInlineObjectBracePadding(inline);
    }

    private string CompactTernaryObjectProperties(string source, HashSet<string> ignored)
    {
        if (options.BicepObjectLayout == "preserve") return source;
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var changes = new List<TextEdit>();
        foreach (var property in tree.Nodes.OfType<ObjectPropertySyntax>())
        {
            if (property.Value is not TernaryOperationSyntax ternary ||
                ternary.TrueExpression is not ObjectSyntax && ternary.FalseExpression is not ObjectSyntax ||
                SyntaxTree.HasComments(ternary) ||
                protectedSpans.Any(span => span.Position < ternary.Span.GetEndPosition() &&
                    span.GetEndPosition() > ternary.Span.Position)) continue;
            var prefixStart = source.LastIndexOf('\n', property.Span.Position) + 1;
            var prefix = source[prefixStart..ternary.Span.Position];
            if (prefix.Contains('\n')) continue;
            var inline = RenderCompactExpression(ternary);
            if (inline is null || inline == SyntaxTree.Slice(source, ternary)) continue;
            var suffixEnd = source.IndexOf('\n', ternary.Span.GetEndPosition());
            if (suffixEnd < 0) suffixEnd = source.Length;
            var line = prefix + inline + source[ternary.Span.GetEndPosition()..suffixEnd];
            if (line.Replace("\t", new string(' ', options.TabWidth)).Length > options.PrintWidth)
                continue;
            if (!changes.Any(edit => edit.Start <= ternary.Span.Position &&
                edit.Start + edit.Length >= ternary.Span.GetEndPosition()))
                changes.Add(new(ternary.Span.Position, ternary.Span.Length, inline));
        }
        return TextEdit.Apply(source, changes);
    }

    private string CompactObjectArgumentCalls(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var changes = new List<TextEdit>();
        foreach (var call in tree.Nodes.Where(node => node is FunctionCallSyntax or InstanceFunctionCallSyntax))
        {
            var hasObjectArgument = call switch
            {
                FunctionCallSyntax function => function.Arguments.Any(arg => arg.Expression is ObjectSyntax),
                InstanceFunctionCallSyntax function => function.Arguments.Any(arg => arg.Expression is ObjectSyntax),
                _ => false,
            };
            if (!hasObjectArgument || SyntaxTree.HasComments(call) ||
                protectedSpans.Any(span => span.Position < call.Span.GetEndPosition() &&
                    span.GetEndPosition() > call.Span.Position) ||
                changes.Any(edit => edit.Start <= call.Span.Position &&
                    edit.Start + edit.Length >= call.Span.GetEndPosition())) continue;
            if (CallLayout(tree, call) == "preserve" &&
                authorCallBreaks.GetValueOrDefault(tree.Path(call))?.Contains(true) == true) continue;
            var inline = RenderCompactExpression(call);
            if (inline is null || inline == SyntaxTree.Slice(source, call)) continue;
            var start = source.LastIndexOf('\n', call.Span.Position) + 1;
            var end = source.IndexOf('\n', call.Span.GetEndPosition());
            if (end < 0) end = source.Length;
            var line = source[start..call.Span.Position] + inline +
                source[call.Span.GetEndPosition()..end];
            if (line.Replace("\t", new string(' ', options.TabWidth)).Length > options.PrintWidth)
                continue;
            changes.Add(new(call.Span.Position, call.Span.Length, inline));
        }
        return TextEdit.Apply(source, changes);
    }

    private string CompactExpressionLoops(string source, HashSet<string> ignored)
    {
        var tree = new SyntaxTree(Parse(source).ProgramSyntax);
        var protectedSpans = ProtectedSpans(tree, ignored);
        var changes = new List<TextEdit>();
        foreach (var loop in tree.Nodes.OfType<ForSyntax>())
        {
            if (loop.Body is not FunctionCallSyntax and not InstanceFunctionCallSyntax ||
                options.BicepLoopLayout == "preserve" &&
                !authorCompactLoops.GetValueOrDefault(tree.Path(loop)) ||
                SyntaxTree.HasComments(loop) ||
                protectedSpans.Any(span => span.Position < loop.Span.GetEndPosition() &&
                    span.GetEndPosition() > loop.Span.Position)) continue;
            var before = source[loop.OpenSquare.Span.GetEndPosition()..loop.ForKeyword.Span.Position];
            var after = source[loop.Body.Span.GetEndPosition()..loop.CloseSquare.Span.Position];
            var header = source[loop.ForKeyword.Span.Position..loop.Body.Span.Position];
            if (!string.IsNullOrWhiteSpace(before) || !string.IsNullOrWhiteSpace(after) ||
                header.Contains('\n')) continue;
            var inline = RenderCompactExpression(loop.Body);
            if (inline is null) continue;
            var replacement = "[" + header + inline + "]";
            var lineStart = source.LastIndexOf('\n', loop.OpenSquare.Span.Position) + 1;
            var line = source[lineStart..loop.OpenSquare.Span.Position] + replacement;
            if (options.BicepLoopLayout != "preserve" &&
                line.Replace("\t", new string(' ', options.TabWidth)).Length > options.PrintWidth)
                continue;
            if (changes.Any(edit => edit.Start <= loop.OpenSquare.Span.Position &&
                edit.Start + edit.Length >= loop.CloseSquare.Span.GetEndPosition()))
                continue;
            changes.Add(new(loop.OpenSquare.Span.Position,
                loop.CloseSquare.Span.GetEndPosition() - loop.OpenSquare.Span.Position, replacement));
        }
        return TextEdit.Apply(source, changes);
    }
}
