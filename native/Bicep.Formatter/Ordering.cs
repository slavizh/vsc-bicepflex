using Bicep.Core.Semantics;
using Bicep.Core.Syntax;

sealed class Ordering(SemanticModel model, SyntaxTree tree, FormatOptions options)
{
    private readonly Dictionary<SyntaxBase, HashSet<SyntaxBase>> referenceCache = [];
    private readonly string[] sections = FormatOptions.List(options.BicepDeclarationOrder);

    public HashSet<SyntaxBase> References(SyntaxBase node)
    {
        if (referenceCache.TryGetValue(node, out var references)) return references;
        references = model.GetSymbolInfo(node) is DeclaredSymbol symbol
            ? model.Binder.GetSymbolsReferencedInDeclarationOf(symbol).Select(x => x.DeclaringSyntax).Where(x => x != node).ToHashSet()
            : [];
        referenceCache[node] = references;
        return references;
    }

    public bool IsUnused(SyntaxBase node) =>
        node is VariableDeclarationSyntax or ResourceDeclarationSyntax { ExistingKeyword: not null } &&
        !(node is DecorableSyntax decorated && decorated.Decorators.Any(d => Layout.DecoratorName(d) == "export")) &&
        !tree.Nodes.Any(n => n != node && n is Bicep.Core.Navigation.ITopLevelDeclarationSyntax && References(n).Contains(node));

    public bool IsBoundary(SyntaxBase node) => options.BicepUnusedDeclarations == "boundary" && IsUnused(node);

    private bool IsHelper(SyntaxBase node) =>
        node is VariableDeclarationSyntax && options.BicepVariablePlacement == "first-use" ||
        node is ResourceDeclarationSyntax { ExistingKeyword: not null } && options.BicepExistingResourcePlacement == "first-use";

    public static string Kind(SyntaxBase node) => node switch
    {
        MetadataDeclarationSyntax => "metadata",
        ExtensionDeclarationSyntax or ExtensionConfigAssignmentSyntax => "extension",
        TargetScopeSyntax => "targetScope",
        CompileTimeImportDeclarationSyntax => "import",
        TypeDeclarationSyntax => "type",
        ParameterDeclarationSyntax or ParameterAssignmentSyntax => "param",
        FunctionDeclarationSyntax => "func",
        VariableDeclarationSyntax => "var",
        ResourceDeclarationSyntax => "resource",
        ModuleDeclarationSyntax => "module",
        OutputDeclarationSyntax => "output",
        UsingDeclarationSyntax => "using",
        ExtendsDeclarationSyntax => "extends",
        TestDeclarationSyntax => "test",
        AssertDeclarationSyntax => "assert",
        _ => throw new FormatException($"No declaration ordering policy is defined for {node.GetType().Name}. Disable bicepSortDeclarations for this syntax."),
    };

