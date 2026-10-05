import assert from "node:assert/strict";
import test from "node:test";
import { format } from "prettier";
import plugin from "../dist/index.js";

async function stable(source, settings) {
  const options = { plugins: [plugin], parser: "bicep", ...settings };
  const result = await format(source, options);
  assert.equal(await format(result, options), result);
  return result;
}

test("preserve keeps authored object and array shapes beyond print width", async () => {
  const options = {
    printWidth: 12,
    bicepObjectLayout: "preserve",
    bicepArrayLayout: "preserve",
  };
  assert.equal(
    await stable("var v={a:1,b:2}\n", options),
    "var v = { a: 1, b: 2 }\n",
  );
  assert.equal(
    await stable("var a=['first','second','third']\n", options),
    "var a = ['first', 'second', 'third']\n",
  );
  assert.equal(
    await stable("var v={\na:1\nb:2\n}\n", { ...options, printWidth: 200 }),
    "var v = {\n  a: 1\n  b: 2\n}\n",
  );
  assert.equal(
    await stable("var a=[\n'first'\n'second'\n]\n", {
      ...options,
      printWidth: 200,
    }),
    "var a = [\n  'first'\n  'second'\n]\n",
  );
  assert.equal(
    await stable("var v={\nleft:{a:1,b:2}\nright:{c:3,d:4}\n}\n", options),
    "var v = {\n  left: { a: 1, b: 2 }\n  right: { c: 3, d: 4 }\n}\n",
  );
  assert.equal(
    await stable("// prettier-ignore\nvar v={a:1,b:2}\n", options),
    "// prettier-ignore\nvar v={a:1,b:2}\n",
  );
});

test("preserve retains individual union breaks and authored description layout", async () => {
  assert.equal(
    await stable("type V='one'|'two'|'three'\n", {
      printWidth: 10,
      bicepUnionLayout: "preserve",
    }),
    "type V = 'one' | 'two' | 'three'\n",
  );
  assert.equal(
    await stable("type V='one'\n | 'two' | 'three'\n", {
      printWidth: 200,
      bicepUnionLayout: "preserve",
    }),
    "type V = 'one'\n  | 'two' | 'three'\n",
  );
  assert.equal(
    await stable(
      "@description('this is a long description')\nparam value string\n",
      {
        printWidth: 15,
        bicepDescriptionWidth: "preserve",
      },
    ),
    "@description('this is a long description')\nparam value string\n",
  );
  assert.equal(
    await stable("@description(\n  'hello'\n)\nparam value string\n", {
      printWidth: 200,
      bicepDescriptionWidth: "preserve",
    }),
    "@description(\n  'hello'\n)\nparam value string\n",
  );
  assert.equal(
    await stable("@description('hello'\n)\nparam value string\n", {
      printWidth: 200,
      bicepDescriptionWidth: "preserve",
    }),
    "@description('hello'\n)\nparam value string\n",
  );
  const literal = "'''\n  Keep these\n    spaces exactly.\n'''";
  const description = `@sys.description(${literal})\nparam value string\n`;
  assert.equal(
    await stable(description, {
      printWidth: 15,
      bicepDescriptionWidth: "preserve",
    }),
    description,
  );
});

test("parameter-specific preserve overrides declaration spacing", async () => {
  const source = "param first string\n\nparam second string\nparam third int\n";
  assert.equal(
    await stable(source, {
      bicepDeclarationSpacing: "compact",
      bicepParameterSpacing: "preserve",
    }),
    source,
  );
});

test("preserve also retains inline object layout in Bicep parameter files", async () => {
  const source =
    "using './main.bicep'\nparam tags = {env:'prod',owner:'team'}\n";
  const options = {
    plugins: [plugin],
    parser: "bicepparam",
    bicepObjectLayout: "preserve",
    printWidth: 12,
  };
  const output = await format(source, options);
  assert.match(output, /param tags = \{ env: 'prod', owner: 'team' \}/);
  assert.equal(await format(output, options), output);
});

