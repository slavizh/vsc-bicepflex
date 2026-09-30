using Bicep.Core.PrettyPrintV2;

sealed record FormatOptions
{
    public int PrintWidth { get; init; } = 180;
    public int TabWidth { get; init; } = 2;
    public bool UseTabs { get; init; }
    public int? BicepPrintWidth { get; init; }
    public int? BicepTabWidth { get; init; }
    public string BicepIndentStyle { get; init; } = "inherit";
    public bool BicepSortDeclarations { get; init; } = true;
    public string[] BicepDeclarationOrder { get; init; } = ["metadata", "extension", "targetScope", "import", "type", "param", "func", "var", "resource", "module", "output"];
    public bool BicepSortProperties { get; init; } = true;
    public string[] BicepResourcePropertyOrder { get; init; } = ["name", "parent", "scope", "location", "dependsOn", "tags", "identity", "kind", "sku", "zones", "plan", "*", "properties"];
    public string[] BicepModulePropertyOrder { get; init; } = ["name", "scope", "dependsOn", "*", "params"];
    public bool BicepSortDecorators { get; init; } = true;
    public string[] BicepDecoratorOrder { get; init; } = ["export", "sealed", "description", "metadata", "discriminator", "secure", "allowed", "minLength", "maxLength", "minValue", "maxValue", "batchSize"];
    public string BicepObjectLayout { get; init; } = "multiline";
    public string BicepArrayLayout { get; init; } = "compact";
    public string BicepDeclarationSpacing { get; init; } = "separate";
    public string BicepParameterSpacing { get; init; } = "description";
    public bool BicepPropertyBlankLines { get; init; }
    public string BicepTypeOrder { get; init; } = "dependents-first";
    public string BicepFunctionOrder { get; init; } = "dependencies-first";
    public string BicepVariablePlacement { get; init; } = "first-use";
    public string BicepExistingResourcePlacement { get; init; } = "first-use";
    public string BicepOutputPlacement { get; init; } = "dependency";
    public string BicepOutputOnlyVariables { get; init; } = "end";
    public string BicepNestedResources { get; init; } = "last";
    public string BicepQuoteProperties { get; init; } = "as-needed";
    public string BicepLambdaParentheses { get; init; } = "avoid";
    public string BicepDescriptionWidth { get; init; } = "ignore";
    public string BicepDependencyOrder { get; init; } = "ready-first";
    public string BicepUnusedDeclarations { get; init; } = "boundary";
    public string BicepSectionComments { get; init; } = "boundary";
    public string BicepIgnoredDeclarations { get; init; } = "move";
    public string BicepResourceModuleOrder { get; init; } = "combined";
    public string BicepImportSpacing { get; init; } = "compact";
    public string BicepUnionLayout { get; init; } = "auto";
    public string BicepConditionalHeader { get; init; } = "inline";
    public string BicepIfConditionLayout { get; init; } = "inline";
    public string BicepLogicalCallLayout { get; init; } = "inline";
    public string BicepLoopLayout { get; init; } = "auto";
    public string BicepImportMemberOrder { get; init; } = "preserve";
    public string BicepTypeMemberOrder { get; init; } = "preserve";

    public PrettyPrinterV2Options Printer => new(
        UseTabs ? IndentKind.Tab : IndentKind.Space, NewlineKind.LF, TabWidth, PrintWidth, true);

    public FormatOptions ResolveLayout()
    {
        if (BicepPrintWidth is < 1)
            throw new FormatException("bicepPrintWidth must be a positive integer, or omitted to inherit printWidth.");
        if (BicepTabWidth is < 0 or > 1000)
            throw new FormatException("bicepTabWidth must be between 0 and 1000, or omitted to inherit tabWidth.");
        if (BicepIndentStyle is not ("inherit" or "spaces" or "tabs"))
            throw new FormatException("bicepIndentStyle must be inherit, spaces, or tabs.");
        return this with
        {
            PrintWidth = BicepPrintWidth ?? PrintWidth,
            TabWidth = BicepTabWidth ?? TabWidth,
            UseTabs = BicepIndentStyle == "inherit" ? UseTabs : BicepIndentStyle == "tabs",
        };
    }

    public static string[] List(string[] value)
    {
        if (value is null || value.Any(item => string.IsNullOrWhiteSpace(item) ||
            !System.Text.RegularExpressions.Regex.IsMatch(item, @"^(?:\*|[A-Za-z_][A-Za-z0-9_]*)$")))
        {
            throw new FormatException("Ordering settings must be JSON arrays of nonempty names, not comma-separated strings. For example: [\"name\", \"*\", \"properties\"].");
        }
        var result = value;
        if (result.Length == 0 || result.Distinct(StringComparer.Ordinal).Count() != result.Length)
        {
            throw new FormatException("Ordering lists must be nonempty and must not contain duplicates.");
        }
        return result;
    }

    public void Validate()
    {
        if (BicepIfConditionLayout is not ("inline" or "wrap"))
        {
            throw new FormatException("bicepIfConditionLayout must be inline or wrap.");
        }
        if (BicepLogicalCallLayout is not ("inline" or "wrap"))
        {
            throw new FormatException("bicepLogicalCallLayout must be inline or wrap.");
        }
        if (BicepParameterSpacing is not ("description" or "inherit"))
        {
            throw new FormatException("bicepParameterSpacing must be description or inherit.");
        }
        if (PrintWidth < 1 || TabWidth < 0 || TabWidth > 1000)
        {
            throw new FormatException("printWidth must be positive and tabWidth must be between 0 and 1000.");
        }
        foreach (var list in new[] { BicepDeclarationOrder, BicepResourcePropertyOrder, BicepModulePropertyOrder, BicepDecoratorOrder })
        {
            _ = List(list);
        }
        var sections = List(BicepDeclarationOrder);
        string[] known = ["metadata", "extension", "targetScope", "import", "type", "param", "func", "var", "resource", "module", "output", "using", "extends", "test", "assert"];
        if (sections.Except(known).Any())
        {
            throw new FormatException("bicepDeclarationOrder contains an unknown declaration kind.");
        }
        string[] decorators = ["export", "sealed", "description", "metadata", "discriminator", "secure", "allowed", "minLength", "maxLength", "minValue", "maxValue", "batchSize"];
        if (BicepDecoratorOrder.Except(decorators).Any())
        {
            throw new FormatException("bicepDecoratorOrder contains an unknown built-in decorator. Unknown decorators must remain ordering boundaries.");
        }
    }
}
