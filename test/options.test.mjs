import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { format, getSupportInfo } from "prettier";
import plugin from "../dist/index.js";
import { options as definitions } from "../dist/options.js";

const filepath = resolve("test", "fixtures", "options.bicep");
async function stable(source, settings = {}) {
  const options = { plugins: [plugin], filepath, endOfLine: "lf", ...settings };
  const output = await format(source, options);
  assert.equal(
    await format(output, options),
    output,
    "custom settings must be idempotent",
  );
  return output;
}
const names = (text) =>
  [
    ...text.matchAll(
      /^(?:resource|module|var|param|output|type|func)\s+(\w+)/gm,
    ),
  ].map((m) => m[1]);
const resource = (name, body = "") =>
  `resource ${name} 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={name:'${name}',location:'westeurope'${body ? "," + body : ""}}\n`;
const module = (name) =>
  `module ${name} './consumer.bicep'={name:'${name}',params:{parentId:'id'}}\n`;

test("Prettier exposes ordering as arrays with usable array defaults", async () => {
  const info = await getSupportInfo({ plugins: [plugin] });
  for (const name of [
    "bicepDeclarationOrder",
    "bicepResourcePropertyOrder",
    "bicepModulePropertyOrder",
    "bicepDecoratorOrder",
  ]) {
    const option = info.options.find((o) => o.name === name);
    assert.equal(option.array, true);
    assert.ok(Array.isArray(option.default), name);
    assert.ok(option.default.every((v) => typeof v === "string"));
  }
});

