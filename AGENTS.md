# Working on BicepFlex

Repository guidance for coding assistants and contributors. BicepFlex is a
standalone VS Code formatter for `.bicep` and `.bicepparam`, not a project-local
Prettier installation. Read [README.md](README.md) for the formatting contract
and [CONFIGURATION.md](CONFIGURATION.md) for settings and precedence before
changing behavior.

## Map of the code

- `src/index.ts`, `src/options.ts`, and `src/bridge.ts`: bundled Prettier
  plugin, public options, and the managed-process protocol.
- `native/Bicep.Formatter/`: compiler-backed formatter. `Program.cs` validates
  requests; `FormatOptions.cs` defines and validates managed settings;
  `Engine.cs` handles formatting and safety checks; `Layout.cs`, `Ordering.cs`,
  and `SyntaxTree.cs` handle layout, dependencies, and syntax traversal.
- `packages/vscode/src/extension.ts`: VS Code document formatter, preset and
  setting precedence, configuration resolution, and user-facing errors.
- `scripts/generate-configuration.mjs`: source of truth for VS Code setting
  order and dropdown value descriptions; generates option entries in
  `packages/vscode/package.json`, both configuration schemas, and
  `configuration.example.json`. Do not edit generated options by hand.
- `test/*.test.mjs`: plugin, bridge, compiler, options, and configuration
  checks. `packages/vscode/test-host/` exercises a real VS Code host.
  `scripts/test-corpus.mjs` exercises the upstream Bicep grammar corpus.

## Change checklist

1. Reproduce a bug with the exact input and settings, or write a failing test
   for a feature. Cover both file types where applicable, comments, decorators,
   strings, directives, nested syntax, indentation, and repeat formatting when
   affected. Keep fixture expectations intentional rather than weakening a
   failing assertion.
2. Trace behavior through the VS Code adapter, Prettier options, bridge, and
   native formatter as needed. Use existing syntax/binder helpers rather than
   regex or text matching for semantic decisions. Preserve the source's
   meaning: the engine rejects changed syntax fingerprints, changed comment
   text, new Bicep diagnostics, and malformed output. Never bypass these
   checks or return success-shaped output after a formatting failure.
3. For a new option, define its default and choices in `src/options.ts`,
   add the managed default/validation in `FormatOptions.cs`, wire its behavior,
   add it exactly once to `settingsOrder` and document every enum choice in
   `scripts/generate-configuration.mjs`. Run
   `npm run configuration:generate`; commit the generated manifest, both
   schemas, and example. Check preset behavior and VS Code/project-config
   precedence, including an explicit default-valued setting. Change both
   protocol versions together (`src/bridge.ts` and `Program.cs`) only when
   the bridge contract changes.
4. Update the related explanation in `README.md`, the option reference,
   interactions, and examples in `CONFIGURATION.md`, the Marketplace-facing
   `packages/vscode/README.md` when users would notice the behavior, and
   `CHANGELOG.md`. Search for conflicting claims about old defaults and syntax.
   Add focused plugin/native tests, a configuration-surface test, and a host
   test when VS Code settings, packaging, or errors are affected.
5. Run the smallest relevant tests while iterating; before proposing a PR run
   `npm run check`. That builds the plugin, bridge, and extension, checks
   generated configuration and formatting, and runs the complete unit suite.
   For syntax changes, run the Bicep CLI equivalence tests and the upstream
   corpus when available; for VS Code changes run the packaged host check:
   `npm run package --workspace=bicepflex`, then set
   `BICEPFLEX_TEST_PACKAGED=1` and run
   `npm run test:host --workspace=bicepflex`. The corpus needs the pinned
   upstream samples under `artifacts/upstream` (see CI for retrieval).
   `npm run test:coverage` measures coverage; strict 100% enforcement is not
   yet passing. Do not report measured coverage as full coverage.

Use a branch and PR into `main`; CI runs Linux, Windows, and macOS checks,
with Linux also checking the corpus and packaged VSIX. Do not publish or claim
a new version is released just because a PR passes. For version bumps and
release artifacts, follow [RELEASING.md](RELEASING.md): change the extension
version in `packages/vscode/package.json` only and include the updated lockfile.
