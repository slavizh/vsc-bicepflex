# Release checklist

1. Verify ownership of the `slavizh` Visual Studio Marketplace publisher. Review
   the VSIX manifest, Bicep version, formatting rules, and all redistributed
   dependency licenses. Do not imply Microsoft or Prettier endorsement.
2. Update the extension version and changelogs. Keep `dist/extension.mjs` and
   `dist/bridge` from the same build. If the bridge contract changes, increment
   the protocol version in `src/bridge.ts` and `native/Bicep.Formatter/Program.cs`
   together. Updates to Azure.Bicep.Core require compiler-equivalence, corpus,
   and VS Code host verification; the language server cannot substitute for
   the compiler-backed ordering and safety checks.
3. Require successful CI, including format idempotence, compiler equivalence,
   official corpus, and real VS Code formatting from the packaged VSIX.
4. Configure a protected GitHub `release` environment with reviewers and
   store `VSCE_PAT` as a secret, never a file.

## Build and test

```console
npm ci
npm run check
npm run test:corpus
npm run package --workspace=bicepflex
npm run test:host --workspace=bicepflex
```

For the installed-VSIX host test, set `BICEPFLEX_TEST_PACKAGED=1` before
the last command. Without it, the test loads the development extension.
The runner uses an installed VS Code on Windows or downloads a pinned test host.
The fixture workspace has no npm dependencies and uses an isolated profile.
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

The manual **Release** workflow runs CI then publishes the verified VSIX.
It does not trigger automatically on tags or commits. After reviewing the
artifact, invoke the protected release workflow. For a manual upload with
Marketplace credentials already configured:

```console
npm exec --workspace=bicepflex -- vsce publish --packagePath packages/vscode/bicepflex-0.1.2.vsix
```

Confirm the published version on the Marketplace. Never attempt to republish
an existing extension version.
