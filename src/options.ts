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
    ["multiline", "auto"],
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
    ["description", "inherit"],
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
    "Place variables before their first consumer or in the variable section.",
    ["first-use", "section"],
    "first-use",
  ),
  bicepExistingResourcePlacement: choice(
    "Place existing resources before first use or retain their sequence position.",
    ["first-use", "preserve"],
    "first-use",
  ),
  bicepOutputPlacement: choice(
    "Place direct resource/module outputs after their dependencies or at the end.",
    ["dependency", "end"],
    "dependency",
  ),
  bicepOutputOnlyVariables: choice(
    "Place output-only variables and their outputs at the end or by dependency.",
    ["end", "dependency"],
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
    ["ignore", "wrap"],
    "ignore",
  ),
  bicepDependencyOrder: choice(
    "Resolve dependency ties by choosing the earliest ready declaration or pulling dependencies before the earliest consumer.",
    ["ready-first", "dependencies-first"],
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
    "Keep short unions inline and wrap to width, or put every union member on its own line.",
    ["auto", "multiline"],
    "auto",
  ),
  bicepConditionalHeader: choice(
    "Keep resource/module if headers inline, move if to the next line when long, or always move it.",
    ["inline", "auto", "next-line"],
    "inline",
  ),
  bicepIfConditionLayout: choice(
    "Keep calls in if conditions inline and compact conditional object-loop headers beyond the width target, or allow width-based wrapping.",
    ["inline", "wrap"],
    "inline",
  ),
  bicepLogicalCallLayout: choice(
    "Keep calls in logical if conditions inline for readability, or wrap their arguments to the width target.",
    ["inline", "wrap"],
    "inline",
  ),
  bicepLoopLayout: choice(
    "Compact object-loop headers when they fit or retain expanded brackets.",
    ["auto", "expanded"],
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
