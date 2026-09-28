const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const extension = path.resolve(__dirname, "..");

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "bicepflex-host-"));
  const workspace = path.join(temp, "workspace");
  const profile = path.join(temp, "profile");
  const extensions = path.join(temp, "extensions");
  const evidence = path.join(temp, "host-evidence.json");
  try {
    await fs.mkdir(path.join(extension, "artifacts"), { recursive: true });
    const installed = path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Microsoft VS Code",
      "Code.exe",
    );
    const executable =
      process.env.VSCODE_EXECUTABLE ??
      (existsSync(installed)
        ? installed
        : await require("@vscode/test-electron").downloadAndUnzipVSCode({
            version: "1.125.0",
            cachePath: path.join(extension, "artifacts", "vscode"),
          }));
    assert.ok(
      existsSync(executable),
      `Set VSCODE_EXECUTABLE to an installed VS Code executable: ${executable}`,
    );
    assert.ok(
      existsSync(path.join(extension, "dist", "bridge", "Bicep.Formatter.dll")),
    );
    await fs.mkdir(path.join(workspace, ".vscode"), { recursive: true });
    await fs.mkdir(path.join(profile, "User"), { recursive: true });
    await fs.mkdir(extensions, { recursive: true });
    await fs.writeFile(
      path.join(workspace, "sample.bicep"),
      "output greeting string='hello'\n",
    );
    await fs.writeFile(
      path.join(workspace, "sample.bicepparam"),
      "using none\r\nparam greeting='hello'\r\n",
    );
    await fs.mkdir(path.join(workspace, "config-case"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, "config-case", ".prettierrc.json"),
      JSON.stringify({
        plugins: ["@slavizh/prettier-plugin-bicep", "not-installed-plugin"],
        bicepTabWidth: 3,
        bicepIndentStyle: "spaces",
        bicepSortDeclarations: true,
      }),
    );
    await fs.writeFile(
      path.join(workspace, "config-case", "configured.bicep"),
      "output value object={enabled:true}\n",
    );
    await fs.writeFile(
      path.join(workspace, ".vscode", "settings.json"),
      JSON.stringify({
        "[bicep]": {
          "editor.defaultFormatter": "slavizh.bicepflex",
        },
        "[bicep-params]": {
          "editor.defaultFormatter": "slavizh.bicepflex",
        },
      }),
    );
    await fs.writeFile(
      path.join(profile, "User", "settings.json"),
      JSON.stringify({
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "json.schemaDownload.enable": false,
        "bicep.enableSurveys": false,
        ...(process.env.BICEPFLEX_BICEP_VSIX
          ? {
              "dotnetAcquisitionExtension.existingDotnetPath": [
                {
                  extensionId: "ms-azuretools.vscode-bicep",
                  path: execFileSync(
                    process.platform === "win32" ? "where.exe" : "which",
                    ["dotnet"],
                    { encoding: "utf8" },
                  )
                    .trim()
                    .split(/\r?\n/)[0],
                },
              ],
            }
          : {}),
      }),
    );
    const { name, version } = JSON.parse(
      await fs.readFile(path.join(extension, "package.json"), "utf8"),
    );
    const vsix =
      process.env.BICEPFLEX_TEST_PACKAGED === "1"
        ? path.join(extension, `${name}-${version}.vsix`)
        : undefined;
    if (vsix || process.env.BICEPFLEX_BICEP_VSIX) {
      let cli = path.join(
        path.dirname(executable),
        "resources",
        "app",
        "out",
        "cli.js",
      );
      if (!existsSync(cli) && process.platform === "win32") {
        const launcher = await fs.readFile(
          path.join(path.dirname(executable), "bin", "code.cmd"),
          "utf8",
        );
        const relative = launcher.match(
          /"%~dp0([^"]+\\resources\\app\\out\\cli\.js)"/i,
        )?.[1];
        if (relative)
          cli = path.resolve(path.dirname(executable), "bin", relative);
      }
      assert.ok(existsSync(cli), `VS Code CLI unavailable: ${cli}`);
      const cliEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
      delete cliEnv.VSCODE_IPC_HOOK_CLI;
      delete cliEnv.VSCODE_PORTABLE;
      for (const packagePath of [vsix, process.env.BICEPFLEX_BICEP_VSIX]) {
        if (!packagePath) continue;
        execFileSync(
          executable,
          [
            cli,
            `--user-data-dir=${profile}`,
            `--extensions-dir=${extensions}`,
            "--install-extension",
            packagePath,
            "--force",
          ],
          {
            env: cliEnv,
            timeout: 120_000,
          },
        );
      }
    }
    const args = [
      workspace,
      `--user-data-dir=${profile}`,
      `--extensions-dir=${extensions}`,
      `--extensionDevelopmentPath=${vsix ? path.join(__dirname, "harness") : extension}`,
      `--extensionTestsPath=${path.join(__dirname, "suite.cjs")}`,
      "--new-window",
      "--disable-workspace-trust",
      "--disable-telemetry",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
    ];
    const env = { ...process.env, BICEPFLEX_HOST_EVIDENCE: evidence };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VSCODE_IPC_HOOK_CLI;
    await fs.rm(evidence, { force: true });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const output = [];
      child.stdout.on("data", (chunk) => output.push(chunk));
      child.stderr.on("data", (chunk) => output.push(chunk));
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } else child.kill("SIGKILL");
      }, 120_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const log = Buffer.concat(output).toString();
        if (code === 0) resolve(log);
        else
          reject(
            new Error(`VS Code host exited ${code}:\n${log.slice(-5000)}`),
          );
      });
    });
    assert.ok(
      existsSync(evidence),
      `Host produced no evidence:\n${result.slice(-5000)}`,
    );
    const report = JSON.parse(await fs.readFile(evidence, "utf8"));
    assert.equal(report.success, true);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
