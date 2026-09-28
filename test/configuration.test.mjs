import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { format, getSupportInfo } from "prettier";
import plugin from "../dist/index.js";

test("schema, default example and reference document every public Bicep option", async () => {
  const [schemaText, exampleText, documentation] = await Promise.all(
    [
      "configuration.schema.json",
      "configuration.example.json",
      "CONFIGURATION.md",
    ].map((name) => readFile(new URL(`../${name}`, import.meta.url), "utf8")),
  );
  const schema = JSON.parse(schemaText);
  const example = JSON.parse(exampleText);
  const configuration = schema.$defs.configuration;
  const info = await getSupportInfo({ plugins: [plugin] });
  const options = info.options.filter((option) =>
    option.name.startsWith("bicep"),
  );
  assert.deepEqual(
    Object.keys(configuration.properties)
      .filter((name) => name.startsWith("bicep"))
      .sort(),
    options.map((option) => option.name).sort(),
  );
  assert.deepEqual(
    configuration.propertyNames.anyOf[1].enum.sort(),
    options.map((option) => option.name).sort(),
  );
  assert.equal(
    configuration.properties.overrides.items.properties.options.$ref,
    schema.$ref,
  );
  assert.equal(configuration.additionalProperties, true);
  for (const option of options) {
    const property = configuration.properties[option.name];
    assert.deepEqual(property.default, option.default, option.name);
    assert.deepEqual(example[option.name], option.default, option.name);
    assert.ok(
      documentation.includes(`\`${option.name}\``),
      `Missing documentation: ${option.name}`,
    );
    if (option.choices)
      assert.deepEqual(
        property.enum,
        option.choices.map((choice) => choice.value),
      );
    if (option.array) {
      assert.equal(property.type, "array");
      assert.equal(property.uniqueItems, true);
      assert.equal(property.minItems, 1);
    }
  }
  const source =
    "param location string='westeurope'\nresource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={location:location,name:'identity'}\noutput id string=identity.id\n";
  assert.equal(
    await format(source, { ...example, plugins: [plugin], parser: "bicep" }),
    await format(source, { plugins: [plugin], parser: "bicep" }),
  );
});

test("documented nondefault formatting examples match their settings", async () => {
  const documentation = await readFile(
    new URL("../CONFIGURATION.md", import.meta.url),
    "utf8",
  );
  for (const [option, value] of [
    ["bicepUnionLayout", "multiline"],
    ["bicepConditionalHeader", "next-line"],
  ]) {
    const start = documentation.indexOf(`With \`"${option}": "${value}"\`:`);
    assert.ok(start >= 0);
    const example = documentation
      .slice(start)
      .match(/```bicep\r?\n([\s\S]*?)```/)[1]
      .replace(/\r\n/g, "\n");
    assert.equal(
      await format(example, {
        plugins: [plugin],
        parser: "bicep",
        endOfLine: "lf",
        [option]: value,
      }),
      example,
    );
  }
});

test("VS Code settings and offline schema cover the same Bicep options", async () => {
  const [schema, editorSchema, manifest] = await Promise.all(
    [
      "configuration.schema.json",
      "packages/vscode/schemas/prettier.schema.json",
      "packages/vscode/package.json",
    ].map(async (path) =>
      JSON.parse(
        await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
      ),
    ),
  );
  assert.deepEqual(editorSchema, schema);
  const contributed = manifest.contributes.configuration.properties;
  assert.deepEqual(
    Object.keys(contributed).sort(),
    [
      "bicepFlex.preset",
      ...Object.keys(schema.$defs.configuration.properties)
        .filter((name) => name !== "overrides")
        .map((name) => `bicepFlex.${name}`),
    ].sort(),
  );
  assert.match(
    contributed["bicepFlex.preset"].description,
    /Default: "opinionated"/,
  );
  const orders = Object.values(contributed).map((setting) => setting.order);
  assert.deepEqual(
    orders.slice().sort((a, b) => a - b),
    orders,
  );
  assert.deepEqual(
    orders,
    Array.from({ length: orders.length }, (_, i) => i + 1),
  );
  assert.equal(contributed["bicepFlex.preset"].order, 1);
  assert.equal(contributed["bicepFlex.bicepObjectLayout"].order, 2);
  assert.equal(contributed["bicepFlex.bicepArrayLayout"].order, 3);
  assert.deepEqual(contributed["bicepFlex.preset"].enumDescriptions.length, 2);
  for (const [name, property] of Object.entries(
    schema.$defs.configuration.properties,
  )) {
    if (name === "overrides") continue;
    const flat = contributed[`bicepFlex.${name}`];
    assert.equal(flat.type, property.type);
    assert.deepEqual(flat.enum, property.enum);
    assert.deepEqual(flat.enumDescriptions, property.enumDescriptions);
    if (flat.enum) {
      assert.equal(flat.enumDescriptions.length, flat.enum.length);
      for (const value of flat.enum) {
        assert.ok(flat.description.includes(`"${value}" —`), name);
      }
    }
    assert.equal(flat.description, property.description);
    assert.equal(
      schema.$defs.configuration.properties[name].description,
      property.description,
    );
    assert.match(property.description, /Default: /);
    assert.deepEqual(
      flat.default,
      name === "bicepPrintWidth"
        ? 180
        : name === "bicepTabWidth"
          ? 2
          : property.default,
    );
    assert.match(flat.description, /Default: /);
    assert.doesNotMatch(flat.description, /Prettier/i);
  }
  assert.match(
    contributed["bicepFlex.bicepPrintWidth"].description,
    /Default: 180 in the Settings UI; when unset, inherits printWidth/,
  );
  assert.match(
    contributed["bicepFlex.bicepTabWidth"].description,
    /Default: 2 in the Settings UI; when unset, inherits tabWidth/,
  );
  assert.ok(
    contributed["bicepFlex.bicepPrintWidth"].default >=
      contributed["bicepFlex.bicepPrintWidth"].minimum,
  );
  assert.match(
    contributed["bicepFlex.bicepConditionalHeader"].description,
    /Default: "inline"/,
  );
  assert.deepEqual(
    Object.keys(contributed)
      .map((name) => name.replace(/^bicepFlex\./, ""))
      .filter((name) => name.startsWith("bicep"))
      .sort(),
    Object.keys(schema.$defs.configuration.properties)
      .filter((name) => name.startsWith("bicep"))
      .sort(),
  );
  assert.deepEqual(
    manifest.contributes.languages.map(({ id }) => id),
    ["bicep", "bicep-params"],
  );
  assert.equal(manifest.extensionDependencies, undefined);
});

test("published guides describe the initial 0.2.0 settings", async () => {
  for (const path of [
    "README.md",
    "CONFIGURATION.md",
    "RELEASING.md",
    "packages/vscode/README.md",
  ]) {
    const guide = await readFile(
      new URL(`../${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      guide,
      /bicepFlex\.options|@slavizh\/prettier-plugin-bicep|slavizh\/Prettier-Plugin-Bicep|0\.1\.\d+/i,
      path,
    );
  }
  const changelog = await readFile(
    new URL("../CHANGELOG.md", import.meta.url),
    "utf8",
  );
  assert.match(changelog, /^## 0\.2\.0 \(first release\)$/m);
});
