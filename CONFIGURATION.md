# BicepFlex configuration

Use these options with the standalone VS Code formatter through individual
`bicepFlex.*` settings in the Settings UI or User/Workspace Settings JSON.
You may also use `.prettierrc.json` or another Prettier configuration file
for project-specific settings. Neither configuration approach installs npm
packages in the project.

All settings apply to `.bicep` and `.bicepparam` where the syntax is valid.
Options for resources, for example, have no effect on parameter files.

## Start small

Without any configuration, the extension uses every opinionated default.
To change one option globally in VS Code User Settings:

```json
{
  "bicepFlex.bicepUnionLayout": "multiline"
}
```

Add only the options you want to change. VS Code Settings and JSON hover
descriptions show each default (including inherited width and indentation
defaults). Preset appears first when browsing BicepFlex in the Settings UI with
the search box empty, followed by common layout and ordering options, then
advanced controls. Search results may use VS Code's own sorting. Each dropdown
explains what its values do, both in the setting description and in the
dropdown. The extension supplies offline Bicep option completion in Settings
and JSON `.prettierrc` files without a `$schema` reference, a repository clone,
or an npm installation. Alternatively,
for project-specific settings in `.prettierrc.json`:

```json
{
  "bicepUnionLayout": "multiline",
  "bicepResourcePropertyOrder": ["name", "location", "tags", "*", "properties"]
}
```

The bundled Bicep plugin needs no `plugins` entry. Plugin names in project
configuration do not load into this extension; only its bundled plugin runs
for Bicep documents. Explicitly set
`bicepFlex.*` options take precedence over project configuration and preset
defaults. Unchanged settings do not override project configuration. An
explicitly selected preset also takes precedence over project configuration
for the options it specifies.
The extension reads project config and EditorConfig only in trusted workspaces.
[configuration.example.json](configuration.example.json) contains all defaults.

## Parameter spacing

By default, consecutive `.bicep` parameter declarations without
`@description` have no blank line between them. A parameter decorated with
`@description` (including `@sys.description`) is separated from its neighboring
parameters by one blank line. Other decorators do not separate parameters.
Spacing next to non-parameter declarations and across comments follows
`bicepDeclarationSpacing`; `.bicepparam` assignments are unaffected.

Set the `bicepParameterSpacing` option to `"inherit"` in project configuration (or
`"bicepFlex.bicepParameterSpacing": "inherit"` in VS Code Settings) to apply
`bicepDeclarationSpacing` to all parameter gaps instead. This also restores
author spacing when `bicepDeclarationSpacing` is `"preserve"`.

## Named presets

Choose a VS Code setting in User or Workspace Settings:

| Preset        | Behavior                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `opinionated` | Dependency-aware formatting with the default layout and ordering policies                                                               |
| `minimal`     | Same layout defaults, but no declaration, resource/module property, decorator, nested-resource, import-member or type-member reordering |

For example:

```json
{
  "bicepFlex.preset": "minimal"
}
```

Set individual options to override the preset:

```json
{
  "bicepFlex.preset": "minimal",
  "bicepFlex.bicepSortProperties": true,
  "bicepFlex.bicepPrintWidth": 180
}
```

Explicit options win, including values equal to ordinary defaults. Project
file overrides apply unless the corresponding BicepFlex setting is set.

`minimal` does not mean byte-for-byte preservation or parity with `bicep format`:
whitespace, optional quotes and lambda parentheses still follow the normal
settings. Safety checks remain mandatory in both presets.

## Bicep-only layout in a mixed-language project

You can use width 100 for other languages and width 180 for Bicep without a
Prettier `overrides` block:

```json
{
  "printWidth": 100,
  "tabWidth": 4,
  "bicepPrintWidth": 180,
  "bicepTabWidth": 2,
  "bicepIndentStyle": "spaces"
}
```

