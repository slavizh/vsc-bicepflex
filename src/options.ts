import type { SupportOptions } from "prettier";

export const declarationOrder = [
  "metadata",
  "extension",
  "targetScope",
  "import",
  "type",
  "param",
  "func",
  "var",
  "resource",
  "module",
  "output",
];
export const resourcePropertyOrder = [
  "name",
  "parent",
  "scope",
  "location",
  "dependsOn",
  "tags",
  "identity",
  "kind",
  "sku",
  "zones",
  "plan",
  "*",
  "properties",
];
export const modulePropertyOrder = [
  "name",
  "scope",
  "dependsOn",
  "*",
  "params",
];
export const decoratorOrder = [
  "export",
  "sealed",
  "description",
  "metadata",
  "discriminator",
  "secure",
  "allowed",
  "minLength",
  "maxLength",
  "minValue",
  "maxValue",
  "batchSize",
];

const category = "Bicep";
const boolean = (description: string, value = true) => ({
  type: "boolean" as const,
  category,
  default: value,
  description,
});
const list = (description: string, value: string[]) => ({
  type: "string" as const,
  array: true as const,
  category,
  default: [{ value }],
  description,
});
const choice = <const Value extends string>(
  description: string,
  values: readonly Value[],
  value: NoInfer<Value>,
) => ({
  type: "choice" as const,
  category,
  default: value,
  description,
  choices: values.map((item) => ({ value: item, description: item })),
});

