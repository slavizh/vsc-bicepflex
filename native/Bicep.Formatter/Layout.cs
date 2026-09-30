using System.Collections.Immutable;
using System.Reflection;
using System.Text.RegularExpressions;
using Bicep.Core.Navigation;
using Bicep.Core.Parsing;
using Bicep.Core.Syntax;

sealed partial class Layout(
    SyntaxTree tree,
    Ordering ordering,
    FormatOptions options,
    HashSet<string> ignored) : SyntaxRewriteVisitor
{
    private sealed record Piece(List<SyntaxBase> Prefix, SyntaxBase Node);
    private readonly Dictionary<ObjectSyntax, string> bodies = tree.Nodes
        .Select(n => n switch
        {
            ResourceDeclarationSyntax r => (Body: r.TryGetBody(), Kind: "resource"),
            ModuleDeclarationSyntax m => (Body: m.TryGetBody(), Kind: "module"),
            _ => (Body: (ObjectSyntax?)null, Kind: ""),
        }).Where(x => x.Body is not null).ToDictionary(x => x.Body!, x => x.Kind);

    public static string? DecoratorName(DecoratorSyntax decorator) => decorator.Expression switch
    {
        FunctionCallSyntax function => function.Name.IdentifierName,
        InstanceFunctionCallSyntax { BaseExpression: VariableAccessSyntax ns } function
            when ns.Name.IdentifierName == "sys" => function.Name.IdentifierName,
        _ => null,
    };

    protected override SyntaxBase RewriteInternal(SyntaxBase syntax)
    {
        if (syntax is ITopLevelDeclarationSyntax && ignored.Contains(tree.Id(syntax)))
        {
            return syntax;
        }
        if (syntax is ProgramSyntax program && options.BicepSortDeclarations)
        {
            syntax = new ProgramSyntax(Reorder(program.Children, ordering.Sort, ordering.IsBoundary), program.EndOfFile);
        }
        if (syntax is ObjectSyntax obj)
        {
            var children = obj.Children.AsEnumerable();
            if (bodies.TryGetValue(obj, out var kind))
            {
                var priorities = FormatOptions.List(kind == "resource" ? options.BicepResourcePropertyOrder : options.BicepModulePropertyOrder);
                var wildcard = Array.IndexOf(priorities, "*");
                int Rank(SyntaxBase node)
                {
                    if (node is ResourceDeclarationSyntax) return priorities.Length + 1;
                    if (node is not ObjectPropertySyntax property) return priorities.Length;
                    var index = Array.IndexOf(priorities, property.TryGetKeyText());
                    return index >= 0 ? index : wildcard >= 0 ? wildcard : priorities.Length;
                }
                children = Reorder(children,
                    nodes =>
                    {
                        var properties = nodes.Where(n => n is not ResourceDeclarationSyntax).ToList();
                        if (options.BicepSortProperties) properties = properties.OrderBy(Rank).ToList();
                        var resources = nodes.OfType<ResourceDeclarationSyntax>().Cast<SyntaxBase>().ToList();
                        if (options.BicepSortDeclarations) resources = ordering.Sort(resources);
                        return properties.Concat(resources).ToList();
                    },
                    node => node is SpreadExpressionSyntax ||
                        node is ResourceDeclarationSyntax && (options.BicepNestedResources == "preserve" || ordering.IsBoundary(node)) ||
                        node is ObjectPropertySyntax p && (p.TryGetKeyText() is null || obj.Properties.Count(q => q.TryGetKeyText() == p.TryGetKeyText()) > 1));
            }
            syntax = new ObjectSyntax(obj.OpenBrace, children, obj.CloseBrace);
        }
        if (syntax is ObjectTypeSyntax objectType && options.BicepTypeMemberOrder == "required-first")
        {
            syntax = new ObjectTypeSyntax(objectType.OpenBrace,
                Reorder(objectType.Children,
                    nodes => nodes.OrderBy(n => n is ObjectTypePropertySyntax { Value: NullableTypeSyntax } ? 1 : 0).ToList(),
                    node => node is not ObjectTypePropertySyntax),
                objectType.CloseBrace);
        }
        if (syntax is ImportedSymbolsListSyntax imports && options.BicepImportMemberOrder == "alphabetical")
        {
            syntax = new ImportedSymbolsListSyntax(imports.OpenBrace,
                Reorder(imports.Children,
                    nodes => nodes.OrderBy(n => SyntaxTree.Trivia([((ImportedSymbolsListItemSyntax)n).OriginalSymbolName]), StringComparer.Ordinal).ToList(),
                    node => node is not ImportedSymbolsListItemSyntax),
                imports.CloseBrace);
        }
        if (syntax is DecorableSyntax decorated && decorated.Decorators.Any() && options.BicepSortDecorators)
        {
            var priorities = FormatOptions.List(options.BicepDecoratorOrder);
            var leading = Reorder(decorated.LeadingNodes,
                nodes => nodes.OrderBy(n => Array.IndexOf(priorities, n is DecoratorSyntax d ? DecoratorName(d) : null)).ToList(),
                node => node is not DecoratorSyntax d || !priorities.Contains(DecoratorName(d)) ||
                    decorated.Decorators.Count(other => DecoratorName(other) == DecoratorName(d)) > 1).ToImmutableArray();
            syntax = ReplaceLeadingNodes(decorated, leading);
        }
        var rewritten = base.RewriteInternal(syntax);
        return rewritten switch
        {
            ObjectSyntax value => new ObjectSyntax(value.OpenBrace, ObjectChildren(value.Children, options.BicepObjectLayout == "multiline"), value.CloseBrace),
            ObjectTypeSyntax value => new ObjectTypeSyntax(value.OpenBrace, ObjectChildren(value.Children, options.BicepObjectLayout == "multiline"), value.CloseBrace),
            ArraySyntax array => RewriteArray(array),
            _ => rewritten,
        };
    }

    private static SyntaxBase ReplaceLeadingNodes(DecorableSyntax node, ImmutableArray<SyntaxBase> leading)
    {
        var constructor = node.GetType().GetConstructors().Single(c => c.GetParameters().Any(p => p.Name == "leadingNodes"));
        var args = constructor.GetParameters().Select(parameter =>
        {
            if (parameter.Name == "leadingNodes") return (object)leading;
            var property = node.GetType().GetProperty(parameter.Name!, BindingFlags.IgnoreCase | BindingFlags.Public | BindingFlags.Instance)
                ?? throw new InvalidOperationException($"Unsupported Bicep constructor parameter {node.GetType().Name}.{parameter.Name}.");
            return property.GetValue(node);
        }).ToArray();
        return (SyntaxBase)constructor.Invoke(args);
    }

    private IEnumerable<SyntaxBase> ObjectChildren(IEnumerable<SyntaxBase> children, bool multiline)
    {
        var result = children.Select(node =>
            node is Token { Type: TokenType.NewLine } token && !options.BicepPropertyBlankLines && !SyntaxTree.HasComments(token)
                ? new FreeformToken(TokenType.NewLine, token.Span, "\n", token.LeadingTrivia, token.TrailingTrivia)
                : node).ToList();
        if (multiline && result.Any(n => n is not Token))
        {
            result.Insert(0, SyntaxTree.Newline());
        }
        return result;
    }

    private ArraySyntax RewriteArray(ArraySyntax array)
    {
        var primitive = array.Items.All(item => item.Value is
            StringSyntax or IntegerLiteralSyntax or BooleanLiteralSyntax or NullLiteralSyntax or UnaryOperationSyntax);
        var children = array.Children.AsEnumerable();
        if (primitive && options.BicepArrayLayout == "compact")
        {
            children = children.Where(n => n is not Token { Type: TokenType.NewLine or TokenType.Comma } || SyntaxTree.HasComments(n));
        }
        else if (array.Items.Any() && (options.BicepArrayLayout == "multiline" ||
            !primitive && options.BicepArrayLayout != "preserve"))
        {
            children = children.Prepend(SyntaxTree.Newline());
        }
        return new ArraySyntax(array.OpenBracket, children, array.CloseBracket);
    }

    private IEnumerable<SyntaxBase> Reorder(
        IEnumerable<SyntaxBase> children,
        Func<List<SyntaxBase>, List<SyntaxBase>> sort,
        Func<SyntaxBase, bool> pinned)
    {
        var result = new List<SyntaxBase>();
        var pending = new List<SyntaxBase>();
        var segment = new List<Piece>();
        void Flush()
        {
            if (segment.Count == 0) return;
            var mapping = segment.ToDictionary(x => x.Node);
            foreach (var node in sort(segment.Select(x => x.Node).ToList()))
            {
                result.AddRange(mapping[node].Prefix);
                result.Add(node);
            }
            segment.Clear();
        }
        foreach (var node in children)
        {
            if (node is Token)
            {
                pending.Add(node);
                continue;
            }
            if (SyntaxTree.Trivia(pending).Contains("#disable-diagnostics", StringComparison.Ordinal) ||
                SyntaxTree.Trivia(pending).Contains("#restore-diagnostics", StringComparison.Ordinal))
            {
                Flush();
                result.AddRange(pending);
                pending = [];
            }
            else if (options.BicepSectionComments == "boundary" && SectionHeading().IsMatch(SyntaxTree.Trivia(pending)))
            {
                Flush();
                var lastHeading = SectionHeading().Matches(SyntaxTree.Trivia(pending))[^1];
                var boundary = lastHeading.Index + lastHeading.Length;
                var length = 0;
                var count = 0;
                while (count < pending.Count && length < boundary)
                {
                    length += SyntaxTree.Trivia([pending[count]]).Length;
                    count++;
                }
                result.AddRange(pending.Take(count));
                pending = pending.Skip(count).ToList();
            }
            if (pinned(node) || options.BicepIgnoredDeclarations == "boundary" &&
                node is ITopLevelDeclarationSyntax && ignored.Contains(tree.Id(node)))
            {
                Flush();
                result.AddRange(pending);
                result.Add(node);
            }
            else
            {
                segment.Add(new Piece(pending, node));
            }
            pending = [];
        }
        Flush();
        result.AddRange(pending);
        return result;
    }

    [GeneratedRegex(@"(?m)(?://[^\n]*|/\*[\s\S]*?\*/)[ \t]*\n[ \t]*\n")]
    private static partial Regex SectionHeading();
}
