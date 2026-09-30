# Changelog

## 0.2.1 (unreleased)

- Group consecutive parameters without `@description` by default, separating
  described parameters; add `bicepParameterSpacing: "inherit"` to follow the
  general declaration spacing policy instead.
- Keep function calls within `&&`/`||` conditions inline by default; add
  `bicepLogicalCallLayout: "wrap"` for width-based argument wrapping.
- Indent nested ternary branches by one configured indentation level rather
  than two, including branch comments.
- Show source line and branch coverage totals in the GitHub Actions run summary.

## 0.2.0 (first release)

- Distribute a standalone VS Code formatter that bundles Prettier, the Bicep
  plugin and compiler bridge. No project-local npm installation or separate
  Prettier extension is needed.
- Provide user/workspace options, minimal preset and offline configuration
  IntelliSense. Preserve the compiler-backed safety contract because the Bicep
  language server does not expose syntax/binding through its formatting API.
- Configurable formatting, semantic dependency ordering, property and decorator
  priorities, movable ignored declarations, schema-validated settings and
  structured bridge/runtime/syntax errors.
- Keep structural, comment and compiler-diagnostic safety gates; preserve line
  endings by default to avoid changing multiline-string values.
- Verify Linux, Windows, and macOS builds in CI; publish the tested VSIX as a
  GitHub Release asset when a version-matching tag is pushed from `main`.
