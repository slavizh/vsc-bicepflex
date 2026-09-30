using System.Text.Json;
using Bicep.Core.Extensions;
using Bicep.Core.Navigation;
using Bicep.Core.Parsing;
using Bicep.Core.Syntax;
using Bicep.Core.Text;

sealed class SyntaxTree : CstVisitor
{
    private readonly Stack<SyntaxBase> stack = new();
    public Dictionary<SyntaxBase, List<SyntaxBase>> Children { get; } = [];
    public Dictionary<SyntaxBase, SyntaxBase> Parents { get; } = [];
    public List<SyntaxBase> Nodes { get; } = [];
    public List<Token> Tokens { get; } = [];

    public SyntaxTree(SyntaxBase root) => Visit(root);

    protected override void VisitInternal(SyntaxBase node)
    {
        Nodes.Add(node);
        Children[node] = [];
        if (stack.TryPeek(out var parent))
        {
            Children[parent].Add(node);
            Parents[node] = parent;
        }
        stack.Push(node);
        base.VisitInternal(node);
        stack.Pop();
    }

    public override void VisitToken(Token token)
    {
        Tokens.Add(token);
        base.VisitToken(token);
    }

    public static string Name(SyntaxBase node) => node is ITopLevelNamedDeclarationSyntax named
        ? named.Name.IdentifierName
        : node.GetType().Name;

    public string Id(SyntaxBase node)
    {
        var parts = new List<string> { $"{node.GetType().Name}:{Name(node)}" };
        while (Parents.TryGetValue(node, out var parent))
        {
            node = parent;
            if (node is ResourceDeclarationSyntax)
            {
                parts.Add($"resource:{Name(node)}");
            }
        }
        parts.Reverse();
        return string.Join("/", parts);
    }

    public string Path(SyntaxBase node)
    {
        var parts = new Stack<string>();
        while (Parents.TryGetValue(node, out var parent))
        {
            var peers = Children[parent].Where(child => child.GetType() == node.GetType()).ToArray();
            static string? Label(SyntaxBase child) => child switch
            {
                ITopLevelNamedDeclarationSyntax named => named.Name.IdentifierName,
                ObjectPropertySyntax property => property.TryGetKeyText(),
                ObjectTypePropertySyntax { Key: IdentifierSyntax key } => key.IdentifierName,
                ObjectTypePropertySyntax { Key: StringSyntax key } => key.TryGetLiteralValue(),
                DecoratorSyntax decorator => Layout.DecoratorName(decorator),
                _ => null,
            };
            var label = Label(node);
            var unique = label is not null && peers.Count(peer => Label(peer) == label) == 1;
            parts.Push($"{node.GetType().Name}:{(unique ? JsonSerializer.Serialize(label) : Array.IndexOf(peers, node).ToString())}");
            node = parent;
        }
        return string.Join("/", parts);
    }

    public IEnumerable<Token> Within(SyntaxBase node) => Tokens.Where(t =>
        t.Span.Position >= node.Span.Position && t.Span.GetEndPosition() <= node.Span.GetEndPosition());

    public static string Trivia(IEnumerable<SyntaxBase> nodes) => string.Concat(nodes.Select(n => SyntaxStringifier.Stringify(n, "\n")));
    public static bool HasComments(SyntaxBase node) => new SyntaxTree(node).Tokens.Any(t =>
        t.LeadingTrivia.Concat(t.TrailingTrivia).Any(x => x.Type != SyntaxTriviaType.Whitespace));
    public static string Slice(string source, SyntaxBase node) => source.Substring(node.Span.Position, node.Span.Length);
    public static Token Newline(int count = 1) => new FreeformToken(TokenType.NewLine, TextSpan.Nil, new string('\n', count), [], []);

    public string Fingerprint(SyntaxBase node)
    {
        if (node is Token token)
        {
            return token.Type is TokenType.NewLine or TokenType.Comma ? "" : JsonSerializer.Serialize(new[] { token.Type.ToString(), token.Text });
        }
        if (node is ObjectPropertySyntax property)
        {
            return $"property({(property.TryGetKeyText() is string key ? JsonSerializer.Serialize(key) : Fingerprint(property.Key))},{Fingerprint(property.Value)})";
        }
        if (node is ObjectTypePropertySyntax typeProperty)
        {
            var key = typeProperty.Key switch
            {
                StringSyntax text => text.TryGetLiteralValue(),
                IdentifierSyntax identifier => identifier.IdentifierName,
                _ => null,
            };
            return $"typeProperty({(key is not null ? JsonSerializer.Serialize(key) : Fingerprint(typeProperty.Key))}," +
                $"{string.Join(",", typeProperty.Decorators.Select(Fingerprint).Order(StringComparer.Ordinal))},{Fingerprint(typeProperty.Value)})";
        }
        if (node is LambdaSyntax lambda)
        {
            return $"lambda({string.Join(",", lambda.GetLocalVariables().Select(x => x.Name.IdentifierName))},{Fingerprint(lambda.Body)})";
        }
        if (node is UnionTypeSyntax union && union.Children.OfType<UnionTypeMemberSyntax>().ToArray() is [var member])
        {
            return Fingerprint(member.Value);
        }
        var children = Children[node]
            .Where(n => node is not UnionTypeSyntax || n is not Token { Type: TokenType.Pipe })
            .Select(Fingerprint).Where(x => x.Length > 0);
        if (node is ProgramSyntax or ObjectSyntax or ObjectTypeSyntax or ImportedSymbolsListSyntax)
        {
            children = children.Order(StringComparer.Ordinal);
        }
        else if (node is DecorableSyntax)
        {
            var decorators = Children[node].OfType<DecoratorSyntax>().Select(Fingerprint).Order(StringComparer.Ordinal);
            var others = Children[node].Where(n => n is not DecoratorSyntax).Select(Fingerprint).Where(x => x.Length > 0);
            children = decorators.Concat(others);
        }
        return $"{node.GetType().Name}({string.Join(",", children)})";
    }
}

sealed record TextEdit(int Start, int Length, string Text)
{
    public static string Apply(string source, IEnumerable<TextEdit> changes)
    {
        var end = source.Length;
        foreach (var edit in changes.OrderByDescending(x => x.Start))
        {
            if (edit.Start < 0 || edit.Start + edit.Length > end)
            {
                throw new InvalidOperationException("Overlapping formatter edits were rejected.");
            }
            source = source.Remove(edit.Start, edit.Length).Insert(edit.Start, edit.Text);
            end = edit.Start;
        }
        return source;
    }
}
