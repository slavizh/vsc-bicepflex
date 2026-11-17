import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const reachable of [true, false]) {
  test(`manual Marketplace recovery ${reachable ? "accepts" : "rejects"} an older tag ${reachable ? "on" : "outside"} main`, async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    const script = workflow
      .match(
        /- name: Verify and download the published VSIX[\s\S]*?        run: \|\r?\n([\s\S]*?)(?=      - name:)/,
      )[1]
      .replace(/^          /gm, "");
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "bicepflex-marketplace-")),
    );
    try {
      await mkdir(join(directory, "packages", "vscode"), { recursive: true });
      await writeFile(
        join(directory, "packages", "vscode", "package.json"),
        JSON.stringify({ version: "0.5.0" }),
      );
      await writeFile(
        join(directory, "fixture.vsix"),
        "original release asset",
      );
      const harness = join(directory, "verify.ps1");
      await writeFile(
        harness,
        `
$ErrorActionPreference = 'Stop'
function git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)
  $global:LASTEXITCODE = 0
  switch ($Arguments[0]) {
    'show' {
      if ($Arguments[1] -cne "$($env:RELEASE_TAG):packages/vscode/package.json") {
        throw 'Read the requested tag manifest, not the current main manifest.'
      }
      '{"version":"0.4.0"}'
    }
    'fetch' {}
    'merge-base' {
      if ($Arguments[1] -cne '--is-ancestor' -or
          $Arguments[2] -cne $env:RELEASE_TAG -or $Arguments[3] -cne 'origin/main') {
        throw 'Verify the requested tag is on main, not the tooling checkout.'
      }
      if ($env:FIXTURE_TAG_ON_MAIN -cne 'true') { $global:LASTEXITCODE = 1 }
    }
    default { throw "Unexpected git command: $Arguments" }
  }
}
function gh {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)
  $global:LASTEXITCODE = 0
  if ($Arguments[0] -cne 'release' -or $Arguments[2] -cne $env:RELEASE_TAG) {
    throw "Unexpected gh command: $Arguments"
  }
  switch ($Arguments[1]) {
    'view' {
      $digest = 'sha256:' + (Get-FileHash fixture.vsix -Algorithm SHA256).Hash.ToLowerInvariant()
      @{ tagName = $env:RELEASE_TAG; isDraft = $false; assets = @(
        @{ name = 'bicepflex-0.4.0.vsix'; digest = $digest }
      ) } | ConvertTo-Json -Depth 4
    }
    'download' {
      Copy-Item fixture.vsix artifacts/marketplace/bicepflex-0.4.0.vsix
    }
    default { throw "Unexpected gh release command: $Arguments" }
  }
}
${script}
`,
      );
      const output = join(directory, "output.txt");
      const result = spawnSync(
        "pwsh",
        ["-NoLogo", "-NoProfile", "-File", harness],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            RELEASE_TAG: "v0.4.0",
            FIXTURE_TAG_ON_MAIN: String(reachable),
            GITHUB_OUTPUT: output,
          },
          timeout: 30_000,
        },
      );
      assert.ifError(result.error);
      if (reachable) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          (await readFile(output, "utf8")).trim(),
          `path=${join(directory, "artifacts", "marketplace", "bicepflex-0.4.0.vsix")}`,
        );
        assert.equal(
          await readFile(
            join(directory, "artifacts", "marketplace", "bicepflex-0.4.0.vsix"),
            "utf8",
          ),
          "original release asset",
        );
      } else {
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          /Release tag must point to a commit on main/,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
