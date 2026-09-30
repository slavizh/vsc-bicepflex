# BicepFlex for VS Code

A standalone, compiler-backed, configurable formatter for Azure Bicep and
Bicep parameter files. It runs Prettier with the Bicep plugin bundled in the
VS Code extension; it does not require project-local npm packages or the
Prettier VS Code extension.

Microsoft's Bicep extension remains recommended for syntax highlighting,
IntelliSense, and diagnostics, but is not required for formatting.

## Requirements

- The **.NET 10 runtime**, with `dotnet` on `PATH`, on the machine running
  the VS Code extension. A .NET SDK also satisfies this requirement.
- VS Code 1.125 or newer. The extension also supports WSL, SSH and containers
  when the .NET runtime is installed on the remote extension host.

The VSIX bundles Prettier, the plugin and its managed formatter bridge. Formatting does not
require a Bicep CLI installation, a .NET SDK, Azure authentication, or network
access. The .NET runtime itself is **not** bundled.

**Language baseline:** Bicep **0.47.16**. The implementation uses the actual
`Azure.Bicep.Core` parser, binder, and layout engine, including the experimental
syntax understood by that version. Experimental features still require the
appropriate project `bicepconfig.json` settings. Future syntax is not assumed
compatible. The upstream Core NuGet API is not a supported public API; it is
pinned and upgrades must pass the compatibility suite.

## Installation and configuration

Install **BicepFlex** from the VS Code Marketplace (once published), or
install the locally built VSIX. Select this extension as the default formatter
for the two Bicep languages in VS Code User Settings (or workspace settings):

```json
{
  "[bicep]": {
    "editor.defaultFormatter": "slavizh.bicepflex"
  },
  "[bicep-params]": {
    "editor.defaultFormatter": "slavizh.bicepflex"
  }
}
```

**Format Document** works without `package.json`, `node_modules`, or a
`.prettierrc.json` in your project. Format on Save is optional and is not
silently enabled. Format Selection is not supported: dependency reordering
requires the whole file.
If your global `editor.formatOnSaveMode` is `"modifications"`, set it to
`"file"` for `[bicep]` and `[bicep-params]` to use whole-document formatting
on save.

Each option is available separately in the VS Code Settings UI, with its default
shown in Settings JSON hover text. When browsing the BicepFlex extension's
settings with an empty search box, Preset appears first and common settings
precede advanced ones; a search may use VS Code's own sorting. Dropdown
descriptions explain each choice. For machine-wide options, use User Settings:

```json
{
  "bicepFlex.bicepPrintWidth": 180,
  "bicepFlex.bicepTabWidth": 2,
  "bicepFlex.bicepIndentStyle": "spaces"
}
```

Only individual `bicepFlex.*` settings appear in the VS Code Settings UI.
BicepFlex settings override project configuration; an optional project config
supplies values for settings you have not specified.

`bicepFlex.preset` can be `"opinionated"` (default) or `"minimal"`.
An existing project `.prettierrc.json` supplies options unless overridden by
BicepFlex settings. The extension always uses its bundled Bicep plugin,
regardless of any `plugins` entries in project configuration; no npm
installation is necessary for VS Code formatting.
Project configs and EditorConfig are read only in trusted workspaces.
This extension is editor-only; `npx prettier` and CI formatting would require
a separately installed Prettier plugin. See
[CONFIGURATION.md](CONFIGURATION.md) for every option and precedence rule.

## Formatting contract

Defaults are two spaces, a 180-column wrapping target, one blank line between
declarations other than consecutive imports and plain parameters, and a final
newline. Consecutive parameters without
`@description` form a compact block; a parameter with `@description` has a
blank line before and after it. Nonempty objects and object types are
multiline; short primitive arrays and unions can fit on one line. Type members,
import members, ordinary object properties, and array elements retain their
order.

Consecutive import declarations form a compact block without blank lines between
them. A blank line separates that block from other declarations. Comment sections
are preserved. Set `bicepParameterSpacing: "inherit"` to use
`bicepDeclarationSpacing` for all parameter gaps; setting declaration spacing
to `"preserve"` alone still groups plain parameters.
Use `bicepParameterSpacing: "preserve"` to retain author gaps between
consecutive parameters independently of general declaration spacing.

Long calls and ternaries wrap at grammar-valid positions. Nested ternary
continuations and multiline object, array, loop, or call branches advance by
one indentation level (two spaces by default), without reindenting multiline
strings or comments. In array comprehensions, `?` and `:` following a wrapped
loop-body condition get one additional continuation level. Binary expressions
cannot arbitrarily wrap. Calls inside `&&`/`||` conditions stay inline by
default, even when the condition exceeds the width target, so logical clauses
remain readable. Set `bicepFlex.bicepLogicalCallLayout` to `"wrap"` to allow
width-based call wrapping instead; comments and multiline literals are never
flattened to force a call inline. Other calls inside `if` conditions also stay
inline by default; `bicepFlex.bicepIfConditionLayout: "wrap"` allows them to
wrap. Conditional resource/module headers keep `if` on the declaration line
even beyond the width target. Existing comments or
directives that make that layout unsafe take precedence. Long `@description(...)` decorators
are exempt from the width target. Strings and ordinary comments are not reflowed;
trailing comments stay inline. Extra same-line whitespace between syntax tokens
is reduced to one space without changing indentation, strings, comments, or
ignored declarations. Unnecessary quotes on identifier property names
and parentheses around a single lambda parameter are removed.

