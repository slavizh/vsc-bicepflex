import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { format } from "prettier";
import plugin, { BicepFormattingError } from "../dist/index.js";
import { bridgeProtocolVersion } from "../dist/bridge.js";

const filepath = resolve("test", "fixtures", "native-coverage.bicep");
const request = (options = {}, overrides = {}) => ({
  protocolVersion: bridgeProtocolVersion,
  text: "param name string\n",
  filepath,
  options,
  ...overrides,
});

async function bridge(lines) {
  const child = spawn(
    "dotnet",
    [resolve("dist", "bridge", "Bicep.Formatter.dll")],
    {
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const finished = new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", (code) => done(code));
  });
  child.stdin.end(
    lines
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n") + "\n",
  );
  const code = await finished;
  assert.equal(stderr, "");
  const responses = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, lines.length);
  assert.equal(code, responses.some((response) => response.error) ? 1 : 0);
  return responses;
}

async function stable(source, options = {}) {
  const settings = { plugins: [plugin], filepath, endOfLine: "lf", ...options };
  const output = await format(source, settings);
  assert.equal(await format(output, settings), output);
  return output;
}

test("native bridge rejects malformed requests but continues processing subsequent lines", async () => {
  const responses = await bridge([
    "{bad json",
    "null",
    request({}, { text: null }),
    request([], { options: [] }),
    request({}, { options: null }),
    request({}, { options: "not an object" }),
    request({}, { parser: "bicep" }),
  ]);
  assert.deepEqual(
    responses.slice(0, 6).map((r) => r.code),
    [
      "BICEP_INVALID_REQUEST",
      "BICEP_FORMATTING_REFUSED",
      "BICEP_INVALID_REQUEST",
      "BICEP_INVALID_CONFIGURATION",
      "BICEP_INVALID_CONFIGURATION",
      "BICEP_INVALID_CONFIGURATION",
    ],
  );
  assert.match(responses[2].error, /source text/);
  assert.match(responses[3].error, /JSON object/);
  assert.equal(responses[6].text, "param name string\n");
});

test("native option validation identifies invalid types, ranges, names, and decorators", async () => {
  const cases = [
    [{ bicepTabWidth: -1 }, /bicepTabWidth/],
    [{ bicepTabWidth: 1001 }, /bicepTabWidth/],
    [{ bicepPrintWidth: -1 }, /bicepPrintWidth/],
    [{ bicepIndentStyle: "mixed" }, /bicepIndentStyle/],
    [{ bicepLogicalCallLayout: "invalid" }, /bicepLogicalCallLayout/],
    [{ bicepParameterSpacing: "invalid" }, /bicepParameterSpacing/],
    [{ printWidth: 0 }, /printWidth/],
    [{ tabWidth: 1001 }, /tabWidth/],
    [{ bicepDeclarationOrder: null }, /Ordering settings/],
    [{ bicepDeclarationOrder: ["param", "bad-name"] }, /Ordering settings/],
    [
      { bicepDeclarationOrder: ["param", "unknown"] },
      /unknown declaration kind/,
    ],
    [
      { bicepDecoratorOrder: ["description", "unknown"] },
      /unknown built-in decorator/,
    ],
    [{ bicepModulePropertyOrder: [] }, /nonempty/],
    [{ bicepResourcePropertyOrder: ["name", "name"] }, /duplicates/],
    [
      { bicepDecoratorOrder: "description,minLength" },
      /bicepDecoratorOrder.*JSON array/,
    ],
    [{ bicepSortDeclarations: "yes" }, /Invalid bicepSortDeclarations/],
  ];
  const responses = await bridge(cases.map(([options]) => request(options)));
  responses.forEach((response, index) => {
    assert.equal(response.code, "BICEP_INVALID_CONFIGURATION", `case ${index}`);
    assert.match(response.error, cases[index][1], `case ${index}`);
  });
});

test("native parser infers bicepparam from filepath when parser is omitted", async () => {
  const source = "using './main.bicep'\nparam name='example'\n";
  const [response] = await bridge([
    request(
      {},
      {
        text: source,
        filepath: resolve("test", "fixtures", "native-coverage.bicepparam"),
      },
    ),
  ]);
  assert.equal(
    response.text,
    "using './main.bicep'\n\nparam name = 'example'\n",
  );
});

test("native resource property defaults place location before dependsOn", async () => {
  const source =
    "resource first 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={name:'first',location:'westeurope'}\n" +
    "resource next 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={dependsOn:[first],location:'westeurope',name:'next'}\n";
  const [response] = await bridge([request({}, { text: source })]);
  assert.match(
    response.text,
    /resource next[^\n]+\{\n  name: 'next'\n  location: 'westeurope'\n  dependsOn:/,
  );
});

test("syntax diagnostics at the start of a file retain their first-line position", async () => {
  await assert.rejects(
    format("= invalid\nparam name string\n", {
      plugins: [plugin],
      parser: "bicep",
    }),
    (error) => {
      assert.ok(error instanceof BicepFormattingError);
      assert.equal(error.code, "BICEP_SYNTAX_ERROR");
      assert.equal(error.loc.start.line, 1);
      assert.ok(error.loc.start.column >= 1);
      return true;
    },
  );
});

test("native layout overrides inherit or replace Prettier indentation and width", async () => {
  const source = "output values object={first:1,second:2}\n";
  assert.match(
    await stable(source, {
      useTabs: true,
      bicepIndentStyle: "spaces",
      bicepTabWidth: 3,
    }),
    /\n {3}first: 1\n {3}second: 2\n/,
  );
  assert.match(
    await stable(source, { bicepIndentStyle: "tabs", bicepPrintWidth: 45 }),
    /\n\tfirst: 1\n\tsecond: 2\n/,
  );
  assert.match(
    await stable(source, { tabWidth: 4, bicepIndentStyle: "inherit" }),
    /\n {4}first: 1\n {4}second: 2\n/,
  );
});

test("nested resource properties remain behind parent properties when sorting is disabled", async () => {
  const source =
    "resource parent 'Microsoft.Storage/storageAccounts@2023-05-01'={\n" +
    "  location:'westeurope'\n" +
    "  name:'parent'\n" +
    "  resource child 'blobServices'={name:'default'}\n" +
    "}\n";
  const output = await stable(source, { bicepSortProperties: false });
  assert.ok(output.indexOf("location:") < output.indexOf("name: 'parent'"));
  assert.ok(
    output.indexOf("name: 'parent'") < output.indexOf("resource child"),
  );
});

test("assertions and test declarations retain dependencies across section ordering", async () => {
  const source =
    "test check './test.bicep'={params:{}}\n" +
    "assert namePresent=length(name)>0\n" +
    "param name string='example'\n";
  const output = await stable(source);
  assert.ok(
    output.indexOf("param name") < output.indexOf("assert namePresent"),
  );
  assert.match(output, /test check '\.\/test\.bicep' = \{\n  params: \{\}\n\}/);
});

test("parameter-file using declaration remains first when assignments are reordered", async () => {
  const source =
    "param region='westeurope'\nusing './main.bicep'\nparam name='example'\n";
  const output = await stable(source, {
    filepath: resolve("test", "fixtures", "native-coverage.bicepparam"),
    parser: "bicepparam",
  });
  assert.ok(output.startsWith("using './main.bicep'\n\n"));
  assert.ok(output.indexOf("param region") < output.indexOf("param name"));
});