`bicepPrintWidth` and `bicepTabWidth` inherit their standard Prettier counterparts
when omitted. `bicepIndentStyle: "inherit"` follows `useTabs`. Explicit
Bicep-specific settings win over standard settings for `.bicep` and
`.bicepparam` only, including loop/header width decisions. They do not mutate
the settings used by JavaScript or other printers.

If a Bicep-specific setting is present, changing only `printWidth`, `tabWidth`,
or `useTabs` will not override it. Change the corresponding Bicep setting
instead in User Settings or the project config.

## Ordering arrays

The four priority settings accept **arrays of strings**. First-listed items come
first. Omitted sections/properties retain
relative order after listed entries; safety constraints and dependencies still
take priority over section preferences.

`bicepDeclarationOrder` defaults to:

```json
[
  "metadata",
  "extension",
  "targetScope",
  "import",
  "type",
  "param",
  "func",
  "var",
  "resource",
  "module",
  "output"
]
```

Additional recognized kinds are `using`, `extends`, `test`, and `assert`.
`using` and `extends` take mandatory parameter-file header precedence.
Resources/modules share the earlier of their two priorities unless
`bicepResourceModuleOrder` is `"separate"`.

`bicepResourcePropertyOrder` defaults to:

```json
[
  "name",
  "parent",
  "scope",
  "dependsOn",
  "location",
  "tags",
  "identity",
  "kind",
  "sku",
  "zones",
  "plan",
  "*",
  "properties"
]
```

`bicepModulePropertyOrder` defaults to:

```json
["name", "scope", "dependsOn", "*", "params"]
```

In these two lists, `"*"` means **all unlisted property names**, preserving
their relative order. Without `"*"`, unlisted properties follow listed ones.
Only immediate resource/module body properties are sorted; nested ordinary
objects are not alphabetized. Custom identifier-shaped property names are
allowed for extensible resource types.

`bicepDecoratorOrder` defaults to:

```json
[
  "export",
  "sealed",
  "description",
  "metadata",
  "discriminator",
  "secure",
  "allowed",
  "minLength",
  "maxLength",
  "minValue",
  "maxValue",
  "batchSize"
]
```

Supported entries are the built-in names above. Omitted decorators act as
boundaries rather than being moved to an arbitrary position. Unknown and
duplicate decorators always prevent sorting across them. Comments attached to
a decorator move with it. Names are case-sensitive; `sys.description` uses the
`"description"` entry. An ignored declaration's decorators are not sorted.

Empty arrays, duplicates, whitespace-padded names and commas inside entries are
errors. To disable sorting, use its boolean switch rather than an empty list.

Use individual `bicepFlex.*` settings in VS Code User Settings for machine-wide
preferences, or the same property directly in a project `.prettierrc.json`.

## All options

### Standard layout

| Option       | Default  | Values and behavior                                                                              |
| ------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `printWidth` | `180`    | Positive integer; wrapping target, not a hard line limit                                         |
| `tabWidth`   | `2`      | Integer from 0 to 1000; spaces per indent and tab width for width decisions                      |
| `useTabs`    | `false`  | `true` uses tabs for structural indentation                                                      |
| `endOfLine`  | `"auto"` | `"auto"`, `"lf"`, `"crlf"`, `"cr"`; prefer auto to preserve consistently ended multiline strings |

### Bicep-only layout overrides

| Option             | Default                       | Values and behavior                                                  |
| ------------------ | ----------------------------- | -------------------------------------------------------------------- |
| `bicepPrintWidth`  | Omitted; inherit `printWidth` | Positive integer up to 2147483647; Bicep-only wrapping target        |
| `bicepTabWidth`    | Omitted; inherit `tabWidth`   | Integer from 0 to 1000; Bicep-only indentation width                 |
| `bicepIndentStyle` | `"inherit"`                   | `"inherit"`, `"spaces"`, `"tabs"`; override `useTabs` only for Bicep |

The generated default configuration omits the two unset numeric overrides so
standard Prettier layout settings continue to work.

### Ordering

