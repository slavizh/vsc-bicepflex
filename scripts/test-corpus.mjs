import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { bridgeProtocolVersion } from "../dist/bridge.js";

const root = resolve(
  process.env.BICEP_CORPUS ??
    join(
      "artifacts",
      "upstream",
      "bicep-0.47.16",
      "src",
      "Bicep.Core.Samples",
      "Files",
    ),
);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      files.push(...(await walk(join(directory, entry.name))));
    else if (/\.(bicep|bicepparam)$/.test(entry.name))
      files.push(join(directory, entry.name));
  }
  return files;
}
const filter = process.env.BICEP_CORPUS_FILTER;
const files = (await walk(root))
  .filter((file) => !filter || file.includes(filter))
  .sort();
if (files.length === 0)
  throw new Error("No upstream Bicep corpus files were found.");
const child = spawn(
  "dotnet",
  [resolve("dist", "bridge", "Bicep.Formatter.dll")],
  {
    stdio: ["pipe", "pipe", "inherit"],
  },
);
const lines = createInterface({ input: child.stdout });
const responses = [];
let waiter;
lines.on("line", (line) => {
  const result = JSON.parse(line);
  if (waiter) {
    const next = waiter;
    waiter = undefined;
    next(result);
  } else responses.push(result);
});
child.on("error", (error) => {
  throw error;
});
child.on("exit", () => {
  if (waiter) {
    const next = waiter;
    waiter = undefined;
    next({ error: "Bridge exited unexpectedly." });
  }
});
async function request(text, filepath) {
  child.stdin.write(
    JSON.stringify({
      protocolVersion: bridgeProtocolVersion,
      text,
      filepath,
      options: {},
    }) + "\n",
  );
  return (
    responses.shift() ??
    (await new Promise((resolve) => {
      waiter = resolve;
    }))
  );
}
const failures = [];
const knownSafetyRefusals = [];
// This annotated fixture contains Unicode line separators inside comments.
// The pinned native printer changes them; it was previously miscounted as invalid input.
const knownUnicodeCommentFixture = join(
  "baselines",
  "InvalidLoadFunctions_CRLF",
  "main.symbols.bicep",
);
let formatted = 0;
let syntaxErrors = 0;
for (const file of files) {
  const input = await readFile(file, "utf8");
  const result = await request(
    input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
    file,
  );
  if (result.error) {
    if (result.code === "BICEP_SYNTAX_ERROR") syntaxErrors++;
    else if (
      relative(root, file) === knownUnicodeCommentFixture &&
      result.code === "BICEP_SAFETY_CHECK_FAILED" &&
      result.error.startsWith("Formatting produced invalid Bicep syntax")
    ) {
      knownSafetyRefusals.push({
        file: relative(root, file),
        error: result.error,
      });
    } else failures.push({ file: relative(root, file), error: result.error });
  } else {
    const second = await request(result.text, file);
    if (second.error)
      failures.push({
        file: relative(root, file),
        error: `Second pass: ${second.error}`,
      });
    else if (result.text !== second.text)
      failures.push({ file: relative(root, file), error: "Not idempotent" });
    else formatted++;
  }
  if (
    (formatted + syntaxErrors + knownSafetyRefusals.length + failures.length) %
      100 ===
    0
  ) {
    console.log(
      `${formatted} formatted; ${syntaxErrors} syntax-error fixtures correctly refused; ${knownSafetyRefusals.length} known safety refusals; ${failures.length} failures`,
    );
  }
}
child.stdin.end();
await mkdir("artifacts", { recursive: true });
const report = {
  version: "0.47.16",
  total: files.length,
  formatted,
  syntaxErrors,
  knownSafetyRefusals,
  failures,
};
await writeFile(
  join("artifacts", "corpus-results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({ ...report, failures: failures.slice(0, 20) }, null, 2),
);
if (failures.length) process.exitCode = 1;
