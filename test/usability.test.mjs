import assert from "node:assert/strict";
import test from "node:test";
import { format } from "prettier";
import plugin, { presets } from "../dist/index.js";

async function stable(source, settings = {}) {
  const options = {
    plugins: [plugin],
    parser: "bicep",
    endOfLine: "lf",
    ...settings,
  };
  const output = await format(source, options);
  assert.equal(await format(output, options), output);
  return output;
}

test("Bicep layout overrides inherit when absent and override standard layout when present", async () => {
  const source =
    "type Choice='development'|'production'|'staging'\nparam value Choice\n";
  const wide = await stable(source, { printWidth: 180 });
  const narrow = await stable(source, { printWidth: 30 });
  assert.notEqual(wide, narrow);
  assert.equal(
    await stable(source, { printWidth: 30, bicepPrintWidth: 180 }),
    wide,
  );
  assert.equal(
    await stable(source, { printWidth: 180, bicepPrintWidth: 30 }),
    narrow,
  );
  const object = "output value object={enabled:true}\n";
  assert.equal(
    await stable(object, { tabWidth: 4, bicepTabWidth: 2 }),
    await stable(object, { tabWidth: 2 }),
  );
  assert.ok(
    (
      await stable(object, { useTabs: false, bicepIndentStyle: "tabs" })
    ).includes("\n\tenabled:"),
  );
  assert.ok(
    (
      await stable(object, {
        useTabs: true,
        bicepIndentStyle: "spaces",
        bicepTabWidth: 3,
      })
    ).includes("\n   enabled:"),
  );
  assert.ok(
    (await stable(object, { bicepTabWidth: 0 })).includes("\nenabled:"),
  );
});

test("Bicep-only layout options do not change JavaScript formatting", async () => {
  const source =
    "const value={first:'something',second:'something else',third:'another value'};";
  const options = {
    plugins: [plugin],
    parser: "babel",
    printWidth: 40,
    tabWidth: 4,
    useTabs: false,
  };
  assert.equal(
    await format(source, {
      ...options,
      bicepPrintWidth: 180,
      bicepTabWidth: 2,
      bicepIndentStyle: "tabs",
    }),
    await format(source, options),
  );
});

test("Bicep layout overrides also apply to parameter files", async () => {
  const source = "using none\nparam config={enabled:true}\n";
  const result = await stable(source, {
    parser: "bicepparam",
    tabWidth: 4,
    bicepTabWidth: 3,
  });
  assert.ok(result.includes("\n   enabled: true"));
});

test("Bicep width override controls the exact object-loop header threshold", async () => {
  const header = "var items = [for name in ['one', 'two']: {";
  const source =
    "var items=[for name in ['one','two']:{name:name}]\noutput result array=items\n";
  assert.ok(
    (
      await stable(source, { printWidth: 20, bicepPrintWidth: header.length })
    ).startsWith(header),
  );
  assert.ok(
    !(
      await stable(source, {
        printWidth: 180,
        bicepPrintWidth: header.length - 1,
      })
    ).startsWith(header),
  );
});

test("invalid Bicep-specific layout values fail explicitly", async () => {
  for (const settings of [
    { bicepPrintWidth: 0 },
    { bicepPrintWidth: 1.5 },
    { bicepTabWidth: -1 },
    { bicepTabWidth: 1001 },
    { bicepIndentStyle: "automatic" },
  ]) {
    await assert.rejects(
      stable("param name string\n", settings),
      /bicep|Invalid/i,
    );
  }
});

test("presets preserve default behavior and allow explicit overrides, including default-valued ones", async () => {
  const source =
    "resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={location:'westeurope',name:'identity'}\nparam name string\n";
  assert.equal(
    await stable(source, { ...presets.opinionated, plugins: [plugin] }),
    await stable(source),
  );
  const minimal = await stable(source, {
    ...presets.minimal,
    plugins: [plugin],
  });
  assert.ok(minimal.startsWith("resource identity"));
  assert.match(minimal, /\{\n  location:.*\n  name:/);
  const explicit = await stable(source, {
    ...presets.minimal,
    plugins: [plugin],
    bicepSortDeclarations: true,
    bicepSortProperties: true,
  });
  assert.ok(explicit.startsWith("param name"));
  assert.match(explicit, /\{\n  name:.*\n  location:/);
});
