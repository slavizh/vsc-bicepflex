import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import * as prettier from "prettier";
import plugin from "../dist/index.js";

const filepath = resolve("test", "fixtures", "main.bicep");
const format = (source, options = {}) =>
  prettier.format(source, {
    plugins: [plugin],
    filepath,
    endOfLine: "lf",
    ...options,
  });
const names = (source) =>
  [
    ...source.matchAll(
      /^(?:var|resource|module|output|type|func|param)\s+(\w+)/gm,
    ),
  ].map((match) => match[1]);
const resource = (name, body = "", existing = false) =>
  `resource ${name} 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' ${existing ? "existing " : ""}= {\nname: '${name}'\n${existing ? "" : "location: 'westeurope'\n"}${body}\n}\n`;
async function stable(source, options) {
  const output = await format(source, options);
  assert.equal(
    await format(output, options),
    output,
    "formatting must be idempotent",
  );
  return output;
}

test("defaults preserve line-ending convention, use two spaces, final newline, and 180 columns", async () => {
  const output = await prettier.format("output x object={a:1}\n", {
    plugins: [plugin],
    parser: "bicep",
  });
  assert.equal(output, "output x object = {\n  a: 1\n}\n");
  const crlf = await prettier.format("output x object={a:1}\r\n", {
    plugins: [plugin],
    parser: "bicep",
  });
  assert.equal(crlf, "output x object = {\r\n  a: 1\r\n}\r\n");
  assert.equal(plugin.defaultOptions.printWidth, 180);
  assert.equal(plugin.defaultOptions.endOfLine, "auto");
});

test("redundant inline spacing is removed without changing strings, comments, or ignored declarations", async () => {
  const extension =
    "extension 'br:example.invalid/bicep/extensions/sample/v1:1.0.0'";
  assert.equal(
    await stable(`${extension}  as sampleExtension\n`),
    `${extension} as sampleExtension\n`,
  );
  assert.equal(
    await stable(`${extension}    as    sampleExtension\n`),
    `${extension} as sampleExtension\n`,
  );
  assert.equal(
    await stable("param  name  string\nvar  value = 'a  b' // keep  comment\n"),
    "param name string\n\nvar value = 'a  b' // keep  comment\n",
  );
  assert.equal(
    await stable(`// prettier-ignore\n${extension}  as sampleExtension\n`),
    `// prettier-ignore\n${extension}  as sampleExtension\n`,
  );
});

test("objects expand, primitive arrays compact, and declarations are separated", async () => {
  assert.equal(
    await stable(
      "param names array=[\n'a'\n'b'\n]\noutput value object={'names':names}\n",
    ),
    "param names array = ['a', 'b']\n\noutput value object = {\n  names: names\n}\n",
  );
});

test("parameters form compact blocks unless either neighbor has a description", async () => {
  const source =
    "param first string\n\nparam second int\n@description('Explains third')\nparam third bool\nparam fourth string\n@sys.description('Explains fifth')\nparam fifth string\nparam sixth string\n\nvar result=first\n";
  const grouped = await stable(source);
  assert.equal(
    grouped,
    "param first string\nparam second int\n\n@description('Explains third')\nparam third bool\n\nparam fourth string\n\n@sys.description('Explains fifth')\nparam fifth string\n\nparam sixth string\n\nvar result = first\n",
  );
  const inherited = await stable(source, { bicepParameterSpacing: "inherit" });
  assert.match(inherited, /param first string\n\nparam second int\n/);
  assert.match(inherited, /param fifth string\n\nparam sixth string\n/);
  const compact = await stable(source, {
    bicepParameterSpacing: "inherit",
    bicepDeclarationSpacing: "compact",
  });
  assert.match(compact, /param second int\n@description/);
  assert.match(
    await stable(source, { bicepDeclarationSpacing: "preserve" }),
    /param first string\nparam second int\n\n@description/,
  );
  assert.match(
    await stable(source, { bicepDeclarationSpacing: "compact" }),
    /param second int\n\n@description/,
  );
  assert.match(
    await stable(source, {
      bicepParameterSpacing: "inherit",
      bicepDeclarationSpacing: "preserve",
    }),
    /param first string\n\nparam second int\n/,
  );
});

test("described parameters at either end separate from plain parameters", async () => {
  const output = await stable(
    "@description('First')\nparam first string\nparam second string\n@description('Last')\nparam last string\n",
  );
  assert.equal(
    output,
    "@description('First')\nparam first string\n\nparam second string\n\n@description('Last')\nparam last string\n",
  );
});

test("other decorators stay grouped and comment boundaries retain their spacing", async () => {
  const output = await stable(
    "param first string\n\n@minLength(1)\nparam second string\n\n// Separate parameter section\n\nparam third string\n\nparam fourth string\n",
  );
  assert.match(
    output,
    /param first string\n@minLength\(1\)\nparam second string/,
  );
  assert.match(
    output,
    /param second string\n\n\/\/ Separate parameter section\n\nparam third string\nparam fourth string/,
  );
});

test("attached comments do not split compact plain parameter blocks", async () => {
  const source =
    "param profile object\n" +
    "// Options for the secondary profile\n" +
    "param profileOptions object\n" +
    "param profileName string\n" +
    "@allowed([\n  'alpha'\n  'beta'\n  'gamma'\n  'beta,gamma'\n])\n" +
    "param kind string\n" +
    "param usesAcceleration bool = false\n" +
    "param platform string\n" +
    "param tags object\n";
  const expected =
    "param profile object\n" +
    "// Options for the secondary profile\n" +
    "param profileOptions object\n" +
    "param profileName string\n" +
    "@allowed(['alpha', 'beta', 'gamma', 'beta,gamma'])\n" +
    "param kind string\n" +
    "param usesAcceleration bool = false\n" +
    "param platform string\n" +
    "param tags object\n";
  assert.equal(await stable(source), expected);
  const notes = "// Primary note\n// Secondary note";
  assert.equal(
    await stable(source.replace("// Options for the secondary profile", notes)),
    expected.replace("// Options for the secondary profile", notes),
  );
  const mixedNotes = "// Primary note\n/* Secondary note */";
  assert.equal(
    await stable(
      source.replace("// Options for the secondary profile", mixedNotes),
    ),
    expected.replace("// Options for the secondary profile", mixedNotes),
  );
  assert.equal(
    await stable(source.replace("// Options", "\n// Options")),
    expected,
  );
  assert.equal(
    await stable(
      source.replace(
        "// Options for the secondary profile",
        "/* Options for the secondary profile */",
      ),
    ),
    expected.replace(
      "// Options for the secondary profile",
      "/* Options for the secondary profile */",
    ),
  );
  const block = "/* A separate note about this\n   secondary profile */";
  assert.equal(
    await stable(source.replace("// Options for the secondary profile", block)),
    expected.replace("// Options for the secondary profile", block),
  );
  assert.match(
    await stable(
      source.replace(
        "param profileOptions object",
        "@description('Profile options')\nparam profileOptions object",
      ),
    ),
    /param profile object\n\n\/\/ Options for the secondary profile\n@description\('Profile options'\)/,
  );
  assert.match(
    await stable(source.replace("// Options", "\n// Options"), {
      bicepParameterSpacing: "preserve",
    }),
    /param profile object\n\n\/\/ Options/,
  );
});

test("variables move immediately before first consumer", async () => {
  const output = await stable(
    "var appTags={env:'dev'}\n" +
      resource("resourceA") +
      resource("resourceB", "tags:appTags"),
  );
  assert.deepEqual(names(output), ["resourceA", "appTags", "resourceB"]);
});

test("consecutive named and wildcard imports form one compact block", async () => {
  const output = await stable(
    "import { Second } from './import-types.bicep'\n\nimport { First } from './import-types.bicep'\n\nimport * as types from './import-types.bicep'\nparam first First\nparam second Second\nparam other types.First\n",
  );
  assert.ok(
    output.startsWith(
      "import { Second } from './import-types.bicep'\nimport { First } from './import-types.bicep'\nimport * as types from './import-types.bicep'\n\nparam first First\nparam second Second\nparam other types.First\n",
    ),
  );
});

