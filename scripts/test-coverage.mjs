import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts", "coverage");
mkdirSync(artifacts, { recursive: true });
for (const entry of [
  "engine-raw",
  "engine",
  "host-raw",
  "host",
  "native.xml",
  "summary.json",
])
  rmSync(join(artifacts, entry), { recursive: true, force: true });
const testFiles = readdirSync(resolve(root, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `test/${name}`);
const node = process.execPath;
const dotnet = process.platform === "win32" ? "dotnet.exe" : "dotnet";
const c8 = resolve(root, "node_modules", "c8", "bin", "c8.js");

function run(command, args, environment = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      DOTNET_COVERAGE_TELEMETRY_OPTOUT: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      ...environment,
    },
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 10,
  });
}

function summary(directory, inputs) {
  const report = JSON.parse(
    readFileSync(join(directory, "coverage-summary.json"), "utf8"),
  );
  const totals = {
    lines: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };
  for (const file of inputs) {
    const entry = Object.entries(report).find(([path]) =>
      path.replaceAll("\\", "/").endsWith(`/${file}`),
    )?.[1];
    if (!entry) throw new Error(`Missing source coverage for ${file}`);
    for (const metric of ["lines", "branches"]) {
      totals[metric].covered += entry[metric].covered;
      totals[metric].total += entry[metric].total;
    }
  }
  return totals;
}

function sources(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? sources(path)
        : path.endsWith(".ts")
          ? [path]
          : [];
    },
  );
}

function report(name, totals) {
  const metrics = ["lines", "branches"].map((metric) => {
    const { covered, total } = totals[metric];
    if (!total && metric === "lines")
      throw new Error(`${name} has no measured source lines`);
    return `${metric}: ${covered}/${total} (${total ? ((covered / total) * 100).toFixed(2) : "n/a"}%)`;
  });
  console.log(`${name}: ${metrics.join("; ")}`);
  return ["lines", "branches"].every(
    (metric) => totals[metric].covered === totals[metric].total,
  );
}

run(dotnet, ["tool", "restore"]);
run(
  dotnet,
  [
    "dotnet-coverage",
    "collect",
    node,
    "--test",
    "--test-concurrency=1",
    ...testFiles,
    "--output-format",
    "cobertura",
    "--output",
    join(artifacts, "native.xml"),
    "--nologo",
  ],
  { NODE_V8_COVERAGE: join(artifacts, "engine-raw") },
);

run(node, [
  c8,
  "report",
  "--reporter=json-summary",
  `--temp-directory=${join(artifacts, "engine-raw")}`,
  `--reports-dir=${join(artifacts, "engine")}`,
  "--include=dist/**/*.js",
  "--include=src/**/*.ts",
]);
const engine = summary(join(artifacts, "engine"), sources("src"));
const xml = readFileSync(join(artifacts, "native.xml"), "utf8");
if (!/<package\b[^>]*\bname="Bicep\.Formatter"[^>]*>/.test(xml))
  throw new Error("Missing Bicep.Formatter native coverage");
const nativePackage = xml.match(/<coverage\b[^>]*>/)?.[0];
const native = {};
for (const [metric, attribute] of [
  ["lines", "lines"],
  ["branches", "branches"],
]) {
  const covered = Number(
    nativePackage.match(new RegExp(`\\b${attribute}-covered="(\\d+)"`))?.[1],
  );
  const total = Number(
    nativePackage.match(new RegExp(`\\b${attribute}-valid="(\\d+)"`))?.[1],
  );
  if (!Number.isInteger(covered) || !Number.isInteger(total) || !total)
    throw new Error(`Missing ${metric} counts in native coverage`);
  native[metric] = { covered, total };
}

run(node, [resolve(root, "packages", "vscode", "test-host", "run.cjs")], {
  NODE_V8_COVERAGE: join(artifacts, "host-raw"),
});
run(node, [
  c8,
  "report",
  "--reporter=json-summary",
  `--temp-directory=${join(artifacts, "host-raw")}`,
  `--reports-dir=${join(artifacts, "host")}`,
  "--include=packages/vscode/dist/extension.mjs",
  "--include=packages/vscode/src/**/*.ts",
]);
const host = summary(join(artifacts, "host"), sources("packages/vscode/src"));

writeFileSync(
  join(artifacts, "summary.json"),
  JSON.stringify({ engine, host, native }, null, 2) + "\n",
);
const complete = [
  report("Formatter TypeScript", engine),
  report("VS Code extension", host),
  report("Native bridge", native),
].every(Boolean);
if (process.argv.includes("--enforce") && !complete)
  throw new Error("Production coverage is below 100% lines and branches.");
