# Changelog

## Unreleased

- Create the version tag and GitHub Release from the successful merged-`main`
  CI run when the extension version changes, reusing that run's tested VSIX.
- Start Marketplace publishing after the GitHub Release with separate approval,
  verifying and reusing its asset instead of rerunning CI. Keep a manual
  Marketplace path for previously created releases and failed publishes.

## 0.3.0 (2026-10-05)

- Bump the JavaScript/native bridge protocol together for the new managed
  option fields and defaults, refusing stale mixed-version formatter builds.
- Respect wrapped and source-preserved nested logical calls when an enclosing
  conditional call or compact expression would otherwise flatten them.
- Use the `cloudadministrator` Marketplace publisher. Existing
  `editor.defaultFormatter` settings must use `cloudadministrator.bicepflex`.
- Keep fitting arrays of one or two small objects compact, including within
  multiline calls; honor width, comments, literals, and explicit layout choices.
- Keep direct resource/module `if` conditions on one line and move long
  complete headers below `=` by default via `bicepConditionalHeader: "compact"`;
  retain the former `"inline"` behavior and existing `"auto"`, `"next-line"`,
  and `"preserve"` choices.
- Apply logical-call layout consistently under `&&`/`||` in any expression,
  not only `if` and ternary conditions, including authored preserve mode.
- Keep calls inside logical ternary conditions inline by default; respect
  explicit wrap/preserve choices and protect comments.
- Align wrapped lambda call bodies with their `=>` headers rather than adding
  a redundant continuation indent; retain nested-call and comment safety.
- Collapse fitting ternary object properties to a single line with tight object
  braces, while retaining multiline comments, strings and preserve-mode layout.
- Keep ternaries in multiline function arguments indented independently of
  enclosing conditionals, including nested object values and sibling properties.
- Keep comments attached to plain parameters within compact parameter blocks
  instead of inserting a blank line before the comment.
- Collapse fitting call-expression loops and their safe object arguments to
  one line with no interior brace padding instead of only expanding them;
  preserve comments and explicit layout choices.
- Compact fitting calls with object arguments in property values, including
  property access after the call, without losing the tight brace layout.
- Add source-faithful `"preserve"` choices for applicable object, union,
  conditional, loop, description, parameter-spacing, and declaration-placement
  policies. Existing array preservation also retains compact source layout
  beyond the width target where safe.
- Keep calls inside `if` conditions and conditional object-loop headers inline
  by default, even beyond the width target; set
  `bicepIfConditionLayout: "wrap"` to allow width-based wrapping.
- Indent `?` and `:` branches in array comprehensions one level deeper when
  their ternary condition wraps across lines.
- Place resource `location` before `dependsOn` by default; custom resource
  property priority arrays still override this order.
- Indent multiline ternary object, array, loop, and function-call branches by
  one configured level instead of two; preserve nested branches and literal
  or comment contents.
- Remove redundant inline whitespace between Bicep syntax tokens, including
  the extra space before an extension alias, without rewriting strings,
  comments, or ignored declarations.
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
