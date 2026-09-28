# Changelog

## Unreleased

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
