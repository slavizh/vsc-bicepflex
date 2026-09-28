import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { format } from "prettier";
import plugin, { BicepFormattingError } from "../dist/index.js";
import {
  bridgeProtocolVersion,
  formatNative,
  parseBridgeOutput,
} from "../dist/bridge.js";

test("bridge response validation refuses stale, malformed and unsuccessful responses", () => {
  for (const response of [
    { text: "must not return this" },
    {
      protocolVersion: bridgeProtocolVersion + 1,
      text: "must not return this",
    },
  ]) {
    assert.throws(
      () => parseBridgeOutput(JSON.stringify(response), "", 0),
      (error) =>
        error instanceof BicepFormattingError &&
        error.code === "BICEP_BRIDGE_VERSION_MISMATCH" &&
        error.message.includes("Developer: Reload Window"),
    );
  }
  assert.throws(
    () => parseBridgeOutput("not JSON", "", 1),
    (error) =>
      error.code === "BICEP_BRIDGE_FAILED" &&
      !error.message.includes("Install the .NET"),
  );
  assert.throws(
    () =>
      parseBridgeOutput(
        JSON.stringify({ protocolVersion: bridgeProtocolVersion, text: 42 }),
        "",
        0,
      ),
    { code: "BICEP_BRIDGE_FAILED" },
  );
  assert.throws(
    () =>
      parseBridgeOutput(
        JSON.stringify({
          protocolVersion: bridgeProtocolVersion,
          text: "invalid success",
        }),
        "",
        1,
      ),
    { code: "BICEP_BRIDGE_FAILED" },
  );
  assert.throws(
    () =>
      parseBridgeOutput(
        "",
        "You must install or update .NET to run this application.",
        150,
      ),
    { code: "BICEP_RUNTIME_MISSING" },
  );
  assert.equal(
    parseBridgeOutput(
      JSON.stringify({ protocolVersion: bridgeProtocolVersion, text: "valid" }),
      "",
      0,
    ),
    "valid",
  );
});

test("bridge validates error metadata, exit failures, and missing runtimes", () => {
  const response = {
    protocolVersion: bridgeProtocolVersion,
    error: "Cannot format this input",
    code: "BICEP_SYNTAX_ERROR",
    line: 3,
    column: 5,
    diagnosticCode: "BCP001",
  };
  assert.throws(
    () => parseBridgeOutput(JSON.stringify(response), "", 1),
    (error) => {
      assert.equal(error.code, "BICEP_SYNTAX_ERROR");
      assert.deepEqual(error.loc, { start: { line: 3, column: 5 } });
      assert.equal(error.diagnosticCode, "BCP001");
      return true;
    },
  );
  for (const invalid of [
    { ...response, line: 0 },
    { ...response, column: -1 },
    { ...response, code: 42 },
    { ...response, diagnosticCode: 123 },
    { protocolVersion: bridgeProtocolVersion },
  ]) {
    assert.throws(() => parseBridgeOutput(JSON.stringify(invalid), "", 1), {
      code: "BICEP_BRIDGE_FAILED",
    });
  }
  assert.throws(
    () => parseBridgeOutput("invalid", "No frameworks were found.", null),
    { code: "BICEP_RUNTIME_MISSING" },
  );
  assert.throws(
    () =>
      parseBridgeOutput(
        JSON.stringify({ protocolVersion: bridgeProtocolVersion, error: "" }),
        "bridge stderr",
        1,
      ),
    /bridge stderr/,
  );
});

test("bridge refuses oversized requests before starting the managed process", async () => {
  await assert.rejects(
    formatNative("x".repeat(32 * 1024 * 1024), { parser: "bicep" }),
    { code: "BICEP_INPUT_LIMIT" },
  );
});

test("native bridge identifies old clients before deserializing legacy ordering settings", async () => {
  const requests = [
    {
      text: "param name string\n",
      options: { bicepDeclarationOrder: "param,var" },
    },
    {
      protocolVersion: bridgeProtocolVersion + 1,
      text: "param name string\n",
      options: {},
    },
    {
      protocolVersion: bridgeProtocolVersion,
      text: "param name string\n",
      options: { bicepDeclarationOrder: "param,var" },
    },
    {
      protocolVersion: bridgeProtocolVersion,
      text: "param name string\n",
      options: { bicepPrintWidth: 0 },
    },
    {
      protocolVersion: bridgeProtocolVersion,
      text: "param name string\n",
      options: [],
    },
    {
      protocolVersion: bridgeProtocolVersion,
      text: "param name string\n",
      options: {},
    },
  ];
  const responses = await new Promise((resolveResult, reject) => {
    const child = spawn(
      "dotnet",
      [resolve("dist", "bridge", "Bicep.Formatter.dll")],
      {
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Bridge test timed out."));
    }, 30_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        assert.equal(stderr, "");
        resolveResult(
          stdout
            .trim()
            .split(/\r?\n/)
            .map((line) => JSON.parse(line)),
        );
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
    );
  });
  assert.equal(responses.length, requests.length);
  for (const response of responses.slice(0, 2)) {
    assert.equal(response.code, "BICEP_BRIDGE_VERSION_MISMATCH");
    assert.match(response.error, /Developer: Reload Window/);
    assert.ok(!response.error.includes("System.String[]"));
  }
  assert.equal(responses[2].code, "BICEP_INVALID_CONFIGURATION");
  assert.match(responses[2].error, /bicepDeclarationOrder.*JSON array/);
  assert.equal(responses[3].code, "BICEP_INVALID_CONFIGURATION");
  assert.match(responses[3].error, /bicepPrintWidth/);
  assert.equal(responses[4].code, "BICEP_INVALID_CONFIGURATION");
  assert.equal(responses[5].text, "param name string\n");
});

test("syntax errors expose compiler codes and source locations without applying output", async () => {
  await assert.rejects(
    format("param valid string\nparam broken =\n", {
      plugins: [plugin],
      parser: "bicep",
    }),
    (error) => {
      assert.ok(error instanceof BicepFormattingError);
      assert.equal(error.code, "BICEP_SYNTAX_ERROR");
      assert.match(error.diagnosticCode, /^BCP\d+$/);
      assert.equal(error.loc.start.line, 2);
      assert.ok(error.loc.start.column > 0);
      assert.match(error.message, /at line 2, column/);
      return true;
    },
  );
});

test("printer failures on Unicode comment separators are not blamed on input syntax", async () => {
  await assert.rejects(
    format("// before\u2028after\nparam name string\n", {
      plugins: [plugin],
      parser: "bicep",
    }),
    (error) => {
      assert.equal(error.code, "BICEP_SAFETY_CHECK_FAILED");
      assert.equal(error.loc, undefined);
      return true;
    },
  );
});