test("compact call-expression loops use tight braces in parameter files", async () => {
  const options = { plugins: [plugin], parser: "bicepparam" };
  const source =
    "using './main.bicep'\nvar apps=[]\nvar values=[for x in apps: union(x, {entries:[]})]\n";
  const expected =
    "using './main.bicep'\n\nvar apps = []\n\nvar values = [for x in apps: union(x, {entries: []})]\n";
  assert.equal(await format(source, options), expected);
  assert.equal(await format(expected, options), expected);
});

test("small object arrays also compact in Bicep parameter files", async () => {
  const options = { plugins: [plugin], parser: "bicepparam" };
  const source =
    "using './main.bicep'\nvar entries = [{code: 'alpha'}, {code: 'beta'}]\n";
  const expected =
    "using './main.bicep'\n\nvar entries = [{code: 'alpha'}, {code: 'beta'}]\n";
  assert.equal(await format(source, options), expected);
  assert.equal(await format(expected, options), expected);
});

test("fitting ternary properties compact in Bicep parameter files", async () => {
  const options = { plugins: [plugin], parser: "bicepparam" };
  const source =
    "using './main.bicep'\nvar config={\n  spec: !empty(profileOptions.spec) ? {\n    url:profileOptions.spec\n  } : null\n}\n";
  const expected =
    "using './main.bicep'\n\nvar config = {\n  spec: !empty(profileOptions.spec) ? {url: profileOptions.spec} : null\n}\n";
  assert.equal(await format(source, options), expected);
  assert.equal(await format(expected, options), expected);
});

test("preserve keeps direct conditional placement and loop bracket shape", async () => {
  const resource =
    "resource r 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'";
  const nextLine = `${resource} =\n  if (true) {\n    name: 'r'\n  }\n`;
  assert.equal(
    await stable(nextLine, {
      bicepConditionalHeader: "preserve",
      printWidth: 200,
    }),
    nextLine,
  );
  assert.match(
    await stable(`${resource} = if (true) {name:'r'}\n`, {
      bicepConditionalHeader: "preserve",
      printWidth: 12,
    }),
    / = if \(true\) \{/,
  );
  const expanded = "var a = [\n  for v in [1, 2]: {\n    x: v\n  }\n]\n";
  assert.equal(
    await stable(expanded, { bicepLoopLayout: "preserve", printWidth: 200 }),
    expanded,
  );
  const compact = await stable("var a=[for v in [1,2]: {x:v}]\n", {
    bicepLoopLayout: "preserve",
    printWidth: 15,
  });
  assert.match(compact, /^var a = \[for v in /);
  assert.match(compact, /\}\]\n$/);
});

test("preserve retains call breaks inside logical and nonlogical if conditions", async () => {
  const resource =
    "resource r 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'";
  const expanded = `${resource} = if (empty(union(\n  [],\n  []\n))) {\n  name: 'r'\n}\n`;
  const options = { bicepIfConditionLayout: "preserve", printWidth: 200 };
  const output = await stable(expanded, options);
  assert.match(output, /union\(\n[\s\S]*,\n[\s\S]*\n\s*\)\)/);
  const inline = await stable(
    `${resource} = if (empty(union([], []))) {\n  name: 'r'\n}\n`,
    { ...options, printWidth: 15 },
  );
  assert.match(inline, /empty\(union\(\[\], \[\]\)\)/);
  const compactLoop = await stable(
    `${resource} = [for v in [1,2]: if (empty([v])) {\nname:'r'\n}]\n`,
    { bicepIfConditionLayout: "preserve", printWidth: 20 },
  );
  assert.match(compactLoop, / = \[for v in /);
  assert.match(compactLoop, /\}\]\n$/);
  const logical = await stable(
    `${resource} = if (empty(union(\n  [],\n  []\n)) || false) {\n  name: 'r'\n}\n`,
    { bicepLogicalCallLayout: "preserve", printWidth: 200 },
  );
  assert.match(logical, /union\(\n[\s\S]*,\n[\s\S]*\n\s*\)/);
});
