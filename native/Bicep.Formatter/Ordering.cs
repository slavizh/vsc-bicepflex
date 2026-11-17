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

    private (Dictionary<SyntaxBase, int> Priorities, Action<SyntaxBase> Emitted) TypePriorities(
        List<SyntaxBase> input,
        Dictionary<SyntaxBase, HashSet<SyntaxBase>> dependencies,
        Func<ObjectTypeSyntax, IEnumerable<SyntaxBase>>? typeChildren,
        Func<List<SyntaxBase>> emissionOrder)
    {
        var priorities = new Dictionary<SyntaxBase, int>();
        if (options.BicepTypeOrder == "preserve") return (priorities, _ => { });
        var types = input.OfType<TypeDeclarationSyntax>().Cast<SyntaxBase>().ToHashSet();
        if (types.Count == 0) return (priorities, _ => { });
        IEnumerable<SyntaxBase> OrderedReferences(SyntaxBase node)
        {
            if (model.GetSymbolInfo(node) is DeclaredSymbol symbol && types.Contains(symbol.DeclaringSyntax))
                yield return symbol.DeclaringSyntax;
            var children = node is ObjectTypeSyntax obj && typeChildren is not null
                ? typeChildren(obj) : tree.Children[node];
            foreach (var child in children)
                foreach (var reference in OrderedReferences(child)) yield return reference;
        }
        var references = input.Where(types.Contains).ToDictionary(n => n,
            n => OrderedReferences(((TypeDeclarationSyntax)n).Value).Where(References(n).Contains).Distinct().ToList());

        // Collapse recursive components before choosing traversal priorities. Their
        // authored internal order is the only stable ordering without a total dependency order.
        var indexes = new Dictionary<SyntaxBase, int>();
        var low = new Dictionary<SyntaxBase, int>();
        var stack = new Stack<SyntaxBase>();
        var active = new HashSet<SyntaxBase>();
        var components = new Dictionary<SyntaxBase, List<SyntaxBase>>();
        void Connect(SyntaxBase node)
        {
            indexes[node] = low[node] = indexes.Count;
            stack.Push(node);
            active.Add(node);
            foreach (var reference in references[node])
            {
                if (!indexes.ContainsKey(reference))
                {
                    Connect(reference);
                    low[node] = Math.Min(low[node], low[reference]);
                }
                else if (active.Contains(reference)) low[node] = Math.Min(low[node], indexes[reference]);
            }
            if (low[node] != indexes[node]) return;
            var members = new HashSet<SyntaxBase>();
            SyntaxBase member;
            do
            {
                member = stack.Pop();
                active.Remove(member);
                members.Add(member);
            } while (member != node);
            var component = input.Where(members.Contains).ToList();
            foreach (var item in component) components[item] = component;
        }
        foreach (var type in input.Where(types.Contains))
            if (!indexes.ContainsKey(type)) Connect(type);

        var groups = input.Where(types.Contains).Select(n => components[n]).Distinct().ToList();
        var groupReferences = groups.ToDictionary(g => g,
            g => g.SelectMany(n => references[n]).Select(n => components[n]).Where(c => c != g).Distinct().ToList());
        var groupParents = groups.ToDictionary(g => g, _ => new HashSet<List<SyntaxBase>>());
        foreach (var group in groups)
            foreach (var reference in groupReferences[group]) groupParents[reference].Add(group);
        foreach (var group in groups.Where(g => g.Count > 1))
        {
            var external = group.SelectMany(n => dependencies[n]).Where(n => !group.Contains(n)).ToHashSet();
            for (var i = 0; i < group.Count; i++)
            {
                dependencies[group[i]].ExceptWith(group);
                dependencies[group[i]].UnionWith(external);
                if (i > 0) dependencies[group[i]].Add(group[i - 1]);
            }
        }
        // Use the same scheduler for root priorities so imports and preserved
        // declaration positions participate before reference preferences are applied.
        var plannedPositions = emissionOrder().Select((node, index) => (node, index))
            .ToDictionary(p => p.node, p => p.index);
        var visited = new HashSet<List<SyntaxBase>>();
        void Visit(List<SyntaxBase> group)
        {
            // A shared type belongs to its last parent's reference sequence, not
            // the sequence of an earlier ancestor that could not emit it yet.
            if (options.BicepTypeOrder == "dependents-first" && groupParents[group].Any(g => !visited.Contains(g))) return;
            if (!visited.Add(group)) return;
            void Prioritize()
            {
                foreach (var member in group) priorities[member] = priorities.Count;
            }
            if (options.BicepTypeOrder == "dependents-first") Prioritize();
            foreach (var reference in groupReferences[group]) Visit(reference);
            if (options.BicepTypeOrder == "dependencies-first") Prioritize();
        }
        foreach (var root in groups.Where(g => groupParents[g].Count == 0)
            .OrderBy(g => plannedPositions[g[0]])) Visit(root);
        var typeOrder = priorities.OrderBy(p => p.Value).Select(p => p.Key).ToList();
        var emittedTypes = new HashSet<SyntaxBase>();
        void Emitted(SyntaxBase node)
        {
            if (options.BicepTypeOrder != "dependents-first" ||
                !components.TryGetValue(node, out var group)) return;
            emittedTypes.Add(node);
            var preferred = group.Where(n => !emittedTypes.Contains(n)).ToList();
            if (preferred.Count == 0)
            {
                // Placement constraints can delay a parent beyond its traversal
                // position. Its references become preferred only when it is emitted.
                preferred.AddRange(groupReferences[group]
                    .Where(g => groupParents[g].All(p => p.All(emittedTypes.Contains)))
                    .SelectMany(g => g).Where(n => !emittedTypes.Contains(n)));
            }
            var preferredSet = preferred.ToHashSet();
            typeOrder.RemoveAll(preferredSet.Contains);
            typeOrder.InsertRange(0, preferred);
            for (var i = 0; i < typeOrder.Count; i++) priorities[typeOrder[i]] = i;
        }
        return (priorities, Emitted);
    }

    public List<SyntaxBase> Sort(List<SyntaxBase> input,
        Func<ObjectTypeSyntax, IEnumerable<SyntaxBase>>? typeChildren = null)
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
        bool OutputOnly(SyntaxBase variable, HashSet<SyntaxBase> path, HashSet<SyntaxBase> candidates)
        {
            if (!path.Add(variable)) return false;
            var consumers = input.Where(n => Refs(n).Contains(variable)).ToList();
            var answer = consumers.Count > 0 && consumers.All(n =>
                n is OutputDeclarationSyntax || candidates.Contains(n) && OutputOnly(n, path, candidates));
            path.Remove(variable);
            return answer;
        }

        var variables = input.Where(n => n is VariableDeclarationSyntax).ToHashSet();
        var preservedOutputVariables = options.BicepOutputOnlyVariables == "preserve"
            ? variables.Where(v => OutputOnly(v, [], variables)).ToHashSet()
            : [];
        var helpers = input.Where(n => IsHelper(n) && !preservedOutputVariables.Contains(n) &&
            input.Any(c => Refs(c).Contains(n))).ToHashSet();
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

        var preserved = anchors.Where(n =>
            options.BicepDependencyOrder == "preserve" ||
            n is VariableDeclarationSyntax && options.BicepVariablePlacement == "preserve" ||
            n is OutputDeclarationSyntax && options.BicepOutputPlacement == "preserve" ||
            options.BicepOutputOnlyVariables == "preserve" &&
                (preservedOutputVariables.Contains(n) ||
                 n is OutputDeclarationSyntax && Refs(n).Overlaps(preservedOutputVariables))).ToHashSet();
        if (preserved.Count > 0)
        {
            bool DependsOn(SyntaxBase node, SyntaxBase dependency, HashSet<SyntaxBase> visited)
            {
                if (!visited.Add(node)) return false;
                return dependencies[node].Any(d => d == dependency || DependsOn(d, dependency, visited));
            }

            for (var i = 0; i < anchors.Count; i++)
            {
                for (var j = i + 1; j < anchors.Count; j++)
                {
                    var earlier = anchors[i];
                    var later = anchors[j];
                    if ((preserved.Contains(earlier) || preserved.Contains(later)) &&
                        !DependsOn(earlier, later, []))
                    {
                        dependencies[later].Add(earlier);
                    }
                }
            }
        }

        var outputOnly = helpers.Where(h => OutputOnly(h, [], helpers)).ToHashSet();
        List<SyntaxBase> Schedule(Dictionary<SyntaxBase, int> typePriorities, Action<SyntaxBase> typeEmitted)
        {
            var pending = dependencies.ToDictionary(p => p.Key, p => p.Value.ToHashSet());
            var typeConsumers = typePriorities.Keys.SelectMany(type => Refs(type)
                .Where(reference => !typePriorities.ContainsKey(reference))
                .Select(reference => (reference, type)))
                .GroupBy(pair => pair.reference)
                .ToDictionary(group => group.Key, group => group.Select(pair => pair.type).ToList());
            (int Priority, int Prerequisite, int Source) Position(SyntaxBase node)
            {
                if (typePriorities.TryGetValue(node, out var priority)) return (priority, 0, input.IndexOf(node));
                // Prerequisites follow their type consumers, not incomparable source
                // indexes that can cross a preserved boundary on the next format.
                priority = options.BicepDependencyOrder == "dependencies-first" &&
                    typeConsumers.TryGetValue(node, out var consumers)
                    ? consumers.Min(type => typePriorities[type])
                    : typePriorities.Count + input.IndexOf(node);
                return (priority, 1, input.IndexOf(node));
            }
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
                    pending[node].Any(n => n is ResourceDeclarationSyntax or ModuleDeclarationSyntax))
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
                typeEmitted(node);
            }
            HashSet<SyntaxBase> Reach(SyntaxBase start)
            {
                var found = new HashSet<SyntaxBase>();
                var queue = new Stack<SyntaxBase>();
                queue.Push(start);
                while (queue.TryPop(out var node))
                {
                    if (!found.Add(node)) continue;
                    foreach (var dep in pending[node].Where(d => !emitted.Contains(d))) queue.Push(dep);
                }
                return found;
            }
            while (anchors.Any(n => !emitted.Contains(n)))
            {
                SyntaxBase? next;
                if (options.BicepDependencyOrder == "dependencies-first")
                {
                    var target = anchors.Where(n => !emitted.Contains(n)).OrderBy(Rank).ThenBy(Position).First();
                    var path = new HashSet<SyntaxBase>();
                    SyntaxBase? FirstDependency(SyntaxBase node)
                    {
                        if (!path.Add(node)) return null;
                        var missing = pending[node].Where(d => !emitted.Contains(d)).OrderBy(Position).FirstOrDefault();
                        return missing is null ? node : FirstDependency(missing);
                    }
                    // Walk the complete prerequisite closure, including preserved
                    // non-type anchors. Only dependents-first lets unrelated ready
                    // types precede a parent that is still blocked on an import.
                    var typeCandidates = target is TypeDeclarationSyntax && options.BicepTypeOrder == "dependents-first"
                        ? set : Reach(target);
                    next = options.BicepTypeOrder != "preserve"
                        ? typeCandidates.Where(n => n is TypeDeclarationSyntax && !emitted.Contains(n) && pending[n].All(emitted.Contains))
                            .OrderBy(Position).FirstOrDefault()
                        : null;
                    next ??= FirstDependency(target);
                }
                else
                {
                    next = anchors.Where(n => !emitted.Contains(n) && pending[n].All(emitted.Contains))
                        .OrderBy(Rank).ThenBy(Position).FirstOrDefault();
                }
                if (next is null)
                {
                    // Nullable recursive types are legal. Preserve source order inside a
                    // strongly connected type component; no total dependency order exists.
                    foreach (var candidate in anchors.Where(n => !emitted.Contains(n) && n is TypeDeclarationSyntax))
                    {
                        var reachable = Reach(candidate);
                        var component = reachable.Where(n => Reach(n).Contains(candidate)).ToHashSet();
                        if (component.All(n => n is TypeDeclarationSyntax) &&
                            component.All(n => pending[n].All(d => emitted.Contains(d) || component.Contains(d))))
                        {
                            foreach (var member in component) pending[member].ExceptWith(component);
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

        var (priorities, typeEmitted) = TypePriorities(input, dependencies, typeChildren, () => Schedule([], _ => { }));
        return Schedule(priorities, typeEmitted);
    }
}