| Option                           | Default                | Values and behavior                                                                                                                                                            |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bicepSortDeclarations`          | `true`                 | Enable section/dependency sorting; `false` preserves declaration sequence                                                                                                      |
| `bicepDeclarationOrder`          | Array above            | Declaration section priorities                                                                                                                                                 |
| `bicepDependencyOrder`           | `"ready-first"`        | `"ready-first"` chooses the earliest currently ready declaration; `"dependencies-first"` pulls prerequisites before the earliest consumer                                      |
| `bicepResourceModuleOrder`       | `"combined"`           | `"combined"` keeps resources/modules together; `"separate"` honors their separate section priorities                                                                           |
| `bicepUnusedDeclarations`        | `"boundary"`           | `"boundary"` fixes unused vars/unreferenced existing resources in place; `"section"` allows them to move with normal section sorting                                           |
| `bicepSectionComments`           | `"boundary"`           | `"boundary"` fixes headings followed by a blank line; `"attached"` moves headings with the next declaration                                                                    |
| `bicepIgnoredDeclarations`       | `"move"`               | `"move"` permits an ignored declaration and its ignore comment to move; `"boundary"` fixes them in place                                                                       |
| `bicepTypeOrder`                 | `"dependents-first"`   | `"dependents-first"` puts referencing types first; `"dependencies-first"` puts referenced types first; `"preserve"` keeps source order within the type section                 |
| `bicepFunctionOrder`             | `"dependencies-first"` | `"dependencies-first"` puts helpers first; `"dependents-first"` puts callers first; `"preserve"` retains source order within the function section                              |
| `bicepVariablePlacement`         | `"first-use"`          | `"first-use"` emits used variables immediately before their first consumer; `"section"` retains them in the configured var section where dependencies permit                   |
| `bicepExistingResourcePlacement` | `"first-use"`          | `"first-use"` emits used existing resources before first use; `"preserve"` retains their position in the dependency-safe resource sequence                                     |
| `bicepOutputPlacement`           | `"dependency"`         | `"dependency"` places resource/module-related outputs after their last required resource/module; `"end"` leaves outputs in their configured output section                     |
| `bicepOutputOnlyVariables`       | `"end"`                | `"end"` keeps output-only variables with outputs in the output section; `"dependency"` permits dependency-adjacent placement                                                   |
| `bicepSortProperties`            | `true`                 | Enable immediate resource/module property sorting                                                                                                                              |
| `bicepResourcePropertyOrder`     | Array above            | Resource property priorities                                                                                                                                                   |
| `bicepModulePropertyOrder`       | Array above            | Module property priorities                                                                                                                                                     |
| `bicepNestedResources`           | `"last"`               | `"last"` places nested resources after ordinary properties; `"preserve"` fixes them as boundaries between property sections                                                    |
| `bicepSortDecorators`            | `true`                 | Enable built-in decorator priority sorting                                                                                                                                     |
| `bicepDecoratorOrder`            | Array above            | Recognized built-in decorator priorities                                                                                                                                       |
| `bicepImportMemberOrder`         | `"preserve"`           | `"preserve"` retains member order; `"alphabetical"` sorts case-sensitively by original imported name, retaining aliases                                                        |
| `bicepTypeMemberOrder`           | `"preserve"`           | `"preserve"` retains object-type member order; `"required-first"` places syntactically nullable (`T?`) members after other members, retaining relative order within each group |

### Wrapping and whitespace

| Option                    | Default         | Values and behavior                                                                                                                                                                                                 |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bicepObjectLayout`       | `"multiline"`   | `"multiline"` expands nonempty objects/types; `"auto"` allows compact source objects to remain compact when they fit                                                                                                |
| `bicepArrayLayout`        | `"compact"`     | `"compact"` fits primitive arrays inline; `"multiline"` expands them; `"preserve"` retains the source compact/expanded preference, subject to width                                                                 |
| `bicepDeclarationSpacing` | `"separate"`    | `"separate"` inserts one blank line between declarations; `"compact"` removes it; `"preserve"` retains author spacing subject to Bicep's collapse of repeated blank lines; parameter/import spacing can override it |
| `bicepParameterSpacing`   | `"description"` | `"description"` groups plain parameters and separates described ones; `"inherit"` follows `bicepDeclarationSpacing` for consecutive parameters                                                                      |
| `bicepImportSpacing`      | `"compact"`     | `"compact"` removes blank lines within import blocks; `"separate"` inserts one; `"preserve"` retains author spacing; `"inherit"` follows declaration spacing                                                        |
| `bicepPropertyBlankLines` | `false`         | `true` retains up to one author blank line between properties; comments/section boundaries remain protected either way                                                                                              |
| `bicepUnionLayout`        | `"auto"`        | `"auto"` keeps fitting unions inline and wraps long unions; `"multiline"` places every member of a multi-member union on its own line                                                                               |
| `bicepConditionalHeader`  | `"inline"`      | `"inline"` keeps direct resource/module `if` headers inline even when long; `"auto"` moves `if` below `=` only when the header exceeds width; `"next-line"` always moves it                                         |
| `bicepLogicalCallLayout`  | `"inline"`      | `"inline"` keeps calls in logical conditions on one line, even beyond width; `"wrap"` allows width-based argument wrapping (never flattens comments or multiline literals)                                          |
| `bicepLoopLayout`         | `"auto"`        | `"auto"` compacts object-loop headers when they fit and closes with `}]`; `"expanded"` retains the native bracket layout (multiline for multiline bodies)                                                           |
| `bicepQuoteProperties`    | `"as-needed"`   | `"as-needed"` removes optional quotes from identifier keys; `"preserve"` retains author quoting                                                                                                                     |
| `bicepLambdaParentheses`  | `"avoid"`       | `"avoid"` removes optional single-parameter parentheses; `"always"` adds them; `"preserve"` retains source choice                                                                                                   |
| `bicepDescriptionWidth`   | `"ignore"`      | `"ignore"` leaves descriptions inline regardless of width; `"wrap"` wraps the call around its argument when long, never reflows or splits the string                                                                |

