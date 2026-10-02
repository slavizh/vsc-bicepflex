import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { format } from "prettier";
import plugin from "../dist/index.js";

const filepath = resolve("test", "fixtures", "preserve-ordering.bicep");
const resource = (name, body = "") =>
  `resource ${name} 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31'={name:'${name}',location:'westeurope'${body ? `,${body}` : ""}}\n`;
const names = (source) =>
  [...source.matchAll(/^(?:var|resource|module|output|param)\s+(\w+)/gm)].map(
    (match) => match[1],
  );

async function stable(source, settings = {}) {
  const options = { plugins: [plugin], filepath, endOfLine: "lf", ...settings };
  const result = await format(source, options);
  assert.equal(await format(result, options), result);
  return result;
}

test("preserved variables keep their author positions rather than moving to a section or first use", async () => {
  const source =
    resource("first") +
    "var tags={env:'dev'}\n" +
    resource("second", "tags:tags");
  const options = { bicepVariablePlacement: "preserve" };
  const output = await stable(source, options);
  assert.deepEqual(names(output), ["first", "tags", "second"]);
  assert.equal(output, await stable(source, { bicepSortDeclarations: false }));
  assert.deepEqual(names(await stable(source)), ["first", "tags", "second"]);
  assert.deepEqual(
    names(await stable(source, { bicepVariablePlacement: "section" })),
    ["tags", "first", "second"],
  );

  const early =
    "var tags={env:'dev'}\n" +
    resource("first") +
    resource("second", "tags:tags");
  assert.deepEqual(names(await stable(early, options)), [
    "tags",
    "first",
    "second",
  ]);
  assert.deepEqual(names(await stable(early)), ["first", "tags", "second"]);
});

test("preserved variables still follow dependencies that occur later in source", async () => {
  const source =
    "var tags={parent:base.id}\n" +
    resource("unrelated") +
    resource("base") +
    resource("consumer", "tags:tags");
  assert.deepEqual(
    names(await stable(source, { bicepVariablePlacement: "preserve" })),
    ["base", "tags", "unrelated", "consumer"],
  );
});

test("preserved outputs stay at their source positions unless their dependencies must move", async () => {
  const source =
    resource("first") +
    resource("second") +
    "output firstId string=first.id\n" +
    resource("third");
  const output = await stable(source, { bicepOutputPlacement: "preserve" });
  assert.deepEqual(names(output), ["first", "second", "firstId", "third"]);
  assert.equal(output, await stable(source, { bicepSortDeclarations: false }));
  assert.deepEqual(names(await stable(source)), [
    "first",
    "firstId",
    "second",
    "third",
  ]);

  const forward =
    "output firstId string=first.id\n" +
    resource("unrelated") +
    resource("first");
  assert.deepEqual(
    names(await stable(forward, { bicepOutputPlacement: "preserve" })),
    ["first", "firstId", "unrelated"],
  );
});

test("preserved output-only variable chains and outputs stay put, except for required dependencies", async () => {
  const source =
    resource("first") +
    resource("second") +
    "var id=first.id\n" +
    "var label=string(id)\n" +
    "output value string=label\n" +
    resource("third");
  const output = await stable(source, { bicepOutputOnlyVariables: "preserve" });
  assert.deepEqual(names(output), [
    "first",
    "second",
    "id",
    "label",
    "value",
    "third",
  ]);
  assert.equal(output, await stable(source, { bicepSortDeclarations: false }));
  assert.deepEqual(names(await stable(source)), [
    "first",
    "second",
    "third",
    "id",
    "label",
    "value",
  ]);

  const forward =
    "var id=first.id\n" +
    "output value string=id\n" +
    resource("unrelated") +
    resource("first");
  assert.deepEqual(
    names(await stable(forward, { bicepOutputOnlyVariables: "preserve" })),
    ["first", "id", "value", "unrelated"],
  );
});

test("preserved dependency order keeps safe cross-section source order and moves dependencies when necessary", async () => {
  const source =
    resource("first") + "param label string\n" + resource("second");
  const output = await stable(source, { bicepDependencyOrder: "preserve" });
  assert.deepEqual(names(output), ["first", "label", "second"]);
  assert.equal(output, await stable(source, { bicepSortDeclarations: false }));
  assert.deepEqual(names(await stable(source)), ["label", "first", "second"]);

  const forward =
    resource("consumer", "tags:{id:dependency.id}") +
    resource("unrelated") +
    resource("dependency");
  assert.deepEqual(
    names(await stable(forward, { bicepDependencyOrder: "preserve" })),
    ["dependency", "consumer", "unrelated"],
  );
});

test("all preserve choices retain safe source order without bypassing formatting refusals", async () => {
  const settings = {
    bicepVariablePlacement: "preserve",
    bicepOutputPlacement: "preserve",
    bicepOutputOnlyVariables: "preserve",
    bicepDependencyOrder: "preserve",
  };
  const source =
    resource("first") +
    "var id=first.id\n" +
    "output value string=id\n" +
    resource("second");
  assert.equal(
    await stable(source, settings),
    await stable(source, { bicepSortDeclarations: false }),
  );
  await assert.rejects(
    stable("resource broken = {", settings),
    /Bicep formatting refused: BCP/,
  );
});
