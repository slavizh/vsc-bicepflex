import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { options } from "../dist/options.js";
import { defaultOptions } from "../dist/index.js";

const properties = {};
for (const [name, option] of Object.entries(options)) {
  properties[name] = option.array
    ? {
        type: "array",
        items: {
          type: "string",
          minLength: 1,
          pattern: "^(?:\\*|[A-Za-z_][A-Za-z0-9_]*)$",
        },
        minItems: 1,
        uniqueItems: true,
        default: option.default[0].value,
        description: option.description,
      }
    : {
        type:
          option.type === "boolean"
            ? "boolean"
            : option.type === "int"
              ? "integer"
              : "string",
        ...(option.range
          ? { minimum: option.range.start, maximum: option.range.end }
          : {}),
        ...(option.choices
          ? { enum: option.choices.map((choice) => choice.value) }
          : {}),
        default: option.default,
        description: option.description,
      };
}
properties.bicepDeclarationOrder.items.enum = [
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
  "using",
  "extends",
  "test",
  "assert",
];
properties.bicepDecoratorOrder.items.enum =
  options.bicepDecoratorOrder.default[0].value;
Object.assign(properties, {
  printWidth: {
    type: "integer",
    minimum: 1,
    default: defaultOptions.printWidth,
  },
  tabWidth: {
    type: "integer",
    minimum: 0,
    maximum: 1000,
    default: defaultOptions.tabWidth,
  },
  useTabs: { type: "boolean", default: defaultOptions.useTabs },
  endOfLine: {
    type: "string",
    enum: ["auto", "lf", "crlf", "cr"],
    default: defaultOptions.endOfLine,
  },
  overrides: {
    type: "array",
    items: {
      type: "object",
      properties: { options: { $ref: "#/$defs/configuration" } },
    },
  },
});
const layoutDescriptions = {
  printWidth:
    "Wrapping target for Bicep files when bicepPrintWidth is not set.",
  tabWidth: "Indentation width for Bicep files when bicepTabWidth is not set.",
  useTabs: "Use tabs for indentation when bicepIndentStyle is inherit.",
  endOfLine: "Line ending convention for formatted Bicep files.",
};
const settingsOrder = [
  "bicepObjectLayout",
  "bicepArrayLayout",
  "bicepPrintWidth",
  "bicepTabWidth",
  "bicepIndentStyle",
  "printWidth",
  "tabWidth",
  "useTabs",
  "endOfLine",
  "bicepDeclarationSpacing",
  "bicepPropertyBlankLines",
  "bicepSortDeclarations",
  "bicepDeclarationOrder",
  "bicepSortProperties",
  "bicepResourcePropertyOrder",
  "bicepModulePropertyOrder",
  "bicepSortDecorators",
  "bicepDecoratorOrder",
  "bicepVariablePlacement",
  "bicepExistingResourcePlacement",
  "bicepOutputPlacement",
  "bicepOutputOnlyVariables",
  "bicepResourceModuleOrder",
  "bicepTypeOrder",
  "bicepFunctionOrder",
  "bicepNestedResources",
  "bicepImportSpacing",
  "bicepUnionLayout",
  "bicepConditionalHeader",
  "bicepLogicalCallLayout",
  "bicepLoopLayout",
  "bicepQuoteProperties",
  "bicepLambdaParentheses",
  "bicepDescriptionWidth",
  "bicepDependencyOrder",
  "bicepUnusedDeclarations",
  "bicepSectionComments",
  "bicepIgnoredDeclarations",
  "bicepImportMemberOrder",
  "bicepTypeMemberOrder",
];
const choiceDescriptions = {
  bicepIndentStyle: {
    inherit: "follow useTabs",
    spaces: "indent with spaces",
    tabs: "indent with tabs",
  },
  bicepObjectLayout: {
    multiline: "expand nonempty objects and object types",
    auto: "keep compact source objects on one line when they fit",
  },
  bicepArrayLayout: {
    compact: "fit arrays of primitive literals on one line",
    multiline: "expand arrays of primitive literals",
    preserve: "retain the source layout when width permits",
  },
  bicepDeclarationSpacing: {
    separate: "insert one blank line between declarations",
    compact: "remove blank lines between declarations",
    preserve: "retain author spacing where safe",
  },
  bicepTypeOrder: {
    "dependents-first": "put referencing types first",
    "dependencies-first": "put referenced types first",
    preserve: "retain source order within the type section",
  },
  bicepFunctionOrder: {
    "dependencies-first": "put called functions before callers",
    "dependents-first": "put callers before called functions",
    preserve: "retain source order within the function section",
  },
  bicepVariablePlacement: {
    "first-use": "place used variables before their first consumer",
    section: "keep variables in the configured variable section",
  },
  bicepExistingResourcePlacement: {
    "first-use": "place used existing resources before first use",
    preserve: "retain their position in dependency-safe resource order",
  },
  bicepOutputPlacement: {
    dependency: "place resource/module outputs after their dependencies",
    end: "leave outputs in the configured output section",
  },
  bicepOutputOnlyVariables: {
    end: "keep output-only variables with outputs at the end",
    dependency: "allow placement next to their dependencies",
  },
  bicepNestedResources: {
    last: "place nested resources after ordinary properties",
    preserve: "keep them as boundaries between property sections",
  },
  bicepQuoteProperties: {
    "as-needed": "remove optional quotes around identifier keys",
    preserve: "retain source quoting",
  },
  bicepLambdaParentheses: {
    avoid: "omit optional parentheses around one lambda parameter",
    always: "add parentheses around one lambda parameter",
    preserve: "retain the source choice",
  },
  bicepDescriptionWidth: {
    ignore: "leave descriptions inline regardless of width",
    wrap: "wrap long description calls without reflowing their strings",
  },
  bicepDependencyOrder: {
    "ready-first": "choose the earliest currently ready declaration",
    "dependencies-first": "pull prerequisites before the earliest consumer",
  },
  bicepUnusedDeclarations: {
    boundary: "keep unused variables and existing resources in place",
    section: "allow them to move within their sections",
  },
  bicepSectionComments: {
    boundary: "keep blank-line-separated headings in place",
    attached: "move headings with the next declaration",
  },
  bicepIgnoredDeclarations: {
    move: "allow ignored declarations to move without changing their text",
    boundary: "keep ignored declarations in place",
  },
  bicepResourceModuleOrder: {
    combined: "place resources and modules in one section",
    separate: "respect their separate section priorities",
  },
  bicepImportSpacing: {
    compact: "remove blank lines between imports",
    separate: "insert a blank line between imports",
    preserve: "retain author spacing",
    inherit: "follow declaration spacing",
  },
  bicepUnionLayout: {
    auto: "keep short unions inline and wrap long ones",
    multiline: "put each union member on a separate line",
  },
  bicepConditionalHeader: {
    inline: "keep direct resource/module if headers inline",
    auto: "move if to the next line only when the header exceeds width",
    "next-line": "always put if on the next line",
  },
  bicepLogicalCallLayout: {
    inline: "keep calls within && and || conditions on one line",
    wrap: "wrap call arguments in logical conditions to the width target",
  },
  bicepLoopLayout: {
    auto: "compact object-loop headers when they fit",
    expanded: "retain expanded native brackets",
  },
  bicepImportMemberOrder: {
    preserve: "retain imported symbol order",
    alphabetical: "sort by original imported name",
  },
  bicepTypeMemberOrder: {
    preserve: "retain object-type member order",
    "required-first": "place syntactically nullable members last",
  },
  endOfLine: {
    auto: "preserve the detected line ending convention",
    lf: "use LF line endings",
    crlf: "use CRLF line endings",
    cr: "use CR line endings",
  },
};
const configurableNames = Object.keys(properties).filter(
  (name) => name !== "overrides",
);
if (
  settingsOrder.length !== configurableNames.length ||
  new Set(settingsOrder).size !== settingsOrder.length ||
  settingsOrder.some((name) => !configurableNames.includes(name))
) {
  throw new Error("The VS Code settings order must include every option once.");
}
for (const [name, property] of Object.entries(properties)) {
  if (name === "overrides") continue;
  if (property.enum) {
    const meanings = choiceDescriptions[name];
    if (
      !meanings ||
      property.enum.length !== Object.keys(meanings).length ||
      property.enum.some((value) => !meanings[value])
    ) {
      throw new Error(`Describe every value of ${name} in VS Code settings.`);
    }
    property.enumDescriptions = property.enum.map((value) => meanings[value]);
  }
  const inheritedDefault =
    name === "bicepPrintWidth"
      ? defaultOptions.printWidth
      : name === "bicepTabWidth"
        ? defaultOptions.tabWidth
        : undefined;
  const defaultDescription =
    inheritedDefault !== undefined
      ? `${inheritedDefault} in the Settings UI; when unset, inherits ${name === "bicepPrintWidth" ? "printWidth" : "tabWidth"}`
      : JSON.stringify(property.default);
  property.description = `${property.description ?? layoutDescriptions[name]}${property.enum ? ` Choices: ${property.enum.map((value) => `"${value}" — ${choiceDescriptions[name][value]}`).join("; ")}.` : ""} Default: ${defaultDescription}.`;
}
const configuration = {
  type: "object",
  properties,
  propertyNames: {
    anyOf: [{ not: { pattern: "^bicep" } }, { enum: Object.keys(options) }],
  },
  additionalProperties: true,
};
const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Prettier Bicep configuration",
  description:
    "Bicep plugin options plus standard layout settings. Other Prettier/plugin settings are allowed.",
  $ref: "#/$defs/configuration",
  $defs: { configuration },
};
const example = {
  ...defaultOptions,
  ...Object.fromEntries(
    Object.keys(options).map((name) => [name, properties[name].default]),
  ),
};
const manifestPath = fileURLToPath(
  new URL("../packages/vscode/package.json", import.meta.url),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const configurationSettings = manifest.contributes.configuration.properties;
configurationSettings["bicepFlex.preset"].description =
  'Choose a formatting policy. "opinionated" — use dependency-aware ordering; "minimal" — avoid optional declaration and property reordering. Default: "opinionated".';
configurationSettings["bicepFlex.preset"].enumDescriptions = [
  "Use dependency-aware ordering and the standard layout.",
  "Avoid optional declaration, property, and decorator reordering.",
];
configurationSettings["bicepFlex.preset"].order = 1;
for (const [name, property] of Object.entries(properties)) {
  if (name === "overrides") continue;
  const inheritedDefault =
    name === "bicepPrintWidth"
      ? defaultOptions.printWidth
      : name === "bicepTabWidth"
        ? defaultOptions.tabWidth
        : undefined;
  configurationSettings[`bicepFlex.${name}`] = {
    ...property,
    ...(inheritedDefault !== undefined ? { default: inheritedDefault } : {}),
    order: settingsOrder.indexOf(name) + 2,
  };
}
manifest.contributes.configuration.properties = Object.fromEntries(
  Object.entries(configurationSettings).sort(
    ([, left], [, right]) => left.order - right.order,
  ),
);
const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (
    (await readFile(manifestPath, "utf8")).replace(/\r\n/g, "\n") !==
    manifestContent
  )
    throw new Error(
      "Extension options are stale. Run npm run configuration:generate.",
    );
} else {
  await writeFile(manifestPath, manifestContent);
}
for (const [name, value] of [
  ["configuration.schema.json", schema],
  ["configuration.example.json", example],
  ["packages/vscode/schemas/prettier.schema.json", schema],
]) {
  const content = JSON.stringify(value, null, 2) + "\n";
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")).replace(/\r\n/g, "\n") !== content)
      throw new Error(`${name} is stale. Run npm run configuration:generate.`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