## Interactions and examples

### Dependency ties

For author order `consumer, unrelated, dependency`, with consumer referencing
dependency:

```text
ready-first:        unrelated, dependency, consumer
dependencies-first: dependency, consumer, unrelated
```

Both are dependency-safe. Section priorities apply before source-order
tie-breaking, and helpers move before their first consumer. Type/function
direction settings are intentional exceptions to dependency-first display.

### Independent spacing

To separate declarations while keeping imports together:

```json
{
  "bicepDeclarationSpacing": "separate",
  "bicepImportSpacing": "compact"
}
```

Import spacing is more specific and wins for consecutive imports. To preserve
author spacing everywhere, set declaration and import spacing to `"preserve"`
and parameter spacing to `"inherit"` (or set import spacing to `"inherit"`).
Comment sections are not removed to join an import block.

### Disable movement but keep whitespace formatting

```json
{
  "bicepSortDeclarations": false,
  "bicepSortProperties": false,
  "bicepSortDecorators": false,
  "bicepNestedResources": "preserve",
  "bicepTypeMemberOrder": "preserve",
  "bicepImportMemberOrder": "preserve"
}
```

Nested-resource placement and member sorting have independent switches.
Priority arrays are validated even when the corresponding sorting is disabled.

### Preserve an ignored declaration's position

```json
{ "bicepIgnoredDeclarations": "boundary" }
```

```bicep
// prettier-ignore
var tags = { environment:'dev', owner:'platform' }
```

Neither mode reformats the ignored text. `"move"` only allows relocating it.

### Multiline union and conditional styles

With `"bicepUnionLayout": "multiline"`:

<!-- prettier-ignore -->
```bicep
type Environment =
  | 'dev'
  | 'prod'
```

With `"bicepConditionalHeader": "next-line"`:

<!-- prettier-ignore -->
```bicep
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' =
  if (deployIdentity) {
    name: 'example'
    location: location
  }
```