test("import blocks preserve inline comments and section headings", async () => {
  const output = await stable(
    "import { First } from './import-types.bicep' // First type\n\nimport { Second } from './import-types.bicep'\n\n// Separate imports\n\nimport * as types from './import-types.bicep'\nparam first First\nparam second Second\nparam other types.First\n",
  );
  assert.ok(output.includes("// First type\nimport { Second }"));
  assert.ok(output.includes("\n\n// Separate imports\n\nimport *"));
});

test("preserve declaration spacing retains author blank lines between imports", async () => {
  const output = await stable(
    "import { First } from './import-types.bicep'\n\nimport { Second } from './import-types.bicep'\nparam first First\nparam second Second\n",
    { bicepDeclarationSpacing: "preserve", bicepImportSpacing: "preserve" },
  );
  assert.ok(output.includes("'./import-types.bicep'\n\nimport { Second }"));
});

test("existing resource and variable dependency chain", async () => {
  const output = await stable(
    resource("resourceA", "tags:appTags") +
      resource("existingResourceA", "", true) +
      "var appTags={parentId:existingResourceA.id}\n" +
      resource("resourceB"),
  );
  assert.deepEqual(names(output), [
    "existingResourceA",
    "appTags",
    "resourceA",
    "resourceB",
  ]);
});

test("earliest ready declaration wins dependency ties", async () => {
  const output = await stable(
    resource("consumerA", "tags:{parent:dependencyC.id}") +
      resource("unrelatedB") +
      resource("dependencyC"),
  );
  assert.deepEqual(names(output), ["unrelatedB", "dependencyC", "consumerA"]);
});

test("resource/module order stays stable and direct output follows its dependency", async () => {
  const output = await stable(
    resource("first") +
      "module consumer './consumer.bicep'={name:'consumer',params:{parentId:first.id}}\n" +
      resource("second", "tags:{parent:first.id}") +
      "output firstId string=first.id\n",
  );
  assert.deepEqual(names(output), ["first", "firstId", "consumer", "second"]);
});

test("output-only variables and their outputs go at the end", async () => {
  const output = await stable(
    "var accountId=account.id\noutput result string=accountId\n" +
      resource("account") +
      resource("nextResource"),
  );
  assert.deepEqual(names(output), [
    "account",
    "nextResource",
    "accountId",
    "result",
  ]);
});

test("shared variables are emitted once before their first consumer", async () => {
  const output = await stable(
    resource("first", "tags:tags") +
      resource("second", "tags:tags") +
      "var tags={env:'dev'}\n",
  );
  assert.deepEqual(names(output), ["tags", "first", "second"]);
});

test("types follow all types that reference them", async () => {
  const output = await stable(
    "type typeC={name:string}\ntype typeA={primary:typeC}\ntype typeB={secondary:typeC}\nparam config typeA\n",
  );
  assert.deepEqual(names(output), ["typeA", "typeB", "typeC", "config"]);
});

test("recursive type components preserve source order", async () => {
  const output = await stable(
    "type A={child:B?}\ntype B={parent:A?}\nparam value A\n",
  );
  assert.deepEqual(names(output), ["A", "B", "value"]);
});

test("quoted type property keys are normalized safely", async () => {
  const output = await stable(
    "type Config={'name':string,'cost-center':string}\nparam config Config\n",
  );
  assert.match(output, /name: string\n  'cost-center': string/);
});

test("type member order is preserved", async () => {
  const output = await stable(
    "type Config={description:string?,name:string,enabled:bool?,location:string}\nparam config Config\n",
  );
  assert.match(
    output,
    /description: string\?\n  name: string\n  enabled: bool\?\n  location: string/,
  );
});

test("called functions precede their callers", async () => {
  const output = await stable(
    "func caller(x string) string => helper(x)\nfunc helper(x string) string => toLower(x)\noutput name string=caller('HELLO')\n",
  );
  assert.deepEqual(names(output), ["helper", "caller", "name"]);
});

test("resource and module property priorities, with unlisted keys before properties/params", async () => {
  const source =
    "resource app 'Microsoft.Storage/storageAccounts@2023-05-01'={properties:{supportsHttpsTrafficOnly:true},kind:'StorageV2',sku:{name:'Standard_LRS'},tags:{env:'dev'},name:'examplestorage',location:'westeurope'}\n";
  const output = await stable(source);
  const positions = [
    "name: 'examplestorage'",
    "location:",
    "tags:",
    "kind:",
    "sku:",
    "properties:",
  ].map((s) => output.indexOf(s));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  const custom = await stable(source, {
    bicepResourcePropertyOrder: ["name", "properties", "*", "location"],
  });
  assert.ok(custom.indexOf("properties:") < custom.indexOf("kind:"));
  assert.ok(custom.indexOf("kind:") < custom.indexOf("location:"));
});