Object-producing loops keep `[for ...: {` on the declaration line when the
complete header fits `printWidth`. Conditional loops keep
`[for ...: if (...) {` inline even beyond that width by default; set
`bicepIfConditionLayout: "wrap"` to use the width target. Both forms indent the
body once and close with `}]`. `bicepLoopLayout: "expanded"` retains expanded
brackets. Comments at bracket boundaries and inside calls are preserved rather
than moved to force compaction.
Call-expression loops also collapse to one line when the entire expression
fits; object arguments in those loops become compact without padding inside
their braces (for example, `union(props, {slots: slots})`). Other inline
objects retain native brace spacing. Set
`bicepLoopLayout: "expanded"` to retain expanded brackets or
`bicepObjectLayout: "preserve"` to retain an expanded object argument.

Applicable layout and placement settings also offer `"preserve"`: authored
compact/expanded objects and arrays, individual union breaks, description and
condition-call line breaks, conditional `if` placement, loop brackets, parameter
spacing, and dependency-safe positions of variables and outputs. Layout
`"preserve"` can exceed `printWidth`; comments, directives, multiline literals,
dependencies, and the syntax/diagnostic safety checks take precedence.
For ordering controls expressed as booleans, use `bicepSortDeclarations: false`,
`bicepSortProperties: false`, or `bicepSortDecorators: false` instead of a
redundant `"preserve"` value. See [CONFIGURATION.md](CONFIGURATION.md) for
individual settings and interactions.

### Line endings and multiline strings

The default is **`endOfLine: "auto"`**, not CRLF. Bicep multiline strings retain
newline characters in their deployed values, so changing LF to CRLF can change
deployment semantics. `auto` preserves the existing convention in consistently
ended files; new-file CRLF preferences can be set in VS Code or EditorConfig.

**Prettier limitation:** Prettier normalizes incoming line endings before invoking
plugins. Mixed-EOL documents cannot be preserved byte-for-byte by this plugin,
and explicit `endOfLine: "lf"`/`"crlf"` conversions also affect multiline strings.
Use consistent line endings and `auto` when literal newline values matter.
The formatter cannot recover unsaved original text by reading the file from disk.

### Declaration ordering

The default sections are:

```text
metadata, extension, targetScope, import, type, param, func, var,
resource/module, output
```

- Resources and modules share one sequence. Dependencies, including implicit
  symbol references, must come first. Among currently ready declarations, the
  earliest in the author's order wins.
- Used variables and `existing` resources move immediately before their first
  consumer, following dependency chains. Shared helpers are emitted once.
- Direct resource/module outputs follow their last dependency, before other
  consumers. Output-only variables and their associated outputs go at the end.
  Outputs with no resource/module dependencies remain at the end.
- Referencing types come first, followed by the types they reference. A shared
  type follows all types that reference it. Mutually recursive type components retain their
  original internal order because no total ordering exists.
- Functions follow their called helper functions.
- `.bicepparam` retains parameter-assignment order and puts variables immediately
  before first use. `using`/`extends` remain in grammar-valid positions.
- Unused variables and unreferenced existing resources are retained as fixed
  ordering boundaries. Exported variables are not treated as unused.
- Standalone comment headings followed by a blank line and diagnostic-region
  directives form boundaries. Attached documentation moves with its declaration.
  Ordering happens **within** boundaries; it does not move a declaration across
  them to repair a dependency.

References are resolved through Bicep's binder, not identifier-text matching.
Loop/lambda locals, imported symbols, nested-resource references, and shadowing
are therefore distinguished.

### Resource, module, and decorator ordering

Resource-body property priority:

```text
name, parent, scope, location, dependsOn, tags, identity, kind, sku,
zones, plan, [unlisted properties], properties
```

Module-body priority:

```text
name, scope, dependsOn, [unlisted properties], params
```

These apply only to immediate declaration bodies, including bodies inside
conditions and loops. Unlisted keys retain their relative order. Spreads,
dynamic keys, duplicate keys, and section headings constrain sorting.
Nested resources remain in their original scope and follow ordinary properties.

Decorator priority:

```text
export, sealed, description, metadata, discriminator, secure, allowed,
minLength, maxLength, minValue, maxValue, batchSize
```

This reflects the final selected rule: `export` and `sealed` precede
`description`. Minima precede matching maxima. Unknown or duplicate decorators
are ordering boundaries, and attached comments move with decorators. Only
decorators valid for the underlying declaration can be used.

### Ignoring a declaration

