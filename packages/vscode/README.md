# BicepFlex

**Opinionated formatting for Azure Bicep and Bicep parameters, with the controls to
make it yours.** BicepFlex is a standalone VS Code formatter for `.bicep` and
`.bicepparam`. It bundles Prettier and a compiler-backed formatter; you do not
need a project-local npm installation or the Prettier VS Code extension.

## Get started

1. Install the [.NET 10 runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
   on the machine running the VS Code extension. For WSL, SSH, or containers,
   install it on the remote extension host. BicepFlex does not bundle or
   download the runtime.
2. Open a Bicep or Bicep parameters file and choose **Format Document With... >
   BicepFlex**. Set BicepFlex as the default formatter for that language if
   desired. The Microsoft Bicep extension can remain installed for language
   features; it is not required for formatting.
3. To use Format on Save, set `"editor.formatOnSaveMode": "file"` for both
   languages. Selection and modified-line formatting are not supported.

## What it formats

- Consistent two-space indentation, line endings, and line wrapping (default
  width: 180), plus layout for objects, arrays, loops, calls, ternaries, and
  decorators.
- Dependency-aware declaration ordering, configurable sections, and
  resource/module property priorities. Choose the `minimal` preset to avoid
  optional declaration and property reordering.
- Separate controls for parameters, imports, comments, conditions, and
  source-preserving layout. A `preserve` choice can keep authored structure
  where it is safe to do so.
- Syntax, comment, and compiler-diagnostic safeguards: formatting fails
  explicitly rather than returning output that changes meaning or introduces
  errors. Invalid input is not rewritten.

Configure BicepFlex in VS Code Settings or Settings JSON:

```json
{
  "bicepFlex.preset": "opinionated",
  "bicepFlex.bicepPrintWidth": 180,
  "bicepFlex.bicepTabWidth": 2,
  "bicepFlex.bicepIndentStyle": "spaces"
}
```

Individual settings override the preset. Trusted workspaces can also supply
optional `.prettierrc.json` settings with offline Bicep option completion;
explicit VS Code settings take precedence. Project-installed Prettier plugins
are not loaded into the extension. See the
[full configuration reference](https://github.com/slavizh/vsc-bicepflex/blob/main/CONFIGURATION.md)
for every option, default, interaction, and example.

## Requirements and limitations

BicepFlex uses Azure.Bicep.Core 0.47.16 and may not understand syntax added in
later Bicep releases. Formatting is whole-document only. If a file is invalid
or the output fails a safety check, the formatter reports the error instead
of applying edits.

[Report a problem](https://github.com/slavizh/vsc-bicepflex/issues) |
[Source and documentation](https://github.com/slavizh/vsc-bicepflex) |
[License](https://github.com/slavizh/vsc-bicepflex/blob/main/LICENSE)

Not affiliated with or endorsed by Microsoft or Prettier. The extension
package includes its license and third-party dependency notices.