    public List<SyntaxBase> Sort(List<SyntaxBase> input)
    {
        if (input.Count < 2) return input;
        var set = input.ToHashSet();
        SyntaxBase? InScope(SyntaxBase reference)
        {
            while (!set.Contains(reference))
            {
                if (!tree.Parents.TryGetValue(reference, out var parent)) return null;
                reference = parent;
            }
            return reference;
        }
        var scopedReferences = input.ToDictionary(n => n, n => References(n).Select(InScope)
            .Where(reference => reference is not null && reference != n).Cast<SyntaxBase>().ToHashSet());
        HashSet<SyntaxBase> Refs(SyntaxBase node) => scopedReferences[node];
        var helpers = input.Where(n => IsHelper(n) && input.Any(c => Refs(c).Contains(n))).ToHashSet();
        var anchors = input.Where(n => !helpers.Contains(n)).ToList();
        var dependencies = anchors.ToDictionary(n => n, _ => new HashSet<SyntaxBase>());
        var visiting = new HashSet<SyntaxBase>();

        HashSet<SyntaxBase> Expand(SyntaxBase node)
        {
            if (!visiting.Add(node)) throw new FormatException($"Dependency cycle involving '{SyntaxTree.Name(node)}'; formatting was not applied.");
            var result = new HashSet<SyntaxBase>();
            foreach (var reference in Refs(node))
            {
                if (helpers.Contains(reference)) result.UnionWith(Expand(reference));
                else result.Add(reference);
            }
            visiting.Remove(node);
            return result;
        }

        foreach (var anchor in anchors)
        {
            foreach (var dep in Expand(anchor))
            {
                if (anchor == dep) throw new FormatException($"Dependency cycle involving '{SyntaxTree.Name(anchor)}'.");
                if (anchor is TypeDeclarationSyntax && dep is TypeDeclarationSyntax ||
                    anchor is FunctionDeclarationSyntax && dep is FunctionDeclarationSyntax)
                {
                    var policy = anchor is TypeDeclarationSyntax ? options.BicepTypeOrder : options.BicepFunctionOrder;
                    if (policy == "dependents-first") dependencies[dep].Add(anchor);
                    else if (policy == "dependencies-first") dependencies[anchor].Add(dep);
                }
                else
                {
                    dependencies[anchor].Add(dep);
                }
            }
        }

        bool OutputOnly(SyntaxBase helper, HashSet<SyntaxBase> path)
        {
            if (!path.Add(helper)) return false;
            var consumers = input.Where(n => Refs(n).Contains(helper)).ToList();
            var answer = consumers.Count > 0 && consumers.All(n =>
                n is OutputDeclarationSyntax || helpers.Contains(n) && OutputOnly(n, path));
            path.Remove(helper);
            return answer;
        }

        var outputOnly = helpers.Where(h => OutputOnly(h, [])).ToHashSet();
        var emitted = new HashSet<SyntaxBase>();
        var result = new List<SyntaxBase>();
        int Rank(SyntaxBase node)
        {
            var kind = Kind(node);
            if (kind == "using") return -200;
            if (kind == "extends") return -100;
            if (kind is "resource" or "module" && options.BicepResourceModuleOrder == "combined")
            {
                return ResourceRank();
            }
            if (node is OutputDeclarationSyntax && options.BicepOutputPlacement == "dependency" &&
                !(options.BicepOutputOnlyVariables == "end" && Refs(node).Any(outputOnly.Contains)) &&
                dependencies[node].Any(n => n is ResourceDeclarationSyntax or ModuleDeclarationSyntax))
            {
                return ResourceRank() - 1;
            }
            var index = Array.IndexOf(sections, kind);
            return (index < 0 ? sections.Length : index) * 10;
        }
        int ResourceRank()
        {
            var indexes = new[] { Array.IndexOf(sections, "resource"), Array.IndexOf(sections, "module") }.Where(i => i >= 0).ToArray();
            return (indexes.Length > 0 ? indexes.Min() : sections.Length) * 10;
        }
        void Emit(SyntaxBase node)
        {
            if (emitted.Contains(node)) return;
            foreach (var helper in input.Where(h => helpers.Contains(h) && Refs(node).Contains(h)))
            {
                Emit(helper);
            }
            emitted.Add(node);
            result.Add(node);
        }
        while (anchors.Any(n => !emitted.Contains(n)))
        {
            SyntaxBase? next;
            if (options.BicepDependencyOrder == "dependencies-first")
            {
                var target = anchors.Where(n => !emitted.Contains(n)).OrderBy(Rank).ThenBy(input.IndexOf).First();
                var path = new HashSet<SyntaxBase>();
                SyntaxBase? FirstDependency(SyntaxBase node)
                {
                    if (!path.Add(node)) return null;
                    var missing = dependencies[node].Where(d => !emitted.Contains(d)).OrderBy(input.IndexOf).FirstOrDefault();
                    return missing is null ? node : FirstDependency(missing);
                }
                next = FirstDependency(target);
            }
            else
            {
                next = anchors.Where(n => !emitted.Contains(n) && dependencies[n].All(emitted.Contains))
                    .OrderBy(Rank).ThenBy(input.IndexOf).FirstOrDefault();
            }
            if (next is null)
            {
                // Nullable recursive types are legal. Preserve source order inside a
                // strongly connected type component; no total dependency order exists.
                HashSet<SyntaxBase> Reach(SyntaxBase start)
                {
                    var found = new HashSet<SyntaxBase>();
                    var queue = new Stack<SyntaxBase>();
                    queue.Push(start);
                    while (queue.TryPop(out var node))
                    {
                        if (!found.Add(node)) continue;
                        foreach (var dep in dependencies[node].Where(d => !emitted.Contains(d))) queue.Push(dep);
                    }
                    return found;
                }
                foreach (var candidate in anchors.Where(n => !emitted.Contains(n) && n is TypeDeclarationSyntax))
                {
                    var reachable = Reach(candidate);
                    var component = reachable.Where(n => Reach(n).Contains(candidate)).ToHashSet();
                    if (component.All(n => n is TypeDeclarationSyntax) &&
                        component.All(n => dependencies[n].All(d => emitted.Contains(d) || component.Contains(d))))
                    {
                        foreach (var member in component) dependencies[member].ExceptWith(component);
                        next = input.First(component.Contains);
                        break;
                    }
                }
                if (next is null) throw new FormatException("Declaration ordering contains a dependency cycle; formatting was not applied.");
            }
            Emit(next);
        }
        foreach (var remaining in input.Where(n => !emitted.Contains(n))) Emit(remaining);
        return result;
    }
}
