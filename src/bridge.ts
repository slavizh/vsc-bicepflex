import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { ParserOptions } from "prettier";

const bridge = fileURLToPath(
  new URL("./bridge/Bicep.Formatter.dll", import.meta.url),
);
const maxBytes = 32 * 1024 * 1024;
export const bridgeProtocolVersion = 1;

export class BicepFormattingError extends Error {
  readonly code: string;
  readonly loc?: { start: { line: number; column: number } };
  readonly diagnosticCode?: string;

  constructor(
    message: string,
    code: string,
    details?: {
      line?: number;
      column?: number;
      diagnosticCode?: string;
      cause?: unknown;
    },
  ) {
    super(
      message,
      details && "cause" in details ? { cause: details.cause } : undefined,
    );
    this.name = "BicepFormattingError";
    this.code = code;
    if (details?.line !== undefined && details.column !== undefined) {
      this.loc = { start: { line: details.line, column: details.column } };
    }
    if (details?.diagnosticCode !== undefined)
      this.diagnosticCode = details.diagnosticCode;
  }
}

interface BridgeResponse {
  protocolVersion?: number;
  text?: string;
  error?: string;
  code?: string;
  line?: number | null;
  column?: number | null;
  diagnosticCode?: string | null;
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (!("protocolVersion" in value) ||
      Number.isInteger(value.protocolVersion)) &&
    (!("text" in value) || typeof value.text === "string") &&
    (!("error" in value) || typeof value.error === "string") &&
    (!("code" in value) || typeof value.code === "string") &&
    (!("line" in value) ||
      value.line === null ||
      (typeof value.line === "number" &&
        Number.isInteger(value.line) &&
        value.line > 0)) &&
    (!("column" in value) ||
      value.column === null ||
      (typeof value.column === "number" &&
        Number.isInteger(value.column) &&
        value.column > 0)) &&
    (!("diagnosticCode" in value) ||
      value.diagnosticCode === null ||
      typeof value.diagnosticCode === "string") &&
    ("text" in value || "error" in value)
  );
}

export function parseBridgeOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const missingRuntime =
      /You must install or update \.NET|Framework: ['"]Microsoft\.NETCore\.App|No frameworks were found/i.test(
        stderr + stdout,
      );
    throw new BicepFormattingError(
      missingRuntime
        ? "The Bicep formatter requires the .NET 10 runtime for this host architecture. Install it, then restart VS Code."
        : `The Bicep bridge failed (exit ${exitCode ?? "terminated"}) without a valid JSON response. Reinstall the extension or rebuild the source checkout. ${stderr.trim()}`,
      missingRuntime ? "BICEP_RUNTIME_MISSING" : "BICEP_BRIDGE_FAILED",
    );
  }
  if (!isBridgeResponse(parsed)) {
    throw new BicepFormattingError(
      "The Bicep bridge returned an invalid response. Reinstall the extension or rebuild the source checkout.",
      "BICEP_BRIDGE_FAILED",
    );
  }
  if (parsed.protocolVersion !== bridgeProtocolVersion) {
    throw new BicepFormattingError(
      `The Bicep formatter and native bridge use incompatible protocols (formatter: ${bridgeProtocolVersion}, bridge: ${parsed.protocolVersion ?? "legacy"}). Run Developer: Reload Window in VS Code. If it persists, reinstall the extension or run npm run build:extension in a source checkout.`,
      "BICEP_BRIDGE_VERSION_MISMATCH",
    );
  }
  if (exitCode !== 0 || parsed.error || typeof parsed.text !== "string") {
    throw new BicepFormattingError(
      `Bicep formatting refused: ${parsed.error || stderr.trim() || "The bridge exited without a successful formatting result."}`,
      parsed.code ?? "BICEP_BRIDGE_FAILED",
      {
        ...(parsed.line != null ? { line: parsed.line } : {}),
        ...(parsed.column != null ? { column: parsed.column } : {}),
        ...(parsed.diagnosticCode != null
          ? { diagnosticCode: parsed.diagnosticCode }
          : {}),
      },
    );
  }
  return parsed.text;
}

export async function formatNative(
  text: string,
  options: ParserOptions,
): Promise<string> {
  await access(bridge).catch((error: unknown) => {
    throw new BicepFormattingError(
      "The Bicep formatter bridge cannot be accessed. Reinstall the extension, or run npm run build:extension in a source checkout.",
      "BICEP_BRIDGE_MISSING",
      { cause: error },
    );
  });
  const settings = Object.fromEntries(
    Object.entries(options).filter(
      ([key, value]) =>
        (key.startsWith("bicep") ||
          ["printWidth", "tabWidth", "useTabs"].includes(key)) &&
        (["string", "number", "boolean"].includes(typeof value) ||
          Array.isArray(value)),
    ),
  );
  const filepath = resolve(
    options.filepath ??
      (options.parser === "bicepparam" ? "main.bicepparam" : "main.bicep"),
  );
  const request = JSON.stringify({
    protocolVersion: bridgeProtocolVersion,
    text,
    filepath,
    parser: options.parser,
    options: settings,
  });
  if (Buffer.byteLength(request) > maxBytes) {
    throw new BicepFormattingError(
      "Bicep formatting input exceeds the 32 MiB safety limit.",
      "BICEP_INPUT_LIMIT",
    );
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn("dotnet", [bridge], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        DOTNET_NOLOGO: "1",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new BicepFormattingError(
            "Bicep formatting exceeded 60 seconds; no formatted output was returned.",
            "BICEP_TIMEOUT",
          ),
        ),
      60_000,
    );
    child.on("error", (error) =>
      fail(
        new BicepFormattingError(
          `Unable to start the Bicep formatter. Install the .NET 10 runtime and ensure dotnet is on PATH. ${error.message}`,
          "BICEP_RUNTIME_UNAVAILABLE",
        ),
      ),
    );
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") fail(error);
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes)
        fail(
          new BicepFormattingError(
            "Bicep formatter output exceeded the 32 MiB safety limit.",
            "BICEP_OUTPUT_LIMIT",
          ),
        );
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes)
        fail(
          new BicepFormattingError(
            "Bicep formatter diagnostics exceeded the safety limit.",
            "BICEP_OUTPUT_LIMIT",
          ),
        );
      else stderr += chunk;
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolveResult(parseBridgeOutput(stdout, stderr, code));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(request + "\n");
  });
}