test("array priorities reach the native bridge for all four order lists", async () => {
  const source =
    "metadata description='Example'\n@description('Name')\n@minLength(1)\nparam name string='test'\n" +
    resource("identity", "tags:{name:name}") +
    module("consumer");
  const output = await stable(source, {
    bicepDeclarationOrder: ["param", "metadata", "module", "resource"],
    bicepResourceModuleOrder: "separate",
    bicepResourcePropertyOrder: ["tags", "*", "name"],
    bicepModulePropertyOrder: ["params", "*", "name"],
    bicepDecoratorOrder: ["minLength", "description"],
  });
  assert.ok(
    output.startsWith("@minLength(1)\n@description('Name')\nparam name"),
  );
  assert.deepEqual(names(output), ["name", "consumer", "identity"]);
  assert.match(output, /resource identity[^\n]+\{\n  tags:/);
  assert.match(output, /module consumer[^\n]+\{\n  params:/);
});

test("string priorities, empty lists, duplicate entries and unknown sections fail clearly", async () => {
  for (const value of [
    "name,properties",
    ["name,properties"],
    [],
    ["name", "name"],
    [" name"],
    [""],
  ]) {
    await assert.rejects(
      stable("param name string\n", { bicepResourcePropertyOrder: value }),
      /array|nonempty|duplicates|names/i,
    );
  }
  await assert.rejects(
    stable("param name string\n", { bicepDeclarationOrder: ["typo"] }),
    /unknown declaration kind/,
  );
});

test("dependency tie policies select distinct safe orders", async () => {
  const input =
    resource("consumer", "tags:{id:dependency.id}") +
    resource("unrelated") +
    resource("dependency");
  assert.deepEqual(names(await stable(input)), [
    "unrelated",
    "dependency",
    "consumer",
  ]);
  assert.deepEqual(
    names(await stable(input, { bicepDependencyOrder: "dependencies-first" })),
    ["dependency", "consumer", "unrelated"],
  );
});

test("unused declarations can form boundaries or move to their configured section", async () => {
  const source =
    resource("first") +
    "var unused='keep'\nparam name string\n" +
    resource("last");
  assert.deepEqual(names(await stable(source)), [
    "first",
    "unused",
    "name",
    "last",
  ]);
  assert.deepEqual(
    names(await stable(source, { bicepUnusedDeclarations: "section" })),
    ["name", "unused", "first", "last"],
  );
});

test("section headings can stay fixed or move with their following declaration", async () => {
  const source = resource("first") + "// Parameters\n\nparam name string\n";
  assert.deepEqual(names(await stable(source)), ["first", "name"]);
  const output = await stable(source, { bicepSectionComments: "attached" });
  assert.deepEqual(names(output), ["name", "first"]);
  assert.ok(output.startsWith("// Parameters\n\nparam name"));
});

test("ignored declarations can move or stay fixed while their text is preserved", async () => {
  const exact = "var tags={ environment:'dev' }";
  const source =
    "// prettier-ignore\n" +
    exact +
    "\n" +
    resource("first") +
    resource("second", "tags:tags");
  const move = await stable(source);
  const fixed = await stable(source, { bicepIgnoredDeclarations: "boundary" });
  assert.deepEqual(names(move), ["first", "tags", "second"]);
  assert.deepEqual(names(fixed), ["tags", "first", "second"]);
  assert.ok(move.includes(exact) && fixed.includes(exact));
});

test("resources and modules may share a section or use separate priorities without breaking dependencies", async () => {
  const source = module("consumer") + resource("identity");
  assert.deepEqual(names(await stable(source)), ["consumer", "identity"]);
  assert.deepEqual(
    names(await stable(source, { bicepResourceModuleOrder: "separate" })),
    ["identity", "consumer"],
  );
  const dependency =
    resource("consumer", "tags:{id:dependency.outputs.id}") +
    "module dependency './consumer.bicep'={name:'dependency',params:{parentId:'id'}}\n";
  assert.deepEqual(
    names(await stable(dependency, { bicepResourceModuleOrder: "separate" })),
    ["dependency", "consumer"],
  );
});

test("import spacing is independently selectable and inherits declaration spacing when requested", async () => {
  const source =
    "import { First } from './import-types.bicep'\n\nimport { Second } from './import-types.bicep'\nparam name First\n";
  const compact = await stable(source, { bicepImportSpacing: "compact" });
  assert.ok(compact.includes("bicep'\nimport"));
  for (const settings of [
    { bicepImportSpacing: "separate", bicepDeclarationSpacing: "compact" },
    { bicepImportSpacing: "preserve" },
    { bicepImportSpacing: "inherit", bicepDeclarationSpacing: "separate" },
  ]) {
    assert.ok((await stable(source, settings)).includes("bicep'\n\nimport"));
  }
});

test("union layout can force short unions onto separate lines, including nested types", async () => {
  const source =
    "type Choice='one'|'two'\ntype Config={value:'a'|'b',nested:('x'|'y')[]}\nparam choice Choice\nparam config Config\n";
  const auto = await stable(source);
  assert.ok(auto.includes("type Choice = 'one' | 'two'"));
  const multiline = await stable(source, { bicepUnionLayout: "multiline" });
  assert.match(multiline, /type Choice =\n  \| 'one'\n  \| 'two'/);
  assert.match(multiline, /value:\n    \| 'a'\n    \| 'b'/);
});

test("conditional headers support inline, width-aware and always-next-line layouts", async () => {
  const source =
    "param deploy bool=true\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(deploy){name:'identity',location:'westeurope'}\n";
  assert.match(
    await stable(source, { printWidth: 180 }),
    / = if \(deploy\) \{\n  name:/,
  );
  assert.match(
    await stable(source, { printWidth: 60 }),
    / =\n  if \(deploy\) \{\n  name:/,
  );
  assert.match(
    await stable(source, { bicepConditionalHeader: "inline", printWidth: 60 }),
    / = if \(deploy\) \{\n  name:/,
  );
  assert.match(
    await stable(source, { bicepConditionalHeader: "next-line" }),
    / =\n  if \(deploy\) \{\n    name:/,
  );
  assert.match(
    await stable(source, { bicepConditionalHeader: "auto", printWidth: 60 }),
    / =\n  if \(deploy\) \{/,
  );
  assert.match(
    await stable(source, { bicepConditionalHeader: "auto", printWidth: 180 }),
    / = if \(deploy\) \{/,
  );
});

test("loop layout can expand short loops or compact them when they fit", async () => {
  const source = "output items array=[for item in ['hello']:{value:item}]\n";
  assert.match(
    await stable(source, { bicepLoopLayout: "expanded" }),
    / = \[\n  for/,
  );
  assert.match(
    await stable(source, { bicepLoopLayout: "auto" }),
    / = \[for item in \['hello'\]: \{\n  value:/,
  );
});

test("import members sort by original name without changing aliases", async () => {
  const source =
    "import { Second as Count, First as Label } from './import-types.bicep'\nparam name Label\nparam count Count\n";
  assert.match(
    await stable(source, { bicepImportMemberOrder: "alphabetical" }),
    /import \{ First as Label, Second as Count \}/,
  );
});

test("required type members can precede optional members with decorators attached", async () => {
  const source =
    "type Config={@description('optional')\noptional:string?,required:string,other:bool?}\nparam config Config\n";
  const output = await stable(source, {
    bicepTypeMemberOrder: "required-first",
  });
  assert.match(
    output,
    /required: string\n  @description\('optional'\)\n  optional: string\?\n  other: bool\?/,
  );
});

test("function callers may precede helpers and lambda parentheses may be required", async () => {
  const source =
    "func helper(x string) string=>toLower(x)\nfunc caller(x string) string=>helper(x)\noutput name string=caller('HI')\noutput items array=map(['A'], x=>toLower(x))\n";
  const output = await stable(source, {
    bicepFunctionOrder: "dependents-first",
    bicepLambdaParentheses: "always",
  });
  assert.deepEqual(names(output).slice(0, 2), ["caller", "helper"]);
  assert.ok(output.includes("map(['A'], (x) => toLower(x))"));
});

test("every declared choice rejects unsupported values instead of silently selecting a fallback", async () => {
  for (const [name, option] of Object.entries(definitions)) {
    if (option.type === "choice") {
      await assert.rejects(
        format("param name string\n", {
          plugins: [plugin],
          parser: "bicep",
          [name]: "not-a-choice",
        }),
        undefined,
        name,
      );
    }
  }
});

test("description width wraps the call without reflowing the string", async () => {
  const text = "Keep this description exactly as written. ".repeat(4);
  const source = `@description('${text}')\nparam name string\n`;
  assert.ok(
    (await stable(source, { printWidth: 40 })).startsWith(
      `@description('${text}')`,
    ),
  );
  assert.ok(
    (
      await stable(source, { printWidth: 40, bicepDescriptionWidth: "wrap" })
    ).startsWith(`@description(\n  '${text}'\n)\nparam name`),
  );
});

test("array and object layout alternatives have visible and stable effects", async () => {
  const source =
    "output values array=['one','two']\noutput object object={name:'value'}\n";
  const expanded = await stable(source, { bicepArrayLayout: "multiline" });
  assert.match(expanded, /output values array = \[\n  'one'\n  'two'\n\]/);
  const compact = await stable(source, { bicepObjectLayout: "auto" });
  assert.ok(compact.includes("output object object = { name: 'value' }"));
  const preserve = await stable("output values array=[\n'one'\n 'two'\n]\n", {
    bicepArrayLayout: "preserve",
  });
  assert.ok(preserve.includes("array = [\n"));
  const blanks = await stable("output value object={a:1\n\nb:2}\n", {
    bicepPropertyBlankLines: true,
  });
  assert.ok(blanks.includes("a: 1\n\n  b: 2"));
});

test("helper and output placement alternatives are honored", async () => {
  const source =
    "var tags={env:'dev'}\n" +
    resource("first") +
    resource("second", "tags:tags") +
    "output id string=first.id\n";
  assert.deepEqual(
    names(
      await stable(source, {
        bicepVariablePlacement: "section",
        bicepOutputPlacement: "end",
      }),
    ),
    ["tags", "first", "second", "id"],
  );
  const outputOnly =
    resource("first") +
    resource("second") +
    "var id=first.id\noutput value string=id\n";
  assert.deepEqual(
    names(await stable(outputOnly, { bicepOutputOnlyVariables: "dependency" })),
    ["first", "id", "value", "second"],
  );
  const existing =
    "resource reference 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing={name:'reference'}\n" +
    resource("first") +
    resource("second", "tags:{id:reference.id}");
  assert.deepEqual(
    names(
      await stable(existing, { bicepExistingResourcePlacement: "preserve" }),
    ),
    ["reference", "first", "second"],
  );
});

test("type ordering alternatives and sorting switches are honored", async () => {
  const source =
    "type Referencing={value:Referenced}\ntype Referenced=string\nparam value Referencing\n";
  assert.deepEqual(
    names(await stable(source, { bicepTypeOrder: "dependencies-first" })),
    ["Referenced", "Referencing", "value"],
  );
  assert.deepEqual(
    names(await stable(source, { bicepTypeOrder: "preserve" })),
    ["Referencing", "Referenced", "value"],
  );
  const decorated = "@minLength(1)\n@description('Name')\nparam name string\n";
  assert.ok(
    (await stable(decorated, { bicepSortDecorators: false })).startsWith(
      "@minLength(1)\n@description",
    ),
  );
  const unsorted =
    "resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={location:'westeurope',name:'identity'}\n";
  assert.match(
    await stable(unsorted, { bicepSortProperties: false }),
    /\{\n  location:.*\n  name:/,
  );
  assert.deepEqual(
    names(
      await stable(module("consumer") + resource("identity"), {
        bicepSortDeclarations: false,
        bicepResourceModuleOrder: "separate",
      }),
    ),
    ["consumer", "identity"],
  );
});

test("combined nondefault layout choices preserve comments and multiline string values", async () => {
  const literal = "'''\n    content\n  stays here\n'''";
  const source = `param enabled bool=true\ntype Choice='one'|'two'\nparam choice Choice='one'\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(enabled){name:'identity',location:'westeurope',tags:{description:${literal}}}\n`;
  const output = await stable(source, {
    bicepConditionalHeader: "next-line",
    bicepUnionLayout: "multiline",
    useTabs: true,
  });
  assert.ok(output.includes(literal));
  assert.match(output, /=\n\tif \(enabled\) \{\n\t\tname:/);
});

test("dependency-first ties handle recursive type components stably", async () => {
  const source =
    "type First={next:Second?}\ntype Second={next:First?}\ntype Independent=string\nparam value First\n";
  for (const bicepTypeOrder of [
    "dependents-first",
    "dependencies-first",
    "preserve",
  ]) {
    const output = await stable(source, {
      bicepTypeOrder,
      bicepDependencyOrder: "dependencies-first",
    });
    assert.deepEqual(names(output), [
      "First",
      "Second",
      "Independent",
      "value",
    ]);
  }
});

test("description wrapping preserves namespaced calls, comments and multiline literal contents", async () => {
  const literal = "'''\n  Keep these\n    spaces exactly.\n'''";
  const source = `@sys.description(${literal})\nparam value string\n`;
  const output = await stable(source, {
    bicepDescriptionWidth: "wrap",
    printWidth: 30,
  });
  assert.ok(output.includes(literal));
  assert.ok(output.startsWith("@sys.description(\n"));
  const commented =
    "@description(/* do not remove */ 'A long description that exceeds the configured width.')\nparam value string\n";
  assert.ok(
    (
      await stable(commented, { bicepDescriptionWidth: "wrap", printWidth: 30 })
    ).includes("/* do not remove */"),
  );
});