```bicep
// prettier-ignore
var tags = { environment: 'dev', owner: 'platform' }
```

The entire next declaration, including decorators, retains its text. **It can
still move**, together with its ignore comment, under dependency-ordering rules.
This is intentionally different from a fixed section boundary. It does not
disable parsing or safety checks. The supported ignore unit is a declaration,
not an arbitrary expression or a start/end range.

## Options

All supported formatting policies are exposed through VS Code settings or
project Prettier configuration. See [CONFIGURATION.md](CONFIGURATION.md) for every option, allowed
value, default, precedence rule, and example. Defaults remain opinionated; you
only need to specify the settings you want to change.

Ordering settings are **JSON arrays**, listed from first to last:

```json
{
  "bicepFlex.bicepResourcePropertyOrder": [
    "name",
    "parent",
    "scope",
    "location",
    "tags",
    "*",
    "properties",
    "dependsOn"
  ],
  "bicepFlex.bicepImportSpacing": "compact",
  "bicepFlex.bicepIgnoredDeclarations": "boundary"
}
```

`*` marks unlisted properties; their relative order is preserved. Empty arrays,
duplicates, invalid names, and string values are rejected. Array priorities
apply to declarations, resource properties, module properties, and decorators.

The VSIX provides offline IntelliSense for Bicep options in JSON `.prettierrc`
files and contributes the same settings to VS Code Settings. No `$schema`
or project-local npm package is required.

For a mixed-language project, use `bicepPrintWidth`, `bicepTabWidth` and
`bicepIndentStyle` to override layout only for Bicep, without adding a file
override. Unset numeric overrides inherit `printWidth`/`tabWidth`, and
`bicepIndentStyle: "inherit"` follows `useTabs`.

The `minimal` preset preserves declaration, property and decorator ordering
while retaining safety checks and layout. See
[presets and customization](CONFIGURATION.md#named-presets).

Standard Prettier `printWidth`, `tabWidth`, `useTabs`, and `endOfLine` are
respected. JavaScript-specific options such as `semi`, `singleQuote`,
`trailingComma`, and `arrowParens` do not redefine Bicep grammar.

## Safety and scope

Each request parses with the official parser, applies syntax-aware transforms,
prints with Bicep's layout engine, then reparses. Structural fingerprints,
comment/directive preservation, and before/after compiler diagnostics are checked
before any output is returned. New diagnostics or unexpected structure changes
cause an actionable error, not a best-effort rewrite. Existing syntax errors are
refused. Existing semantic errors are not repaired.

Formatting never restores remote modules, evaluates deployments, executes shell
text from source files, or writes the input file itself. VS Code owns file
writes. Local project configuration, modules, and referenced files are read by
the compiler as needed. Diagnostic-bearing declarations are protected when
reflow could change directive targets.

The language-version pin, compiler checks, and tests reduce risk; they are not a
claim that every possible input or future experimental language feature has
been proven correct. Compiler-equivalence tests cover representative deployments,
and the upstream corpus exercises valid and intentionally invalid syntax.

The Bicep language server exposes its built-in formatting as document text edits,
but not the syntax tree, binder, or semantic model needed for these policies and
safety checks. Its formatter cannot replace the pinned `Azure.Bicep.Core` bridge
without changing the formatting contract. A Bicep extension update does not
automatically update the compiler inside this formatter; upgrades require
compatibility testing.

## Development and verification

Source builds require a .NET 10 **SDK**, Node.js 22+, and the Bicep 0.47.16 CLI
for compiler-equivalence tests:

```console
npm ci
npm run build:extension
npm test
npm run test:host --workspace=bicepflex
npm run package --workspace=bicepflex
npm run test:coverage
```

`npm run test:coverage` instruments the TypeScript formatter, the extension
inside a real VS Code host, and the managed bridge, then prints separate line
and branch totals. CI shows the totals in the Actions run summary and uploads
the source-level summaries and native Cobertura report as the
`production-coverage` artifact. `npm run test:coverage:enforce` requires 100% of both metrics in all
three components; the suite does not yet meet that target. Coverage is a
measurement of exercised paths, not a guarantee of correct formatting for
every Bicep input.

`npm run test:corpus` uses the official Bicep 0.47.16 samples extracted under
`artifacts/upstream/bicep-0.47.16/src/Bicep.Core.Samples/Files`, or a directory
specified with `BICEP_CORPUS`. `BICEP_CORPUS_FILTER` restricts debugging runs.
The runner records idempotence and expected syntax-error refusals in
`artifacts/corpus-results.json`. See CI for the pinned download procedure.

## Publishing

Contribute through a branch and pull request into `main`. Once merged and
verified, pushing a version-matching tag runs CI again and attaches the
tested VSIX to a GitHub Release. Marketplace publication is a separate manual
workflow requiring publisher credentials. See [RELEASING.md](RELEASING.md).

MIT licensed. Dependency notices ship in `THIRD-PARTY-NOTICES` and the generated
bridge license inventory. This project is not affiliated with or endorsed by
Microsoft or Prettier.