The conditional policy applies to a direct resource/module `if`. A conditional
inside a `for` follows the loop policy instead, because its grammar differs.

## Precedence and safety

Explicit BicepFlex settings (including an explicitly selected preset) win over
project configuration and its file overrides. Project configuration supplies
options not explicitly set in VS Code; both win over the default preset.
The formatter does not use the Prettier extension's `prettier.*` VS Code settings.

Ordering boundaries take precedence over section/dependency preferences; no
declarations cross a fixed heading, ignored declaration, or unused declaration.
Recursive type components retain internal source order because a total ordering
is impossible. Parameter-file assignments retain source order, and `using`/
`extends` header precedence cannot be overridden into invalid syntax.

**Safety invariants are not optional:** no setting disables parsing, structural
equivalence checks, compiler-diagnostic comparison, lexical scoping, comment/
string preservation, or diagnostic-directive protection. Unknown/duplicate
decorators, spreads and ambiguous keys constrain sorting. Grammar-required
parentheses, quotes and separators are always retained. Comment text is not
reflowed, arbitrary object keys/array elements are not sorted, and expressions
are not rewritten to satisfy width. Alignment uses single spaces; there is no
column-alignment mode.

Line endings are a Prettier limitation: `"auto"` preserves a consistently ended
file's convention, but mixed-EOL input is normalized before the plugin sees it.
Explicit EOL conversion also changes newline values inside multiline strings.
Read [README.md](README.md#line-endings-and-multiline-strings) before forcing EOLs.

JSON schema defaults are documentation/completion hints, not project mutations.
Missing options get runtime defaults even without a schema. Regenerate and check
the shipped schema/example with `npm run configuration:generate` and
`npm run configuration:check`.

## Troubleshooting formatting failures

| Error                                                        | Action                                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BICEP_BRIDGE_VERSION_MISMATCH`                              | Run **Developer: Reload Window** in VS Code. If it persists, reinstall the extension or run `npm run build:extension` in a source checkout; do not mix JavaScript and native bridge artifacts. |
| `BICEP_INVALID_CONFIGURATION`                                | Fix the named option. Ordering values must be arrays, and numeric overrides must be in range.                                                                                                  |
| `BICEP_SYNTAX_ERROR`                                         | Inspect the Bicep compiler diagnostic and its line/column. Invalid input is refused; syntax newer than the bundled compiler may require an extension update.                                   |
| `BICEP_RUNTIME_MISSING` / `BICEP_RUNTIME_UNAVAILABLE`        | Install the .NET 10 runtime for the extension host architecture and ensure `dotnet` is on PATH. In WSL/SSH/containers, install it on that host.                                                |
| `BICEP_BRIDGE_MISSING` / `BICEP_BRIDGE_FAILED`               | Reinstall or rebuild the extension. A malformed bridge response is not automatically classified as a missing runtime.                                                                          |
| `BICEP_SAFETY_CHECK_FAILED`                                  | No formatted output is applied. Report the failure with a non-sensitive, minimal reproduction and your configuration.                                                                          |
| `BICEP_TIMEOUT` / `BICEP_INPUT_LIMIT` / `BICEP_OUTPUT_LIMIT` | The existing 60-second or 32 MiB safety limit was reached; reduce the reproduction and report the issue.                                                                                       |

Errors identify bridge/runtime/native failures with a code in the extension's
**BicepFlex** Output channel. Input syntax errors additionally include
the compiler diagnostic and its one-based line/column.
Prettier's own option validation can reject bad values before the bridge is
called; those errors remain standard Prettier errors.

Protocol compatibility checks refuse mismatched JavaScript and native bridge
builds with a reload/reinstall message before applying any output.

Known pinned-printer limitation: Unicode line separators such as U+2028 inside
comments can be changed by the native layout engine. The safety check refuses
that output rather than returning altered code. The corpus report lists its
known annotated fixture separately from invalid-input fixtures; it does not
count arbitrary safety failures as successes.
