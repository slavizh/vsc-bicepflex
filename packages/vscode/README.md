# BicepFlex

Formats `.bicep` and `.bicepparam` with bundled Prettier and the official Bicep
compiler. Does not require local npm dependencies or the Prettier VS Code
extension. Install the .NET 10 runtime on the machine where VS Code runs the
extension; for remote workspaces, install it on the remote host. This extension
does not include or download the .NET runtime.

Select **BicepFlex** as the default formatter for Bicep and Bicep
Parameters in VS Code's **Format Document With...** menu. The Microsoft Bicep
extension is recommended for language features, but not required to format.
Formatting selections or modified ranges is not supported; if you enable
Format on Save, use `"editor.formatOnSaveMode": "file"` for both languages.

Defaults: two-space indentation, width 180, `endOfLine: "auto"`, multiline
objects and dependency-aware declaration ordering. Plain parameters form
compact blocks; parameters with `@description` have a blank line on either
side. Set `bicepFlex.bicepParameterSpacing` to `"inherit"` to follow general
declaration spacing instead. Resource properties place `location` before
`dependsOn` by default; the property order is configurable. Multiline ternary
branches indent one level.
Extra spaces between syntax tokens on one line
are collapsed without changing comments or strings. Change options in the VS Code Settings UI or User
Settings JSON:

```json
{
  "bicepFlex.bicepPrintWidth": 180,
  "bicepFlex.bicepTabWidth": 2,
  "bicepFlex.bicepIndentStyle": "spaces"
}
```

Set `"bicepFlex.preset": "minimal"` to avoid declaration and property
reordering. Individual settings override options supplied by optional
`.prettierrc.json` files, which receive offline Bicep option completion.
In the VS Code Settings UI, Preset appears first when browsing the extension
with an empty search box; frequently used layout and ordering options follow.
Dropdown descriptions explain each available value. Searches may use VS Code's
own ordering.
The extension always uses its bundled Bicep plugin; project plugin entries
do not load into the extension, and no project npm install is necessary. Only
trusted workspaces load project Prettier configuration. See the
[full configuration reference](https://github.com/slavizh/vsc-bicepflex/blob/main/CONFIGURATION.md).

Formatting is whole-document only and refuses invalid input or generated code
that changes syntax, comments, or compiler diagnostics. The formatter uses
Azure.Bicep.Core 0.47.16 and may not understand later syntax. The Bicep language
server's built-in formatting does not offer this formatter's ordering policies.

Not affiliated with or endorsed by Microsoft or Prettier. License and dependency
notices are included in the extension package.
