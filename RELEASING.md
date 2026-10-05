# Release checklist

1. Verify ownership of the `cloudadministrator` Visual Studio Marketplace publisher. Review
   the VSIX manifest, bundled PNG icon, Marketplace listing, Bicep version,
   formatting rules, and all redistributed dependency licenses. Do not imply
   Microsoft or Prettier endorsement.
2. Update the version only in `packages/vscode/package.json` (for example,
   `npm version patch --workspace=bicepflex --no-git-tag-version`), and commit
   the generated `package-lock.json` change. Changes to the icon or other
   Marketplace metadata also require a new version; never replace a published
   VSIX. Update the changelog for that version; the extension build copies it
   into the Marketplace package. Keep
   `dist/extension.mjs` and `dist/bridge` from the same build. If the bridge
   contract changes, increment
   the protocol version in `src/bridge.ts` and `native/Bicep.Formatter/Program.cs`
   together. Updates to Azure.Bicep.Core require compiler-equivalence, corpus,
   and VS Code host verification; the language server cannot substitute for
   the compiler-backed ordering and safety checks.
3. Work on a branch and open a pull request into `main`. Require passing
   Linux, Windows, and macOS CI before merging. Linux CI additionally runs
   coverage measurement, the official corpus, and a real VS Code host test
   against the packaged VSIX.
4. Use the protected GitHub `release` environment, restricted to `main` and
   `v*` tags and requiring approval by the repository owner. Store `VSCE_PAT` as an
   environment secret only if publishing to the Marketplace. Rotate the
   credential before it expires; global Azure DevOps PATs stop working on
   December 1, 2026.

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
`artifacts/coverage`, with component totals in `summary.json`, shown in the
Actions run summary and uploaded by CI. Run `npm run test:coverage:enforce`
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
must contain its PNG icon, README, changelog, Prettier bundle, managed bridge,
configuration schema, notices and license texts. It must not contain source
checkout files, test workspaces, credentials, host logs or downloaded corpora.
The .NET 10 runtime and source artwork are not included.

Install the VSIX in a clean profile and check both Bicep file types, the default
formatter, optional project overrides, format-on-save, and missing .NET diagnostics.
Test with Microsoft's Bicep extension installed as well as without it.
For WSL/SSH/containers, the runtime is required on the remote extension host.

## Publish

After a version-changing pull request merges, successful CI on `main` detects
the version change, verifies that `v<extension-version>` is not already used,
and waits for approval in the `release` environment. It then creates the
version tag on that tested `main` commit and attaches **the VSIX from the same
CI run that passed the packaged-host test** to a GitHub Release. An unchanged
version, a failed check, or a manual CI run does not create a release. Do not
move a published tag or reuse an extension version. Release automation
currently supports stable `major.minor.patch` versions.

After the GitHub Release succeeds, the **Marketplace** job starts automatically
and waits for separate `release` environment approval. It downloads the
published Release asset, verifies its SHA-256 digest, and publishes that exact
VSIX using `VSCE_PAT`. It does not rerun CI. If Marketplace publication fails,
fix the cause and manually run the **Marketplace** workflow on `main`, supplying
the published release tag (for example, `v0.3.0`). This manual path is also
needed for releases made before automatic publication was introduced. Do not
attempt to republish an existing extension version. Confirm the published
version on the Marketplace.
