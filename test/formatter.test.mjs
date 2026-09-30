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
    "extension 'br:mcr.microsoft.com/bicep/extensions/microsoftgraph/v1.0:1.0.0'";
  assert.equal(
    await stable(`${extension}  as microsoftGraphV1_0\n`),
    `${extension} as microsoftGraphV1_0\n`,
  );
  assert.equal(
    await stable(`${extension}    as    microsoftGraphV1_0\n`),
    `${extension} as microsoftGraphV1_0\n`,
  );
  assert.equal(
    await stable("param  name  string\nvar  value = 'a  b' // keep  comment\n"),
    "param name string\n\nvar value = 'a  b' // keep  comment\n",
  );
  assert.equal(
    await stable(`// prettier-ignore\n${extension}  as microsoftGraphV1_0\n`),
    `// prettier-ignore\n${extension}  as microsoftGraphV1_0\n`,
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

test("conditional header stays on the declaration line beyond print width", async () => {
  const output = await stable(
    "param deploy bool=true\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'=if(deploy){name:'example',location:'westeurope'}\n",
    { printWidth: 40 },
  );
  assert.match(output, /^resource identity .* = if \(deploy\) \{$/m);
});

test("single lambda parameter parentheses are removed", async () => {
  const output = await stable(
    "param names array=[]\noutput result array=map(names,(name)=>toLower(name))\n",
  );
  assert.match(output, /map\(names, name => toLower\(name\)\)/);
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
    "param slot object",
    "param operatingSystem string",
    "output site object = {",
    "  properties: {",
    "    siteConfig: {",
    "      linuxFxVersion: kind == 'functionapp' && slot.functionRuntimeVersion == 0",
    "        ? null",
    "        : operatingSystem == 'Linux'",
    "            ? empty(slot.linuxFxVersion)",
    "                // javaVersion and javaContainer properties are not allowed for function apps",
    "                ? slot.runtime =~ 'Java' && kind != 'functionapp'",
    "                    ? slot.javaContainer =~ 'Tomcat'",
    "                        ? slot.javaVersion == '1.8' ? 'TOMCAT|${slot.runtimeVersion}-jre8' : 'TOMCAT|${slot.runtimeVersion}-java${slot.javaVersion}'",
    "                        : slot.javaContainer =~ 'Jboss'",
    "                            ? 'JBOSSEAP|${slot.runtimeVersion}-java${slot.javaVersion}'",
    "                            : slot.javaContainer =~ 'Java'",
    "                                ? slot.javaVersion == '1.8' ? 'JAVA|8-jre8' : 'JAVA|${slot.javaVersion}-java${slot.javaVersion}'",
    "                                : 'JAVA|${slot.runtimeVersion}'",
    "                    // When runtime is provided, runtimeVersion is required for all runtimes except Docker and Custom",
    "                    : slot.runtime =~ 'Sidecar'",
    "                        ? 'sitecontainers'",
    "                        : slot.runtime =~ 'Docker'",
    "                            ? 'DOCKER|${slot.dockerContainerName}'",
    "                            : !empty(slot.runtime) && slot.runtime != 'Custom' ? '${toUpper(slot.runtime)}|${slot.runtimeVersion}' : null",
    "                : slot.linuxFxVersion",
    "            : null",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const output = await stable(source, { tabWidth: 2 });
  assert.match(output, /\n {6}linuxFxVersion:/);
  assert.match(output, /\n {8}\? null\n/);
  assert.match(output, /\n {10}\? empty\(slot\.linuxFxVersion\)/);
  assert.match(output, /\n {12}\/\/ javaVersion/);
  assert.match(output, /\n {12}\? slot\.runtime =~ 'Java'/);
  assert.match(output, /\n {14}\? slot\.javaContainer =~ 'Tomcat'/);
  assert.match(output, /\n {16}\? slot\.javaVersion == '1\.8'/);
  assert.match(output, /\n {14}\/\/ When runtime is provided/);
  assert.match(output, /\n {14}: slot\.runtime =~ 'Sidecar'/);
  assert.match(output, /\n {12}: slot\.linuxFxVersion/);
  assert.match(output, /\n {10}: null\n/);
  const fourSpaces = await stable(source, { tabWidth: 4 });
  assert.match(fourSpaces, /\n {12}linuxFxVersion:/);
  assert.match(fourSpaces, /\n {20}\? empty\(slot\.linuxFxVersion\)/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{3}linuxFxVersion:/);
  assert.match(tabs, /\n\t{5}\? empty\(slot\.linuxFxVersion\)/);
});

test("conditional object branches indent their contents once after the question or colon", async () => {
  const source = [
    "var config = {",
    "  customDnsSuffixConfiguration: !empty(appServiceEnvironment.customDnsSuffix.dnsSuffix)",
    "    ? {",
    "        // incorrect API schema",
    "        dnsSuffix: appServiceEnvironment.customDnsSuffix.dnsSuffix",
    "        certificateUrl: customDnsSuffixCertificate!.properties.secretUri",
    "        keyVaultReferenceIdentity: !empty(appServiceEnvironment.customDnsSuffix.identity.name) ? customDnsSuffixIdentity.id : 'systemassigned'",
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
  assert.match(fourSpaces, /\n {8}\? \{\n {12}\/\/ incorrect API schema/);
  assert.match(fourSpaces, /\n {12}dnsSuffix:/);
  assert.match(fourSpaces, /\n {8}\}\n {8}: null/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{2}\? \{\n\t{3}\/\/ incorrect API schema/);
  assert.match(tabs, /\n\t{2}\}\n\t{2}: null/);
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

test("multiline ternaries in array comprehensions indent branches past the loop body", async () => {
  const source = [
    "var config = {",
    "  allowedClientApplications: [",
    "    for (allowedApplication, i) in union(defaultIdentityProviders, authenticationSettings.identityProviders).microsoftEntraId.validation.jwtClaimChecks.allowedClientApplications: union(",
    "        defaultIdentityProviders,",
    "        authenticationSettings.identityProviders",
    "      ).microsoftEntraId.referenceType == 'UniqueNames'",
    "      ? entraJwtAllowedApplications[i]!.appId",
    "      : allowedApplication",
    "  ]",
    "}",
    "",
  ].join("\n");
  const expected = source
    .replace(
      "\n      ? entraJwtAllowedApplications",
      "\n        ? entraJwtAllowedApplications",
    )
    .replace("\n      : allowedApplication", "\n        : allowedApplication");
  assert.equal(await stable(source, { tabWidth: 2 }), expected);
  const fourSpaces = await stable(source, { tabWidth: 4 });
  assert.match(fourSpaces, /\n {8}for \(allowedApplication, i\)/);
  assert.match(fourSpaces, /\n {16}\? entraJwtAllowedApplications/);
  assert.match(fourSpaces, /\n {16}: allowedApplication/);
  const tabs = await stable(source, { tabWidth: 4, useTabs: true });
  assert.match(tabs, /\n\t{2}for \(allowedApplication, i\)/);
  assert.match(tabs, /\n\t{4}\? entraJwtAllowedApplications/);
  assert.match(tabs, /\n\t{4}: allowedApplication/);
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

const resourceGroupLoopHeader =
  "resource resourceGroupsRes 'Microsoft.Resources/resourceGroups@2025-04-01' = [for resourceGroup in resourceGroups: if (union(defaultResourceGroup, resourceGroup).create) {";
const resourceGroupLoop =
  "targetScope='subscription'\nparam resourceGroups array=[]\nparam tags object={}\nvar defaultResourceGroup={create:true,tags:{}}\n" +
  resourceGroupLoopHeader +
  "\nname:resourceGroup.name\nlocation:resourceGroup.location\ntags:union(tags,union(defaultResourceGroup,resourceGroup).tags)\nproperties:{}\n}]\n";

test("conditional resource loop header fits on one line with a single body indent", async () => {
  assert.ok(resourceGroupLoopHeader.length <= 180);
  const output = await stable(resourceGroupLoop, { printWidth: 180 });
  assert.ok(
    output.includes(resourceGroupLoopHeader + "\n  name: resourceGroup.name\n"),
  );
  assert.ok(output.endsWith("  properties: {}\n}]\n"));
});

test("conditional loop headers stay inline beyond width unless if-call wrapping is requested", async () => {
  const source =
    "resource entraJwtAllowedApplications 'Microsoft.Graph/applications@v1.0' existing = [\n" +
    "  for allowedApplication in (union(defaultIdentityProviders, authenticationSettings.identityProviders).microsoftEntraId.validation.jwtClaimChecks.allowedClientApplications): if (union(\n" +
    "    defaultIdentityProviders,\n" +
    "    authenticationSettings.identityProviders\n" +
    "  ).microsoftEntraId.referenceType == 'UniqueNames') {\n" +
    "    uniqueName: allowedApplication\n" +
    "  }\n" +
    "]\n";
  const inline = await stable(source);
  const header =
    "resource entraJwtAllowedApplications 'Microsoft.Graph/applications@v1.0' existing = [for allowedApplication in (union(defaultIdentityProviders, authenticationSettings.identityProviders).microsoftEntraId.validation.jwtClaimChecks.allowedClientApplications) : if (union(defaultIdentityProviders, authenticationSettings.identityProviders).microsoftEntraId.referenceType == 'UniqueNames') {";
  assert.ok(header.length > 180);
  assert.ok(inline.includes(header + "\n  uniqueName: allowedApplication\n}]"));
  assert.doesNotMatch(inline, /if \(union\(\s*\n/);
  const wrapped = await stable(source, { bicepIfConditionLayout: "wrap" });
  assert.match(wrapped, / = \[\n  for allowedApplication/);
  assert.match(wrapped, /if \(union\(\n\s+defaultIdentityProviders,/);
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
    / = \[\n  for allowedApplication/,
  );
  const expanded = await stable(source, { bicepLoopLayout: "expanded" });
  assert.match(expanded, / = \[\n  for allowedApplication/);
  assert.match(
    expanded,
    /if \(union\(defaultIdentityProviders, authenticationSettings\.identityProviders\)/,
  );
  const commented = source.replace(
    "    authenticationSettings.identityProviders\n  ).microsoftEntraId.referenceType",
    "    /* preserve comment */ authenticationSettings.identityProviders\n  ).microsoftEntraId.referenceType",
  );
  const safe = await stable(commented);
  assert.match(safe, /\/\* preserve comment \*\//);
  assert.match(safe, / = \[\n  for allowedApplication/);
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

test("object loop wrapping changes at the exact header width", async () => {
  const fits = await stable(resourceGroupLoop, {
    printWidth: resourceGroupLoopHeader.length,
  });
  assert.ok(fits.includes(resourceGroupLoopHeader));
  const wraps = await stable(resourceGroupLoop, {
    printWidth: resourceGroupLoopHeader.length - 1,
    bicepIfConditionLayout: "wrap",
  });
  assert.match(wraps, / = \[\n  for resourceGroup/);
  const inline = await stable(resourceGroupLoop, {
    printWidth: resourceGroupLoopHeader.length - 1,
  });
  assert.ok(inline.includes(resourceGroupLoopHeader));
  assert.match(wraps, /\n    name: resourceGroup\.name\n/);
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
    "output apiApps array = [for (apiApp, i) in apiApps: union(apiAppsRes[i].outputs.siteProperties, {\n" +
    "  slots: apiAppsRes[i].outputs.slots\n" +
    "})]\n";
  const compact =
    "output apiApps array = [for (apiApp, i) in apiApps: union(apiAppsRes[i].outputs.siteProperties, { slots: apiAppsRes[i].outputs.slots })]\n";
  assert.equal(await stable(source), compact);
  assert.equal(
    await stable(
      "param names array=[]\noutput upper array=[for name in names: toUpper(name)]\n",
    ),
    "param names array = []\n\noutput upper array = [for name in names: toUpper(name)]\n",
  );
  assert.equal(
    await stable(
      source
        .replaceAll("apiApps", "logicAppsStandard")
        .replaceAll("apiApp", "logicApp")
        .replace(
          "logicAppsStandardRes[i].outputs.slots",
          "logicAppsStandardRes[0].outputs.slots",
        ),
    ),
    compact
      .replaceAll("apiApps", "logicAppsStandard")
      .replaceAll("apiApp", "logicApp")
      .replace(
        "logicAppsStandardRes[i].outputs.slots",
        "logicAppsStandardRes[0].outputs.slots",
      ),
  );
  assert.match(
    await stable(source, { printWidth: compact.trimEnd().length - 1 }),
    / = \[\n  for \(apiApp, i\)/,
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
    / = \[\n  for \(apiApp, i\)/,
  );
  assert.match(
    await stable(source, { bicepObjectLayout: "preserve" }),
    /union\(apiAppsRes\[i\]\.outputs\.siteProperties, \{\n/,
  );
  const commented = source.replace(
    "  slots:",
    "  // keep attached to slots\n  slots:",
  );
  assert.match(await stable(commented), / = \[\n  for \(apiApp, i\)/);
  assert.equal(
    await stable("// prettier-ignore\n" + source),
    "// prettier-ignore\n" + source,
  );
  const multilineLiteral = source
    .replace(
      "apiAppsRes[i].outputs.slots",
      "'''\\n    keep indentation\\n  '''",
    )
    .replaceAll("\\n", "\n");
  assert.match(await stable(multilineLiteral), / = \[\n  for \(apiApp, i\)/);
});

test("logical conditions keep nested function calls inline unless wrapping is requested", async () => {
  const input =
    "param resourceGroups array=[]\nparam defaultResourceGroup object={}\n" +
    "module sites 'modules/sites.bicep' = [for (resourceGroup, i) in resourceGroups: if (!empty(union(defaultResourceGroup, resourceGroup).webApps) || !empty(union(defaultResourceGroup, resourceGroup).functionApps) || !empty(union(defaultResourceGroup, resourceGroup).logicAppsStandard) || !empty(union(defaultResourceGroup, resourceGroup).apiApps)) {\n" +
    "name:'sites-${i}'\nparams:{}\n}]\n";
  const inline = await stable(input);
  assert.match(
    inline,
    /!empty\(union\(defaultResourceGroup, resourceGroup\)\.logicAppsStandard\)/,
  );
  assert.doesNotMatch(inline, /union\(\s*\n/);
  const wrapped = await stable(input, { bicepLogicalCallLayout: "wrap" });
  assert.match(wrapped, /union\(\s*\n\s*defaultResourceGroup,/);
  const conjunction = input.replaceAll(" || ", " && ");
  assert.doesNotMatch(await stable(conjunction), /union\(\s*\n/);
  assert.match(
    await stable(conjunction, { bicepLogicalCallLayout: "wrap" }),
    /union\(\s*\n/,
  );
  const commented = input.replace(
    "union(defaultResourceGroup, resourceGroup).logicAppsStandard",
    "union(defaultResourceGroup, /* retain */ resourceGroup).logicAppsStandard",
  );
  assert.match(await stable(commented), /\/\* retain \*\//);
  assert.doesNotMatch(
    await stable(
      "output value object = { result: union(defaultResourceGroup, resourceGroup) }\n",
      {
        printWidth: 30,
      },
    ),
    /result: union\(defaultResourceGroup, resourceGroup\)/,
  );
});

test("nested object loops compact consistently with tabs and spaces", async () => {
  const source =
    "output items array=[for x in ['one']:{nested:[for y in ['two']:{value:'${x}-${y}'}]}]\n";
  for (const settings of [
    {},
    { tabWidth: 4 },
    { useTabs: true, tabWidth: 4 },
  ]) {
    const output = await stable(source, settings);
    const indent = settings.useTabs ? "\t" : " ".repeat(settings.tabWidth ?? 2);
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