export const options = {
  bicepPrintWidth: {
    type: "int",
    category,
    description:
      "Bicep-only wrapping target. When omitted, inherit printWidth.",
    range: { start: 1, end: 2147483647, step: 1 },
  },
  bicepTabWidth: {
    type: "int",
    category,
    description:
      "Bicep-only indentation width. When omitted, inherit tabWidth.",
    range: { start: 0, end: 1000, step: 1 },
  },
  bicepIndentStyle: choice(
    "Bicep-only indentation style; inherit follows useTabs.",
    ["inherit", "spaces", "tabs"],
    "inherit",
  ),
  bicepSortDeclarations: boolean(
    "Apply section and dependency-aware declaration ordering.",
  ),
  bicepDeclarationOrder: list(
    "Declaration section priorities, listed from first to last.",
    declarationOrder,
  ),
  bicepSortProperties: boolean(
    "Order immediate resource and module body properties.",
  ),
  bicepResourcePropertyOrder: list(
    "Resource property priorities; * marks unlisted properties.",
    resourcePropertyOrder,
  ),
  bicepModulePropertyOrder: list(
    "Module property priorities; * marks unlisted properties.",
    modulePropertyOrder,
  ),
  bicepSortDecorators: boolean("Order recognized built-in decorators."),
  bicepDecoratorOrder: list("Built-in decorator priorities.", decoratorOrder),
  bicepObjectLayout: choice(
    "Layout of nonempty objects and object types.",
    ["multiline", "auto", "preserve"],
    "multiline",
  ),
  bicepArrayLayout: choice(
    "Layout of arrays containing only primitive literals.",
    ["compact", "multiline", "preserve"],
    "compact",
  ),
  bicepDeclarationSpacing: choice(
    "Spacing between declarations.",
    ["separate", "compact", "preserve"],
    "separate",
  ),
  bicepParameterSpacing: choice(
    "Spacing between consecutive Bicep parameter declarations.",
    ["description", "inherit", "preserve"],
    "description",
  ),
  bicepPropertyBlankLines: boolean(
    "Preserve author blank lines between object properties.",
    false,
  ),
  bicepTypeOrder: choice(
    "Order types relative to their referenced types.",
    ["dependents-first", "dependencies-first", "preserve"],
    "dependents-first",
  ),
  bicepFunctionOrder: choice(
    "Order functions relative to called functions.",
    ["dependencies-first", "dependents-first", "preserve"],
    "dependencies-first",
  ),
  bicepVariablePlacement: choice(
    "Place variables before first use, in the variable section, or in dependency-safe source order.",
    ["first-use", "section", "preserve"],
    "first-use",
  ),
  bicepExistingResourcePlacement: choice(
    "Place existing resources before first use or retain their sequence position.",
    ["first-use", "preserve"],
    "first-use",
  ),
  bicepOutputPlacement: choice(
    "Place resource/module outputs after dependencies, at the end, or in dependency-safe source order.",
    ["dependency", "end", "preserve"],
    "dependency",
  ),
  bicepOutputOnlyVariables: choice(
    "Place output-only variables and outputs at the end, by dependency, or in dependency-safe source order.",
    ["end", "dependency", "preserve"],
    "end",
  ),
  bicepNestedResources: choice(
    "Place nested resource declarations after properties or preserve their positions.",
    ["last", "preserve"],
    "last",
  ),
  bicepQuoteProperties: choice(
    "Quoting of plain identifier property names.",
    ["as-needed", "preserve"],
    "as-needed",
  ),
  bicepLambdaParentheses: choice(
    "Parentheses for single-parameter lambdas.",
    ["avoid", "always", "preserve"],
    "avoid",
  ),
  bicepDescriptionWidth: choice(
    "Whether description decorators respect the width target.",
    ["ignore", "wrap", "preserve"],
    "ignore",
  ),
  bicepDependencyOrder: choice(
    "Resolve dependency ties by earliest readiness, proximity to consumers, or dependency-safe source order.",
    ["ready-first", "dependencies-first", "preserve"],
    "ready-first",
  ),
  bicepUnusedDeclarations: choice(
    "Keep unused variables/existing resources fixed or allow section ordering.",
    ["boundary", "section"],
    "boundary",
  ),
  bicepSectionComments: choice(
    "Keep blank-line-separated headings fixed or move them with the following declaration.",
    ["boundary", "attached"],
    "boundary",
  ),
  bicepIgnoredDeclarations: choice(
    "Allow ignored declarations to move without changing their text, or fix their position.",
    ["move", "boundary"],
    "move",
  ),
  bicepResourceModuleOrder: choice(
    "Combine resources/modules into one section or use their separate declaration priorities.",
    ["combined", "separate"],
    "combined",
  ),
  bicepImportSpacing: choice(
    "Spacing between consecutive imports; inherit follows declaration spacing.",
    ["compact", "separate", "preserve", "inherit"],
    "compact",
  ),
  bicepUnionLayout: choice(
    "Keep unions width-aware, multiline, or in their authored member layout.",
    ["auto", "multiline", "preserve"],
    "auto",
  ),
  bicepConditionalHeader: choice(
    "Keep direct if headers inline, move when long, always move, or retain authored placement.",
    ["inline", "auto", "next-line", "preserve"],
    "inline",
  ),
  bicepIfConditionLayout: choice(
    "Keep if-condition calls and conditional loop headers inline, width-aware, or authored.",
    ["inline", "wrap", "preserve"],
    "inline",
  ),
  bicepLogicalCallLayout: choice(
    "Keep calls under && or || inline, width-aware, or in their authored layout.",
    ["inline", "wrap", "preserve"],
    "inline",
  ),
  bicepLoopLayout: choice(
    "Compact fitting object-loop brackets, expand them, or retain authored shape.",
    ["auto", "expanded", "preserve"],
    "auto",
  ),
  bicepImportMemberOrder: choice(
    "Keep imported symbol order or sort by the original imported name.",
    ["preserve", "alphabetical"],
    "preserve",
  ),
  bicepTypeMemberOrder: choice(
    "Keep object-type property order or put required properties before nullable/optional properties.",
    ["preserve", "required-first"],
    "preserve",
  ),
} satisfies SupportOptions;

type OptionValue<T> = T extends { array: true }
  ? string[]
  : T extends { type: "boolean" }
    ? boolean
    : T extends { type: "int" }
      ? number
      : T extends { choices: Array<{ value: infer Value }> }
        ? Value
        : string;

export type BicepOptions = {
  [Key in keyof typeof options]?: OptionValue<(typeof options)[Key]>;
};