test("resource location precedes dependsOn by default and custom property order still wins", async () => {
  const source =
    resource("dependency") + resource("target", "dependsOn:[dependency]");
  const output = await stable(source);
  assert.match(
    output,
    /resource target[^\n]+\{\n  name: 'target'\n  location: 'westeurope'\n  dependsOn:/,
  );
  const overridden = await stable(source, {
    bicepResourcePropertyOrder: ["name", "dependsOn", "location", "*"],
  });
  assert.match(
    overridden,
    /resource target[^\n]+\{\n  name: 'target'\n  dependsOn: \[\n    dependency\n  \]\n  location:/,
  );
});

test("decorator ordering follows latest user priority", async () => {
  const output = await stable(
    "@maxLength(24)\n@minLength(3)\n@description('Name.')\nparam name string\n",
  );
  assert.equal(
    output,
    "@description('Name.')\n@minLength(3)\n@maxLength(24)\nparam name string\n",
  );
});

test("description decorators are exempt from print width", async () => {
  const description = "A deliberately long description. ".repeat(12);
  const output = await stable(
    `@description('${description}')\nparam name string\n`,
    {
      printWidth: 40,
    },
  );
  assert.equal(output.split("\n")[0], `@description('${description}')`);
});

test("inline conditional header can stay on the declaration line beyond print width", async () => {
  const output = await stable(
    "param deploy bool=true\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(deploy){name:'example',location:'westeurope'}\n",
    { printWidth: 40, bicepConditionalHeader: "inline" },
  );
  assert.match(output, /^resource identity .* = if \(deploy\) \{$/m);
});

test("single lambda parameter parentheses are removed", async () => {
  const output = await stable(
    "param names array=[]\noutput result array=map(names,(name)=>toLower(name))\n",
  );
  assert.match(output, /map\(names, name => toLower\(name\)\)/);
});

test("wrapped lambda call bodies align with their lambda headers", async () => {
  const source =
    "var config = {\n" +
    "  policies: filter(map(items(union(baseGroup, group).policies), policy => union({lookupKey: policy.key}, policy.value)), policy => policy.deploy)\n" +
    "}\n";
  const expected =
    "var config = {\n" +
    "  policies: filter(\n" +
    "    map(\n" +
    "      items(union(baseGroup, group).policies),\n" +
    "      policy =>\n" +
    "      union({lookupKey: policy.key}, policy.value)\n" +
    "    ),\n" +
    "    policy => policy.deploy\n" +
    "  )\n" +
    "}\n";
  assert.equal(await stable(source), expected);
  assert.match(
    await stable(source, { tabWidth: 4 }),
    /\n {12}policy =>\n {12}union\(/,
  );
  assert.match(
    await stable(source, { tabWidth: 4, useTabs: true }),
    /\n\t{3}policy =>\n\t{3}union\(/,
  );
  const nested = await stable(
    "var result = map(values, value => filter(value.items, item => union({active: item.active}, item).active))\n",
    { printWidth: 55 },
  );
  assert.match(nested, /\n {2}value =>\n {2}filter\(/);
  assert.match(nested, /\n {4}item =>\n {4}union\(/);
  const commented = await stable(
    "var result = map(values, value => union({name: value.name}, /* keep */ value))\n",
    { printWidth: 55 },
  );
  assert.match(commented, /\/\* keep \*\//);
  assert.match(commented, /\n {2}value =>\n {4}union\(/);
});

test("loop and lambda variables shadow globals without creating false dependencies", async () => {
  const output = await stable(
    "param name string='global'\noutput result array=[for name in ['a']:name]\n",
  );
  assert.match(output, /\[for name in \['a'\]: name\]/);
});

test("ignored declaration text is preserved but may move", async () => {
  const ignored = "var appTags = { environment: 'dev', owner: 'platform' }";
  const output = await stable(
    "// prettier-ignore\n" +
      ignored +
      "\n" +
      resource("unrelated") +
      resource("application", "tags:appTags"),
  );
  assert.deepEqual(names(output), ["unrelated", "appTags", "application"]);
  assert.ok(output.includes("// prettier-ignore\n" + ignored));
});

test("section heading is fixed and attached documentation moves with declaration", async () => {
  const output = await stable(
    "// First section\n\nparam first string='a'\n// Second section\n\n// Attached output description.\noutput result string=value\nvar value='b'\n",
  );
  assert.ok(
    output.indexOf("param first") < output.indexOf("// Second section"),
  );
  assert.ok(output.indexOf("// Second section") < output.indexOf("var value"));
  assert.ok(output.includes("// Attached output description.\noutput result"));
});

test("unused declarations are fixed ordering boundaries", async () => {
  const output = await stable(
    resource("before") +
      "var unused='keep'\nparam location string='westeurope'\n" +
      resource("after"),
  );
  assert.deepEqual(names(output), ["before", "unused", "location", "after"]);
});

test("trailing comments remain inline and declarations have one blank line", async () => {
  const output = await stable(
    "param a string='a' // A long inline comment that must not move.\nparam b string='b'\n",
    { printWidth: 30 },
  );
  assert.match(
    output,
    /'a' \/\/ A long inline comment that must not move\.\n\nparam b/,
  );
});

test("nested resources follow ordinary properties and remain inside their parent", async () => {
  const output = await stable(
    "resource parent 'Microsoft.Storage/storageAccounts@2023-05-01'={name:'examplestorage',resource child 'blobServices'={name:'default'},location:'westeurope',kind:'StorageV2',sku:{name:'Standard_LRS'}}\n",
  );
  assert.ok(output.indexOf("sku:") < output.indexOf("resource child"));
  assert.match(output, /\n\n  resource child/);
});

test("references to nested resources depend on the containing top-level resource", async () => {
  const output = await stable(
    "output childId string=parent::child.id\nresource parent 'Microsoft.Storage/storageAccounts@2023-05-01'={name:'examplestorage',location:'westeurope',kind:'StorageV2',sku:{name:'Standard_LRS'},resource child 'blobServices'={name:'default'}}\n" +
      resource("unrelated"),
  );
  assert.deepEqual(names(output), ["parent", "childId", "unrelated"]);
});

test("property blank lines are removed", async () => {
  const output = await stable("output result object={\na:1\n\nb:2\n}\n");
  assert.match(output, /a: 1\n  b: 2/);
});

test("comments separating decorated nested resources do not drift between passes", async () => {
  await stable(
    "resource parent 'Microsoft.Storage/storageAccounts@2023-05-01'={\nname:'examplestorage'\nlocation:'westeurope'\n// Location notes\n\n// Child notes\n@description('Child.')\nresource child 'blobServices'={name:'default'}\nkind:'StorageV2'\nsku:{name:'Standard_LRS'}\n}\n",
  );
});

test("long calls and ternaries wrap at grammar-valid boundaries", async () => {
  const output = await stable(
    "param enabled bool=true\noutput choice string=enabled ? 'production-storage-account' : 'development-storage-account'\noutput name string=format('{0}-{1}-{2}', 'application-name', 'environment-name', 'region-name')\n",
    { printWidth: 45 },
  );
  assert.match(
    output,
    /enabled\n  \? 'production-storage-account'\n  : 'development-storage-account'/,
  );
  assert.match(
    output,
    /format\(\n\s+'\{0\}-\{1\}-\{2\}',\n\s+'application-name',\n\s+'environment-name',\n\s+'region-name'\n\)/,
  );
});

test("deeply nested conditional property keeps two-space indentation", async () => {
  const source = [
    "param kind string",
    "param profile object",
    "param platform string",
    "output service object = {",
    "  properties: {",
    "    runtimeOptions: {",
    "      runtimeLabel: kind == 'worker' && profile.runtimeRevision == 0",
    "        ? null",
    "        : platform == 'Linux'",
    "            ? empty(profile.runtimeLabel)",
    "                // Keep this note beside the nested condition",
    "                ? profile.runtime =~ 'Java' && kind != 'worker'",
    "                    ? profile.engineVariant =~ 'ServerA'",
    "                        ? profile.engineVersion == '1.8' ? 'SERVER_A|${profile.version}-jre8' : 'SERVER_A|${profile.version}-java${profile.engineVersion}'",
    "                        : profile.engineVariant =~ 'ServerB'",
    "                            ? 'SERVER_B|${profile.version}-java${profile.engineVersion}'",
    "                            : profile.engineVariant =~ 'Java'",
    "                                ? profile.engineVersion == '1.8' ? 'JAVA|8-jre8' : 'JAVA|${profile.engineVersion}-java${profile.engineVersion}'",
    "                                : 'JAVA|${profile.version}'",
    "                    // Keep this other note before the alternate condition",
    "                    : profile.runtime =~ 'Addon'",
    "                        ? 'auxiliary'",
    "                        : profile.runtime =~ 'Container'",
    "                            ? 'CONTAINER|${profile.imageName}'",
    "                            : !empty(profile.runtime) && profile.runtime != 'Custom' ? '${toUpper(profile.runtime)}|${profile.version}' : null",
    "                : profile.runtimeLabel",
    "            : null",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const output = await stable(source, { tabWidth: 2 });
  assert.match(output, /\n {6}runtimeLabel:/);
  assert.match(output, /\n {8}\? null\n/);
  assert.match(output, /\n {10}\? empty\(profile\.runtimeLabel\)/);
  assert.match(output, /\n {12}\/\/ Keep this note/);
  assert.match(output, /\n {12}\? profile\.runtime =~ 'Java'/);
  assert.match(output, /\n {14}\? profile\.engineVariant =~ 'ServerA'/);
  assert.match(output, /\n {16}\? profile\.engineVersion == '1\.8'/);
  assert.match(output, /\n {14}\/\/ Keep this other note/);
  assert.match(output, /\n {14}: profile\.runtime =~ 'Addon'/);
  assert.match(output, /\n {12}: profile\.runtimeLabel/);
  assert.match(output, /\n {10}: null\n/);
  const fourSpaces = await stable(source, { tabWidth: 4 });
  assert.match(fourSpaces, /\n {12}runtimeLabel:/);
  assert.match(fourSpaces, /\n {20}\? empty\(profile\.runtimeLabel\)/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{3}runtimeLabel:/);
  assert.match(tabs, /\n\t{5}\? empty\(profile\.runtimeLabel\)/);
});

test("conditional object branches indent their contents once after the question or colon", async () => {
  const source = [
    "var config = {",
    "  endpointOptions: !empty(hostOptions.customEndpoint.domain)",
    "    ? {",
    "        // keep this note in place",
    "        domain: hostOptions.customEndpoint.domain",
    "        certificateUri: endpointCertificate!.properties.secretUri",
    "        credentialIdentity: !empty(hostOptions.customEndpoint.identity.name) ? endpointIdentity.id : 'automatic'",
    "      }",
    "    : null",
    "}",
    "",
  ].join("\n");
  const expected = source
    .replaceAll("\n        ", "\n      ")
    .replace("\n      }\n    : null", "\n    }\n    : null");
  assert.equal(await stable(source, { tabWidth: 2 }), expected);
  const fourSpaces = await stable(source, { tabWidth: 4 });
  assert.match(fourSpaces, /\n {8}\? \{\n {12}\/\/ keep this note in place/);
  assert.match(fourSpaces, /\n {12}domain:/);
  assert.match(fourSpaces, /\n {8}\}\n {8}: null/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{2}\? \{\n\t{3}\/\/ keep this note in place/);
  assert.match(tabs, /\n\t{2}\}\n\t{2}: null/);
});

test("fitting ternary object properties collapse to tight inline branches", async () => {
  const source = [
    "var config = {",
    "  gatewayOptions: !empty(profileOptions.gateway.name) ? {",
    "    id: gatewayResource.id",
    "  } : null",
    "  spec: !empty(profileOptions.spec) ? {",
    "    url: profileOptions.spec",
    "  } : null",
    "}",
    "",
  ].join("\n");
  const expected = [
    "var config = {",
    "  gatewayOptions: !empty(profileOptions.gateway.name) ? {id: gatewayResource.id} : null",
    "  spec: !empty(profileOptions.spec) ? {url: profileOptions.spec} : null",
    "}",
    "",
  ].join("\n");
  assert.equal(await stable(source), expected);
  const longest = expected.split("\n")[1].length;
  assert.equal(await stable(source, { printWidth: longest }), expected);
  const narrow = await stable(source, { printWidth: longest - 1 });
  assert.match(
    narrow,
    /gatewayOptions: !empty\(profileOptions\.gateway\.name\)\n/,
  );
  assert.match(
    narrow,
    /spec: !empty\(profileOptions\.spec\) \? \{url: profileOptions\.spec\} : null/,
  );
  assert.match(
    await stable(source, { bicepObjectLayout: "preserve" }),
    /\n    \? \{\n/,
  );
  const comment = source.replace(
    "    id:",
    "    // retain branch comment\n    id:",
  );
  assert.match(
    await stable(comment),
    /gatewayOptions:[^\n]*\n    \? \{\n      \/\/ retain branch comment/,
  );
  const multiline = source.replace(
    "gatewayResource.id",
    "'''\n  keep indentation\n'''",
  );
  const kept = await stable(multiline);
  assert.match(kept, /gatewayOptions: !empty\([^\n]*\)\n/);
  assert.ok(kept.includes("'''\n  keep indentation\n'''"));
  const nested = await stable(
    "var result={value: enabled ? {inner: flag ? {name:'a'} : null} : null}\n",
  );
  assert.match(
    nested,
    /value: enabled \? \{inner: flag \? \{name: 'a'\} : null\} : null/,
  );
  assert.equal(
    await stable("// prettier-ignore\n" + source),
    "// prettier-ignore\n" + source,
  );
});

test("array, loop, and call branches use one continuation indent", async () => {
  const array = await stable(
    "param enabled bool\nvar items = enabled ? ['one','two'] : ['three','four']\n",
    { bicepArrayLayout: "multiline" },
  );
  assert.match(array, /\n {2}\? \[\n {4}'one'\n {4}'two'\n {2}\]/);
  assert.match(array, /\n {2}: \[\n {4}'three'\n {4}'four'\n {2}\]/);
  const loop = await stable(
    "param enabled bool\nparam names array\nvar items = enabled ? [for name in names: {value:name}] : []\n",
  );
  assert.match(
    loop,
    /\n {2}\? \[for name in names: \{\n {4}value: name\n {2}\}\]/,
  );
  const call = await stable(
    "param enabled bool\nvar items = enabled ? union({one:1},{two:2}) : union({three:3},{four:4})\n",
    { printWidth: 20 },
  );
  assert.match(call, /\n {2}\? union\(\n {4}\{\n {6}one: 1/);
  assert.match(call, /\n {2}: union\(\n {4}\{\n {6}three: 3/);
});

test("nested and parenthesized ternary objects preserve comments and literal indentation", async () => {
  const nested = await stable(
    "param flag bool\nparam second bool\nvar result = flag ? (second ? {inner:{name:'first'}} : {inner:{name:'other'}}) : {inner:{name:'third'}}\n",
  );
  assert.match(nested, /\n {2}\? \(second\n {4}\? \{\n {6}inner:/);
  assert.match(nested, /\n {4}: \{\n {6}inner:/);
  assert.match(nested, /\n {2}: \{\n {4}inner:/);
  const parenthesized = await stable(
    "param flag bool\nvar result = flag ? ({name:'first'}) : ({name:'other'})\n",
  );
  assert.match(parenthesized, /\n {2}\? \(\{\n {4}name: 'first'\n {2}\}\)/);
  const protectedText = await stable(
    "param flag bool\nvar result = flag ? {multiline: '''\n  two  significant  spaces\n''' /* first\n   significant comment\n */,child:{name:'first'}} : {name:'other'}\n",
  );
  assert.match(protectedText, /\n {2}\? \{\n {4}multiline:/);
  assert.ok(protectedText.includes("'''\n  two  significant  spaces\n'''"));
  assert.ok(protectedText.includes("/* first\n   significant comment\n */"));
  assert.match(protectedText, /\n {4}child: \{\n {6}name: 'first'/);
});

test("ternaries nested in multiline calls retain one indent per branch", async () => {
  const source = [
    "param profile object",
    "param kind string",
    "param platform string",
    "param attachedVolumes array",
    "var config = {",
    "  volumeMappings: (profile.runtime =~ 'Container' || platform == 'Linux') && !empty(profile.attachedVolumes) && kind != 'worker,service'",
    "    ? union({",
    "      '${profile.attachedVolumes[0].name}': {",
    "        share: profile.attachedVolumes[0].type =~ 'SharedDisk'",
    "          ? profile.attachedVolumes[0].volume.share",
    "          : profile.attachedVolumes[0].type =~ 'ObjectDisk'",
    "          ? profile.attachedVolumes[0].volume.container",
    "          : ''",
    "      }",
    "    }, length(profile.attachedVolumes) > 1 ? {",
    "      '${profile.attachedVolumes[1].name}': {",
    "        share: profile.attachedVolumes[1].type =~ 'SharedDisk'",
    "          ? profile.attachedVolumes[1].volume.share",
    "          : profile.attachedVolumes[1].type =~ 'ObjectDisk'",
    "          ? profile.attachedVolumes[1].volume.container",
    "          : ''",
    "      }",
    "    } : {}, length(profile.attachedVolumes) > 2 ? {",
    "      '${profile.attachedVolumes[2].name}': {",
    "        share: profile.attachedVolumes[2].type =~ 'SharedDisk'",
    "          ? profile.attachedVolumes[2].volume.share",
    "          : profile.attachedVolumes[2].type =~ 'ObjectDisk'",
    "          ? profile.attachedVolumes[2].volume.container",
    "          : ''",
    "      }",
    "    } : {})",
    "    : {}",
    "}",
    "",
  ].join("\n");
  const output = await stable(source);
  assert.match(output, / {2}volumeMappings:/);
  assert.match(output, /\n {4}\? union\(\n/);
  for (const index of [0, 1, 2]) {
    const depth = index === 0 ? 10 : 12;
    assert.match(
      output,
      new RegExp(
        `\\n {${depth}}share: profile\\.attachedVolumes\\[${index}\\]\\.type =~ 'SharedDisk'\\n {${depth + 2}}\\? profile\\.attachedVolumes\\[${index}\\]`,
      ),
    );
  }
  assert.match(
    output,
    /\n {6}length\(profile\.attachedVolumes\) > 1\n {8}\? \{/,
  );
  assert.match(output, /\n {8}: \{\},\n/);
  const four = await stable(source, { tabWidth: 4 });
  assert.match(four, /\n {8}\? union\(\n/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{2}\? union\(\n/);
});

test("all nested volume branches keep ternaries and sibling properties aligned", async () => {
  const account = (index) =>
    [
      index === 0 ? "{" : `length(profile.attachedVolumes) > ${index} ? {`,
      `  '\${profile.attachedVolumes[${index}].name}': {`,
      `    type: profile.attachedVolumes[${index}].type`,
      `    share: profile.attachedVolumes[${index}].type =~ 'SharedDisk'`,
      `      ? profile.attachedVolumes[${index}].volume.share`,
      `      : profile.attachedVolumes[${index}].type =~ 'ObjectDisk'`,
      `      ? profile.attachedVolumes[${index}].volume.container`,
      "      : ''",
      `    path: profile.attachedVolumes[${index}].path`,
      "  }",
      index === 0 ? "}" : "} : {}",
    ].join("\n");
  const source =
    "param profile object\n" +
    "param kind string\n" +
    "param platform string\n" +
    "var config = {\n" +
    "  volumeMappings: (profile.runtime =~ 'Container' || platform == 'Linux') && !empty(profile.attachedVolumes) && kind != 'worker,service'\n" +
    `    ? union(${Array.from({ length: 5 }, (_, index) => account(index)).join(", ")})\n` +
    "    : {}\n" +
    "}\n";
  const output = await stable(source);
  for (const index of [0, 1, 2, 3, 4]) {
    const depth = index === 0 ? 10 : 12;
    assert.match(
      output,
      new RegExp(
        `\\n {${depth}}share: profile\\.attachedVolumes\\[${index}\\]\\.type =~ 'SharedDisk'\\n {${depth + 2}}\\? profile\\.attachedVolumes\\[${index}\\]`,
      ),
    );
    assert.match(
      output,
      new RegExp(
        `\\n {${depth}}path: profile\\.attachedVolumes\\[${index}\\]\\.path`,
      ),
    );
  }
});

test("multiline ternaries in array comprehensions indent branches past the loop body", async () => {
  const source = [
    "var config = {",
    "  eligibleEntryIdentifiers: [",
    "    for (record, i) in union(referenceCatalog, requestConfiguration.sources).directory.validation.rules.eligibleEntryIdentifiers: union(",
    "        referenceCatalog,",
    "        requestConfiguration.sources",
    "      ).directory.keyStyle == 'Aliases'",
    "      ? knownRecords[i]!.id",
    "      : record",
    "  ]",
    "}",
    "",
  ].join("\n");
  const expected = source
    .replace("\n      ? knownRecords", "\n        ? knownRecords")
    .replace("\n      : record", "\n        : record");
  assert.equal(await stable(source, { tabWidth: 2 }), expected);
  const fourSpaces = await stable(source, { tabWidth: 4 });
  assert.match(fourSpaces, /\n {8}for \(record, i\)/);
  assert.match(fourSpaces, /\n {16}\? knownRecords/);
  assert.match(fourSpaces, /\n {16}: record/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{2}for \(record, i\)/);
  assert.match(tabs, /\n\t{4}\? knownRecords/);
  assert.match(tabs, /\n\t{4}: record/);
});

test("loop ternary indentation leaves unrelated ternaries and ignored declarations alone", async () => {
  const loop = await stable(
    "param names array\nvar values = [for name in names: union({first:name},{other:name}).first == 'first' ? name : 'other']\n",
    { printWidth: 60 },
  );
  assert.match(loop, /\n {2}for name in names: union\(/);
  assert.match(loop, /\n {6}\? name\n {6}: 'other'\n\]/);
  const compound = await stable(
    "param names array\nvar values = [for name in names: union({first:name},{other:name}).first == 'first' ? {value:name} : {value:'other'}]\n",
    { printWidth: 60 },
  );
  assert.match(
    compound,
    /\n {6}\? \{\n {8}value: name\n {6}\}\n {6}: \{\n {8}value: 'other'\n {6}\}/,
  );
  const ordinary = await stable(
    "var value = union({first:'a'},{other:'b'}).first == 'a' ? 'yes' : 'no'\n",
    { printWidth: 36 },
  );
  assert.match(ordinary, /\n {2}\? 'yes'\n {2}: 'no'/);
  const ignored =
    "// prettier-ignore\nvar values = [for name in names: union({first:name},{other:name}).first == 'first'\n    ? name\n    : 'other']\n";
  assert.equal(await stable(ignored, { printWidth: 60 }), ignored);
});

const groupLoopHeader =
  "resource groupResources 'Microsoft.Resources/groups@2025-04-01' = [for group in groups: if (union(baseGroup, group).create) {";
const groupLoop =
  "targetScope='subscription'\nparam groups array=[]\nparam tags object={}\nvar baseGroup={create:true,tags:{}}\n" +
  groupLoopHeader +
  "\nname:group.name\nlocation:group.location\ntags:union(tags,union(baseGroup,group).tags)\nproperties:{}\n}]\n";

test("conditional resource loop header fits on one line with a single body indent", async () => {
  assert.ok(groupLoopHeader.length <= 180);
  const output = await stable(groupLoop, { printWidth: 180 });
  assert.ok(output.includes(groupLoopHeader + "\n  name: group.name\n"));
  assert.ok(output.endsWith("  properties: {}\n}]\n"));
});

test("conditional loop headers stay inline beyond width unless if-call wrapping is requested", async () => {
  const source =
    "resource knownRecords 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = [\n" +
    "  for record in (union(referenceCatalog, requestConfiguration.sources).directory.validation.rules.eligibleEntryIdentifiers): if (union(\n" +
    "    referenceCatalog,\n" +
    "    requestConfiguration.sources\n" +
    "  ).directory.keyStyle == 'Aliases') {\n" +
    "    alias: record\n" +
    "  }\n" +
    "]\n";
  const inline = await stable(source);
  const header =
    "resource knownRecords 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = [for record in (union(referenceCatalog, requestConfiguration.sources).directory.validation.rules.eligibleEntryIdentifiers) : if (union(referenceCatalog, requestConfiguration.sources).directory.keyStyle == 'Aliases') {";
  assert.ok(header.length > 180);
  assert.ok(inline.includes(header + "\n  alias: record\n}]"));
  assert.doesNotMatch(inline, /if \(union\(\s*\n/);
  const wrapped = await stable(source, { bicepIfConditionLayout: "wrap" });
  assert.match(wrapped, / = \[\n  for record/);
  assert.match(wrapped, /if \(union\(\n\s+referenceCatalog,/);
  assert.ok(
    (
      await stable(source, {
        bicepIfConditionLayout: "wrap",
        printWidth: header.length,
      })
    ).includes(header),
  );
  assert.match(
    await stable(source, {
      bicepIfConditionLayout: "wrap",
      printWidth: header.length - 1,
    }),
    / = \[\n  for record/,
  );
  const expanded = await stable(source, { bicepLoopLayout: "expanded" });
  assert.match(expanded, / = \[\n  for record/);
  assert.match(
    expanded,
    /if \(union\(referenceCatalog, requestConfiguration\.sources\)/,
  );
  const commented = source.replace(
    "    requestConfiguration.sources\n  ).directory.keyStyle",
    "    /* preserve comment */ requestConfiguration.sources\n  ).directory.keyStyle",
  );
  const safe = await stable(commented);
  assert.match(safe, /\/\* preserve comment \*\//);
  assert.match(safe, / = \[\n  for record/);
});

test("direct if conditions keep calls inline unless wrapping is requested", async () => {
  const source =
    "resource example 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (union(defaultProps, overrides).enabled) {name:'example',location:'westeurope'}\n";
  const inline = await stable(source, { printWidth: 40 });
  assert.match(inline, /if \(union\(defaultProps, overrides\)\.enabled\) \{/);
  const wrapped = await stable(source, {
    printWidth: 40,
    bicepIfConditionLayout: "wrap",
  });
  assert.match(wrapped, /if \(union\(\n\s+defaultProps,/);
});

test("long direct if conditions move intact below the resource declaration", async () => {
  const source =
    "resource conditionalIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (!empty(recordConfig.replica.sourceName) || recordConfig.status =~ 'paused' || recordConfig.status =~ 'active' ? false : recordConfig.protectionMode !~ 'Disabled') {\n" +
    "  name: 'current'\n" +
    "  parent: parentIdentity\n" +
    "  properties: {\n" +
    "    state: recordConfig.protectionMode\n" +
    "  }\n" +
    "}\n";
  const expected = source.replace(" = if (", " =\n  if (");
  assert.equal(await stable(source), expected);
  const headerWidth = source.split("\n")[0].length;
  assert.equal(await stable(source, { printWidth: headerWidth }), source);
  assert.equal(await stable(source, { printWidth: headerWidth - 1 }), expected);
  assert.match(
    await stable(source, { bicepConditionalHeader: "inline" }),
    /active'\n  \? false/,
  );
  assert.match(
    await stable(source, { bicepConditionalHeader: "auto" }),
    /active'\n  \? false/,
  );
  const module = source
    .replace(
      "resource conditionalIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'",
      "module conditionalIdentity './recordConfig.bicep'",
    )
    .replace(
      "  parent: parentIdentity\n  properties: {\n    state: recordConfig.protectionMode\n  }",
      "  params: {\n    state: recordConfig.protectionMode\n  }",
    );
  assert.match(
    await stable(module, { printWidth: 85 }),
    / =\n  if \([^\n]*\? false : [^\n]*\) \{\n  name:/,
  );
  const commented = source.replace(
    "recordConfig.status =~ 'active'",
    "recordConfig.status =~ /* keep */ 'active'",
  );
  assert.match(await stable(commented), /\/\* keep \*\//);
  assert.equal(
    await stable("// prettier-ignore\n" + source),
    "// prettier-ignore\n" + source,
  );
  assert.match(
    await stable(source, { useTabs: true, tabWidth: 4 }),
    / =\n\tif \([^\n]*\? false : [^\n]*\) \{\n\tname:/,
  );
  const preserved = source.replace(
    "recordConfig.status =~ 'active'",
    "empty({\n    flag: true\n  })",
  );
  assert.match(
    await stable(preserved, { bicepObjectLayout: "preserve" }),
    /empty\(\{\n\s+flag: true\n\s+\}\)/,
  );
});

test("object loop wrapping changes at the exact header width", async () => {
  const fits = await stable(groupLoop, {
    printWidth: groupLoopHeader.length,
  });
  assert.ok(fits.includes(groupLoopHeader));
  const wraps = await stable(groupLoop, {
    printWidth: groupLoopHeader.length - 1,
    bicepIfConditionLayout: "wrap",
  });
  assert.match(wraps, / = \[\n  for group/);
  const inline = await stable(groupLoop, {
    printWidth: groupLoopHeader.length - 1,
  });
  assert.ok(inline.includes(groupLoopHeader));
  assert.match(wraps, /\n    name: group\.name\n/);
});

test("module loops use compact headers and close brackets together", async () => {
  const output = await stable(
    "param ids array=[]\nmodule consumers './consumer.bicep'=[for (id,i) in ids:if(!empty(id)){name:'consumer-${i}',params:{parentId:id}}]\n",
  );
  assert.match(
    output,
    / = \[for \(id, i\) in ids: if \(!empty\(id\)\) \{\n  name:/,
  );
  assert.ok(output.endsWith("  }\n}]\n"));
});

test("fitting call-expression loops collapse their object argument and array brackets", async () => {
  const source =
    "output widgets array = [for (widget, i) in widgets: union(widgetResults[i].outputs.metadata, {\n" +
    "  entries: widgetResults[i].outputs.entries\n" +
    "})]\n";
  const compact =
    "output widgets array = [for (widget, i) in widgets: union(widgetResults[i].outputs.metadata, {entries: widgetResults[i].outputs.entries})]\n";
  assert.equal(await stable(source), compact);
  assert.equal(
    await stable(
      "output x array=[for i in values: union(items[i], {name:'{ keep }', details:{enabled:true}})]\n",
    ),
    "output x array = [for i in values: union(items[i], {name: '{ keep }', details: {enabled: true}})]\n",
  );
  assert.equal(
    await stable("output x object={value:'keep ordinary object spacing'}\n", {
      bicepObjectLayout: "auto",
    }),
    "output x object = { value: 'keep ordinary object spacing' }\n",
  );
  assert.equal(await stable(source, { bicepObjectLayout: "auto" }), compact);
  assert.equal(
    await stable(
      "param names array=[]\noutput upper array=[for name in names: toUpper(name)]\n",
    ),
    "param names array = []\n\noutput upper array = [for name in names: toUpper(name)]\n",
  );
  assert.equal(
    await stable(
      source
        .replaceAll("widgets", "batches")
        .replaceAll("widget", "batch")
        .replace(
          "batchResults[i].outputs.entries",
          "batchResults[0].outputs.entries",
        ),
    ),
    compact
      .replaceAll("widgets", "batches")
      .replaceAll("widget", "batch")
      .replace(
        "batchResults[i].outputs.entries",
        "batchResults[0].outputs.entries",
      ),
  );
  assert.match(
    await stable(source, { printWidth: compact.trimEnd().length - 1 }),
    / = \[\n  for \(widget, i\)/,
  );
  assert.equal(
    await stable(source, { printWidth: compact.trimEnd().length }),
    compact,
  );
  assert.equal(
    await stable(source, { bicepLoopLayout: "preserve", printWidth: 40 }),
    compact,
  );
  assert.match(
    await stable(source, { bicepLoopLayout: "expanded" }),
    / = \[\n  for \(widget, i\)/,
  );
  assert.match(
    await stable(source, { bicepObjectLayout: "preserve" }),
    /union\(widgetResults\[i\]\.outputs\.metadata, \{\n/,
  );
  assert.equal(
    await stable(
      compact
        .replace("{entries:", "{ entries:")
        .replace(".entries})]", ".entries })]"),
      {
        bicepObjectLayout: "preserve",
        bicepLoopLayout: "preserve",
      },
    ),
    compact,
  );
  const commented = source.replace(
    "  entries:",
    "  // keep attached to entries\n  entries:",
  );
  assert.match(await stable(commented), / = \[\n  for \(widget, i\)/);
  assert.equal(
    await stable("// prettier-ignore\n" + source),
    "// prettier-ignore\n" + source,
  );
  const multilineLiteral = source
    .replace(
      "widgetResults[i].outputs.entries",
      "'''\\n    keep indentation\\n  '''",
    )
    .replaceAll("\\n", "\n");
  assert.match(await stable(multilineLiteral), / = \[\n  for \(widget, i\)/);
});

test("small arrays of objects stay compact inside multiline calls when they fit", async () => {
  const source =
    "var summary = {\n" +
    "  records: union(\n" +
    "    [{code: primary.code}],\n" +
    "    map(secondary.items, item => {\n" +
    "      code: format('{0}/{1}/{2}', item.group, item.name, item.region)\n" +
    "    })\n" +
    "  )\n" +
    "}\n";
  assert.equal(await stable(source), source);
  const pair = "var entries = [{code: first.id}, {code: second.id}]\n";
  assert.equal(await stable(pair), pair);
  assert.equal(
    await stable("var entries = [{code: first.id}\n{code: second.id}]\n"),
    pair,
  );
  assert.equal(await stable(pair, { printWidth: pair.trimEnd().length }), pair);
  assert.match(
    await stable(pair, { printWidth: pair.trimEnd().length - 1 }),
    /var entries = \[\n/,
  );
  assert.equal(
    await stable("var entries = [{code: first.id, enabled: true}]\n"),
    "var entries = [{code: first.id, enabled: true}]\n",
  );
  assert.equal(
    await stable("var result = {entries: [{code: first.id}]}\n"),
    "var result = {\n  entries: [{code: first.id}]\n}\n",
  );
  assert.equal(
    await stable("var entries = [{code: first.id, meta: {region: name}}]\n"),
    "var entries = [{code: first.id, meta: {region: name}}]\n",
  );
  assert.match(
    await stable(
      "var entries = [{code: first.id, enabled: true, region: name}]\n",
    ),
    /var entries = \[\n/,
  );
  assert.match(
    await stable(
      "var entries = [{code: first.id, meta: {one: 1, two: 2, three: 3}}]\n",
    ),
    /var entries = \[\n/,
  );
  assert.match(
    await stable(pair, { bicepArrayLayout: "multiline" }),
    /var entries = \[\n/,
  );
  assert.match(
    await stable("var entries = [\n  {code: first.id}\n]\n", {
      bicepArrayLayout: "preserve",
    }),
    /var entries = \[\n/,
  );
  assert.equal(
    await stable(pair, { bicepArrayLayout: "preserve", printWidth: 12 }),
    pair,
  );
  assert.match(
    await stable("var entries = [{\n  code: first.id\n}]\n", {
      bicepObjectLayout: "preserve",
    }),
    /var entries = \[\n/,
  );
  assert.equal(await stable(pair, { bicepObjectLayout: "preserve" }), pair);
  assert.match(
    await stable(
      "var entries = [{code: first.id, meta: {\n  region: name\n}}]\n",
      { bicepObjectLayout: "preserve" },
    ),
    /var entries = \[\n/,
  );
  const commented = "var entries = [{code: first.id // keep\n}]\n";
  assert.match(await stable(commented), /\/\/ keep/);
  assert.match(await stable(commented), /var entries = \[\n/);
  assert.match(
    await stable("var entries = [{code: '''\n  keep indentation\n'''}]\n"),
    /var entries = \[\n/,
  );
  assert.equal(await stable(pair, { useTabs: true, tabWidth: 4 }), pair);
});

test("fitting property-value calls collapse object arguments without brace padding", async () => {
  const source =
    "output plan object = {\n" +
    "  usesAcceleration: union({ accelerated : false }, computeProfiles[i].properties).accelerated\n" +
    "}\n";
  const compact =
    "output plan object = {\n" +
    "  usesAcceleration: union({accelerated: false}, computeProfiles[i].properties).accelerated\n" +
    "}\n";
  assert.equal(await stable(source), compact);
  const line = compact.split("\n")[1];
  assert.equal(await stable(source, { printWidth: line.length }), compact);
  assert.match(
    await stable(source, { printWidth: line.length - 1 }),
    /usesAcceleration: union\(\n/,
  );
  assert.equal(await stable(source, { bicepObjectLayout: "auto" }), compact);
  assert.match(
    await stable(
      source.replace(
        "{ accelerated : false }",
        "{\n    accelerated: false\n  }",
      ),
      { bicepObjectLayout: "preserve" },
    ),
    /usesAcceleration: union\(\n/,
  );
  assert.match(
    await stable(
      source.replace(
        "accelerated : false",
        "accelerated: /* keep comment */ false",
      ),
    ),
    /\/\* keep comment \*\//,
  );
  assert.equal(
    await stable("// prettier-ignore\n" + source),
    "// prettier-ignore\n" + source,
  );
});

test("logical conditions keep nested function calls inline unless wrapping is requested", async () => {
  const input =
    "param groups array=[]\nparam baseGroup object={}\n" +
    "module services 'modules/services.bicep' = [for (group, i) in groups: if (!empty(union(baseGroup, group).frontends) || !empty(union(baseGroup, group).processors) || !empty(union(baseGroup, group).batches) || !empty(union(baseGroup, group).widgets)) {\n" +
    "name:'services-${i}'\nparams:{}\n}]\n";
  const inline = await stable(input);
  assert.match(inline, /!empty\(union\(baseGroup, group\)\.batches\)/);
  assert.doesNotMatch(inline, /union\(\s*\n/);
  const wrapped = await stable(input, { bicepLogicalCallLayout: "wrap" });
  assert.match(wrapped, /union\(\s*\n\s*baseGroup,/);
  const conjunction = input.replaceAll(" || ", " && ");
  assert.doesNotMatch(await stable(conjunction), /union\(\s*\n/);
  assert.match(
    await stable(conjunction, { bicepLogicalCallLayout: "wrap" }),
    /union\(\s*\n/,
  );
  const commented = input.replace(
    "union(baseGroup, group).batches",
    "union(baseGroup, /* retain */ group).batches",
  );
  assert.match(await stable(commented), /\/\* retain \*\//);
  const lineCommented = input.replace(
    "union(baseGroup, group).batches",
    "union(baseGroup, // retain\n group).batches",
  );
  assert.match(
    await stable(lineCommented),
    /union\(\n\s*baseGroup,\n\s*\/\/ retain\n\s*group\n\s*\)\.batches/,
  );
  assert.doesNotMatch(
    await stable(
      "output value object = { result: union(baseGroup, group) }\n",
      {
        printWidth: 30,
      },
    ),
    /result: union\(baseGroup, group\)/,
  );
});

test("logical ternary conditions keep calls inline by default", async () => {
  const source =
    "var config = {\n" +
    "  pricingTier: recordConfig.sku.name =~ 'Shared' || startsWith(recordConfig.sku.name, 'S') || startsWith(recordConfig.sku.name, 'P') || startsWith(recordConfig.sku.name, 'Starter') || contains(recordConfig.sku.name, '_T_')\n" +
    "    ? null\n" +
    "    : recordConfig.discountAvailable ? 'Discounted' : 'Regular'\n" +
    "}\n";
  assert.equal(await stable(source), source);
  assert.match(
    await stable(source, { bicepLogicalCallLayout: "wrap" }),
    /contains\(\n\s+recordConfig\.sku\.name,/,
  );
  assert.match(
    await stable(source, { bicepLogicalCallLayout: "preserve" }),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
  const broken = source.replace(
    "contains(recordConfig.sku.name, '_T_')",
    "contains(\n      recordConfig.sku.name,\n      '_T_'\n    )",
  );
  assert.match(
    await stable(broken, {
      bicepLogicalCallLayout: "preserve",
      printWidth: 220,
    }),
    /contains\(\n\s+recordConfig\.sku\.name,/,
  );
  const commented = source.replace(
    "contains(recordConfig.sku.name, '_T_')",
    "contains(recordConfig.sku.name, /* keep */ '_T_')",
  );
  assert.match(await stable(commented), /\/\* keep \*\//);
  assert.match(
    await stable(source, { tabWidth: 4, useTabs: true }),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
});

test("calls under logical operators use the same layout outside condition headers", async () => {
  const source =
    "var enabled = startsWith(recordConfig.sku.name, 'Starter') || contains(recordConfig.sku.name, '_T_')\n";
  const width = { printWidth: 40 };
  const inline = await stable(source, width);
  assert.match(inline, /startsWith\(recordConfig\.sku\.name, 'Starter'\)/);
  assert.match(inline, /contains\(recordConfig\.sku\.name, '_T_'\)/);
  const wrapped = await stable(source, {
    ...width,
    bicepLogicalCallLayout: "wrap",
  });
  assert.match(wrapped, /startsWith\(\n/);
  const authored = source.replace(
    "contains(recordConfig.sku.name, '_T_')",
    "contains(\n  recordConfig.sku.name,\n  '_T_'\n)",
  );
  assert.match(
    await stable(authored, {
      printWidth: 220,
      bicepLogicalCallLayout: "preserve",
    }),
    /contains\(\n\s+recordConfig\.sku\.name,/,
  );
  assert.match(
    await stable(source, {
      ...width,
      bicepLogicalCallLayout: "preserve",
    }),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
  const conjunction = source.replace(" || ", " && ");
  assert.match(
    await stable(conjunction, width),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
  const nested = source.replace(
    "startsWith(recordConfig.sku.name, 'Starter')",
    "empty(union(recordConfig.sku.name, other.name))",
  );
  assert.match(
    await stable(nested, width),
    /union\(recordConfig\.sku\.name, other\.name\)/,
  );
  assert.match(
    await stable(
      source
        .replace("var enabled = ", "var flags = { enabled: ")
        .replace(/\n$/, " }\n"),
      width,
    ),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
  assert.match(
    await stable(source, {
      ...width,
      filepath: resolve("test", "fixtures", "main.bicepparam"),
    }),
    /contains\(recordConfig\.sku\.name, '_T_'\)/,
  );
  assert.match(
    await stable("var value = contains(recordConfig.sku.name, '_T_')\n", width),
    /contains\(\n/,
  );
  assert.match(
    await stable(
      source.replace(
        "contains(recordConfig.sku.name, '_T_')",
        "contains(recordConfig.sku.name, /* keep */ '_T_')",
      ),
      width,
    ),
    /\/\* keep \*\//,
  );
});

test("outer call layout does not flatten logical calls with their own policy", async () => {
  const source =
    "resource sample 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (bool(contains('long-option-value', 'alpha') || contains('another-long-option-value', 'beta'))) {\n" +
    "  name: 'sample'\n  location: 'westeurope'\n}\n";
  for (const bicepIfConditionLayout of ["preserve", "inline"]) {
    const output = await stable(source, {
      printWidth: 35,
      bicepConditionalHeader: "inline",
      bicepIfConditionLayout,
      bicepLogicalCallLayout: "wrap",
    });
    assert.match(output, /contains\(\n\s+'long-option-value',/);
  }
  const authored = source.replace(
    "contains('another-long-option-value', 'beta')",
    "contains(\n  'another-long-option-value',\n  'beta'\n)",
  );
  assert.match(
    await stable(authored, {
      printWidth: 35,
      bicepConditionalHeader: "inline",
      bicepIfConditionLayout: "inline",
      bicepLogicalCallLayout: "preserve",
    }),
    /contains\(\n\s+'another-long-option-value',/,
  );
});

test("compact expressions retain nested source-preserved logical call breaks", async () => {
  const nested =
    "contains('long-option-value', 'alpha') || contains(\n'another-long-option-value',\n'beta'\n)";
  const examples = [
    `var sample = union({value: ${nested}}, {ready: true})\n`,
    `var sample = [{value: ${nested}}]\n`,
    `var sample = {value: true ? {ready: ${nested}} : null}\n`,
    `var sample = [for item in ['a']: union({value: ${nested}}, {ready: item})]\n`,
  ];
  for (const source of examples) {
    assert.match(
      await stable(source, {
        bicepLogicalCallLayout: "preserve",
        printWidth: 180,
      }),
      /contains\(\n\s+'another-long-option-value',/,
    );
  }
  assert.match(
    await stable(`using none\nparam sample = [{value: ${nested}}]\n`, {
      filepath: resolve("test", "fixtures", "main.bicepparam"),
      bicepLogicalCallLayout: "preserve",
      printWidth: 180,
    }),
    /contains\(\n\s+'another-long-option-value',/,
  );
  assert.match(
    await stable(
      "var sample = union({value: contains('long-option-value', 'alpha') || contains('another-long-option-value', 'beta')}, {ready: true})\n",
      { bicepLogicalCallLayout: "wrap", printWidth: 45 },
    ),
    /contains\(\n\s+'another-long-option-value',/,
  );
});

test("nested object loops compact consistently with tabs and spaces", async () => {
  const source =
    "output items array=[for x in ['one']:{nested:[for y in ['two']:{value:'${x}-${y}'}]}]\n";
  for (const preferences of [
    {},
    { tabWidth: 4 },
    { useTabs: true, tabWidth: 4 },
  ]) {
    const output = await stable(source, preferences);
    const indent = preferences.useTabs
      ? "\t"
      : " ".repeat(preferences.tabWidth ?? 2);
    assert.ok(output.includes("output items array = [for x in ['one']: {\n"));
    assert.ok(
      output.includes(
        `${indent}nested: [for y in ['two']: {\n${indent}${indent}value:`,
      ),
    );
    assert.ok(output.endsWith(`${indent}}]\n}]\n`));
  }
});

test("loop indentation preserves multiline literals, comments, and ignored declarations", async () => {
  const literal = "'''\n    significant indentation\n  more content\n'''";
  const comment = "/* first\n    significant comment indentation\n  last */";
  const source = `output items array=[for x in ['one']:{\n${comment}\nvalue:${literal}\n}]\n`;
  const output = await stable(source);
  assert.ok(output.includes(literal));
  assert.ok(output.includes(comment));
  const ignored = "// prettier-ignore\n" + source;
  assert.equal(await stable(ignored), ignored);
});

test("comments between loop brackets and the body prevent unsafe compaction", async () => {
  const output = await stable(
    "output items array=[\n// Keep this comment\nfor x in ['one']:{value:x}\n// Keep the closing comment\n]\n",
  );
  assert.match(output, /\[\n  \/\/ Keep this comment\n/);
  assert.match(output, /\/\/ Keep the closing comment\n\]/);
});

test("diagnostic regions and next-line suppression retain their effect", async () => {
  const source =
    "#disable-diagnostics no-unused-vars\nvar ignored='one'\n#restore-diagnostics no-unused-vars\n#disable-next-line no-unused-params\nparam unused string\noutput result string='two'\n";
  const output = await stable(source);
  assert.ok(
    output.includes("#disable-next-line no-unused-params\nparam unused"),
  );
  assert.ok(
    output.indexOf("#disable-diagnostics") < output.indexOf("var ignored"),
  );
  assert.ok(
    output.indexOf("var ignored") < output.indexOf("#restore-diagnostics"),
  );
});

test("multiline string contents, escapes, and interpolation are preserved", async () => {
  const source =
    "param name string='world'\noutput text string='''\n  hello  \n\n    world\n'''\noutput escaped string='hello ${name}, \\'quoted\\''\n";
  const output = await stable(source);
  assert.ok(output.includes("'''\n  hello  \n\n    world\n'''"));
  assert.ok(output.includes("'hello ${name}, \\'quoted\\''"));
});

test("UTF-8 comments and string contents survive the native bridge exactly", async () => {
  const text =
    "// \u2500\u2500 \u65e5\u672c\u8a9e \ud83d\ude80\noutput greeting string = '\u0417\u0434\u0440\u0430\u0432\u0435\u0439, \u4e16\u754c'\n";
  assert.equal(await stable(text), text);
});

test("optional leading union separator is normalized without changing its type", async () => {
  const output = await stable("type Single = | 'alone'\nparam value Single\n");
  assert.match(output, /type Single = 'alone'/);
});

test("parameter file variables precede first use without sorting assignments", async () => {
  const output = await stable(
    "using none\nvar prefix='dev'\nparam location='westeurope'\nparam name='${prefix}storage'\n",
    {
      filepath: resolve("test", "fixtures", "main.bicepparam"),
    },
  );
  assert.deepEqual(names(output), ["location", "prefix", "name"]);
});

test("explicit parameter parser works without a parameter-file extension", async () => {
  const output = await stable("using none\nparam name='example'\n", {
    filepath: resolve("test", "fixtures", "Untitled-1"),
    parser: "bicepparam",
  });
  assert.equal(output, "using none\n\nparam name = 'example'\n");
});

test("sorting and layout options can be disabled or changed", async () => {
  const output = await stable(
    "output result object=tags\nvar tags={'env':'dev'}\n",
    {
      bicepSortDeclarations: false,
      bicepObjectLayout: "auto",
      bicepQuoteProperties: "preserve",
      bicepDeclarationSpacing: "compact",
    },
  );
  assert.deepEqual(names(output), ["result", "tags"]);
  assert.ok(output.includes("{ 'env': 'dev' }"));
  assert.ok(!output.includes("\n\n"));
});

test("syntax errors fail explicitly without returning output", async () => {
  await assert.rejects(
    format("resource broken = {"),
    /Bicep formatting refused: BCP/,
  );
});

test("invalid configuration fails explicitly", async () => {
  await assert.rejects(
    format("param name string\n", {
      bicepDecoratorOrder: ["description", "description"],
    }),
    /must not contain duplicates/,
  );
});

test("range formatting is rejected rather than reordering part of a file", async () => {
  await assert.rejects(
    format("param a string\nparam b string\n", { rangeStart: 3, rangeEnd: 10 }),
    /whole-document formatting only/,
  );
});
