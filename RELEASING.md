# Release checklist

1. Verify ownership of the `slavizh` Visual Studio Marketplace publisher. Review
   the VSIX manifest, Bicep version, formatting rules, and all redistributed
   dependency licenses. Do not imply Microsoft or Prettier endorsement.
2. Update the version only in `packages/vscode/package.json` (for example,
   `npm version 0.2.0 --workspace=bicepflex --no-git-tag-version`), and commit
   the generated `package-lock.json` change. Update the changelog. Keep
   `dist/extension.mjs` and
   `dist/bridge` from the same build. If the bridge contract changes, increment
   the protocol version in `src/bridge.ts` and `native/Bicep.Formatter/Program.cs`
   together. Updates to Azure.Bicep.Core require compiler-equivalence, corpus,
   and VS Code host verification; the language server cannot substitute for
   the compiler-backed ordering and safety checks.
3. Work on a branch and open a pull request into `main`. Require passing
   Linux, Windows, and macOS CI before merging. Linux CI additionally runs
   coverage measurement, the official corpus, and a real VS Code host test
   against the packaged VSIX.
4. Configure a protected GitHub `release` environment with reviewers.
   Store `VSCE_PAT` as a secret only if publishing to the Marketplace.

## Build and test

```console
npm ci
npm run check
npm run test:corpus
npm run package --workspace=bicepflex
npm run test:host --workspace=bicepflex
npm run test:coverage
```

`npm run test:coverage` restores the pinned .NET coverage tool and measures
line and branch coverage for the TypeScript engine, the VS Code extension in
an isolated host, and the managed bridge. Reports are written under
`artifacts/coverage`, with component totals in `summary.json`, and uploaded
by CI. Run `npm run test:coverage:enforce`
to require 100% line and branch coverage in each production component. Coverage
is not yet at that threshold, so this strict command currently fails; CI
reports the actual results rather than misrepresenting them as complete.

For the installed-VSIX host test, set `BICEPFLEX_TEST_PACKAGED=1` before
the last command. Without it, the test loads the development extension.
The runner uses an installed VS Code on Windows or downloads a pinned test host.
The fixture workspace has no npm dependencies and uses a fresh disposable
profile for every run. The installed-VSIX suite checks both Bicep file types,
format-on-save, settings metadata and precedence, project configuration
without installed plugins, invalid-input refusals, and offline JSON completion.
Linux hosted CI sets `BICEPFLEX_TEST_NO_SANDBOX=1` for the downloaded VS Code
test host because the runner cannot install its SUID sandbox helper; ordinary
local extension runs are not affected.
For an additional coexistence check, set `BICEPFLEX_BICEP_VSIX` to the
official `vscode-bicep.vsix` for Bicep 0.47.16 before running the host test.
It then also checks that the language server diagnoses invalid Bicep while
formatted valid Bicep and Bicep parameters files have no errors.

Inspect `npm run package:list --workspace=bicepflex`. The VSIX
must contain the Prettier bundle, managed bridge, configuration schema, notices
and license texts. It must not contain source checkout files, test workspaces,
credentials, host logs or downloaded corpora. The .NET 10 runtime is not included.

Install the VSIX in a clean profile and check both Bicep file types, the default
formatter, optional project overrides, format-on-save, and missing .NET diagnostics.
Test with Microsoft's Bicep extension installed as well as without it.
For WSL/SSH/containers, the runtime is required on the remote extension host.

## Publish

After the pull request merges and CI on `main` succeeds, create a tag
`v<extension-version>` on that commit and push it. The **GitHub Release** workflow rejects tags
that do not match `packages/vscode/package.json` or do not point to a commit
on `main`. It reruns CI on the tagged commit, then creates a GitHub Release
with **the VSIX that passed the packaged-host test** attached as an asset.
The `release` environment can require approval before publication. Do not
move a published tag or reuse an extension version.

To publish the same version to the Visual Studio Marketplace, run the
manual **Marketplace** workflow against the released **tag**, not `main`.
It checks that a GitHub Release already exists, reruns CI for the tag, and
publishes its verified VSIX using the `VSCE_PAT` secret. For a manual upload
with Marketplace credentials already configured:

```powershell
$version = (Get-Content packages/vscode/package.json -Raw | ConvertFrom-Json).version
npm exec --workspace=bicepflex -- vsce publish --packagePath "packages/vscode/bicepflex-$version.vsix"
```

Confirm the published version on the Marketplace. Never attempt to republish
an existing extension version.
