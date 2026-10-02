const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const extension = vscode.extensions.getExtension("slavizh.bicepflex");
  assert.ok(extension);
  await extension.activate();
  const contributed =
    extension.packageJSON.contributes.configuration.properties;
  const configurationOptions = Object.keys(contributed).filter((key) =>
    key.startsWith("bicepFlex."),
  );
  const schema = JSON.parse(
    await fs.readFile(
      path.join(extension.extensionPath, "schemas", "prettier.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    configurationOptions.slice().sort(),
    [
      "bicepFlex.preset",
      ...Object.keys(schema.$defs.configuration.properties)
        .filter((name) => name !== "overrides")
        .map((name) => `bicepFlex.${name}`),
    ].sort(),
  );
  assert.deepEqual(
    configurationOptions.map((key) => contributed[key].order),
    Array.from(
      { length: configurationOptions.length },
      (_, index) => index + 1,
    ),
  );
  for (const key of configurationOptions) {
    const setting = contributed[key];
    assert.match(setting.description, /Default:/, key);
    if (setting.enum) {
      assert.equal(setting.enum.length, setting.enumDescriptions.length, key);
      assert.ok(setting.enumDescriptions.every(Boolean), key);
    }
  }
  const bicepExtension = process.env.BICEPFLEX_BICEP_VSIX
    ? vscode.extensions.getExtension("ms-azuretools.vscode-bicep")
    : undefined;
  if (process.env.BICEPFLEX_BICEP_VSIX) {
    assert.ok(bicepExtension, "The official Bicep extension must be installed");
    await bicepExtension.activate();
  }
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(
    await fs.stat(path.join(folder.uri.fsPath, "node_modules")).then(
      () => true,
      () => false,
    ),
    false,
  );
  const outcomes = [];
  for (const [file, language, original, expected] of [
    [
      "sample.bicep",
      "bicep",
      "output greeting string='hello'\n",
      "output greeting string = 'hello'\n",
    ],
    [
      "sample.bicepparam",
      "bicep-params",
      "using none\r\nparam greeting='hello'\r\n",
      "using none\r\n\r\nparam greeting = 'hello'\r\n",
    ],
  ]) {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, file),
    );
    await vscode.window.showTextDocument(document);
    assert.equal(document.languageId, language);
    assert.equal(document.getText(), original);
    assert.equal(
      vscode.workspace
        .getConfiguration("editor", document)
        .get("defaultFormatter"),
      extension.id,
    );
    await vscode.commands.executeCommand("editor.action.formatDocument");
    assert.equal(document.getText(), expected);
    outcomes.push({ file, language, formatted: true });
  }
  const config = vscode.workspace.getConfiguration("bicepFlex");
  const extensionSource =
    "extension 'br:example.invalid/bicep/extensions/sample/v1:1.0.0'  as sampleExtension\n";
  await fs.writeFile(
    path.join(folder.uri.fsPath, "extension-alias.bicep"),
    extensionSource,
  );
  const extensionAlias = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "extension-alias.bicep"),
  );
  await vscode.window.showTextDocument(extensionAlias);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(
    extensionAlias.getText(),
    extensionSource.replace("  as ", " as "),
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "compact-objects.bicep"),
    "var result={entries:union([{code: first.id}],map(others,item=>{code:item.code}))}\n",
  );
  const compactObjects = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "compact-objects.bicep"),
  );
  await vscode.window.showTextDocument(compactObjects);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(compactObjects.getText(), /\[\{code: first\.id\}\]/);
  await fs.writeFile(
    path.join(folder.uri.fsPath, "ternary-object.bicep"),
    "param enabled bool\nvar result = enabled ? {name:'first'} : {name:'other'}\n",
  );
  const ternaryObject = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "ternary-object.bicep"),
  );
  await vscode.window.showTextDocument(ternaryObject);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(
    ternaryObject.getText(),
    /\n {2}\? \{\n {4}name: 'first'\n {2}\}\n {2}: \{\n {4}name: 'other'\n {2}\}/,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "loop-ternary.bicep"),
    "param names array\nvar values = [for name in names: union({first:name},{other:name}).first == 'first' ? name : 'other']\n",
  );
  const loopTernary = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "loop-ternary.bicep"),
  );
  await vscode.window.showTextDocument(loopTernary);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(loopTernary.getText(), /\n {2}for name in names: union\(/);
  assert.match(loopTernary.getText(), /\n {6}\? name\n {6}: 'other'\n\]/);
  await fs.writeFile(
    path.join(folder.uri.fsPath, "conditional-loop.bicep"),
    "resource apps 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = [for item in (union(defaults, overrides).directory.validation.rules.eligibleEntryIdentifiers): if (union(defaults, overrides).directory.keyStyle == 'Aliases') {alias:item}]\n",
  );
  const conditionalLoop = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "conditional-loop.bicep"),
  );
  await vscode.window.showTextDocument(conditionalLoop);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(
    conditionalLoop.getText(),
    / = \[for item in \(union\(defaults, overrides\)\.directory\.validation\.rules\.eligibleEntryIdentifiers\) : if \(union\(defaults, overrides\)\.directory\.keyStyle == 'Aliases'\) \{\n  alias: item\n\}\]/,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "direct-if.bicep"),
    "resource conditionalIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (!empty(recordConfig.replica.sourceName) || recordConfig.status =~ 'paused' || recordConfig.status =~ 'active' ? false : recordConfig.protectionMode !~ 'Disabled') {\n  name: 'current'\n  parent: parentIdentity\n  properties: {\n    state: recordConfig.protectionMode\n  }\n}\n",
  );
  const directIf = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "direct-if.bicep"),
  );
  await vscode.window.showTextDocument(directIf);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(
    directIf.getText(),
    / =\n  if \([^\n]*\? false : [^\n]*\) \{\n  name: 'current'/,
  );
  assert.equal(
    config.inspect("bicepConditionalHeader").defaultValue,
    "compact",
  );
  assert.equal(config.inspect("bicepPrintWidth").defaultValue, 180);
  assert.equal(config.inspect("bicepPrintWidth").workspaceValue, undefined);
  assert.equal(config.inspect("bicepTabWidth").defaultValue, 2);
  assert.equal(config.inspect("bicepArrayLayout").defaultValue, "compact");
  assert.equal(config.inspect("bicepIfConditionLayout").defaultValue, "inline");
  assert.deepEqual(
    config.inspect("bicepResourcePropertyOrder").defaultValue.slice(0, 5),
    ["name", "parent", "scope", "location", "dependsOn"],
  );
  assert.equal(
    config.inspect("bicepParameterSpacing").defaultValue,
    "description",
  );
  for (const [file, spacing, expected] of [
    [
      "grouped-params.bicep",
      undefined,
      "param first string\nparam second string\n",
    ],
    [
      "separate-params.bicep",
      "inherit",
      "param first string\n\nparam second string\n",
    ],
  ]) {
    if (spacing) {
      await config.update(
        "bicepParameterSpacing",
        spacing,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    await fs.writeFile(
      path.join(folder.uri.fsPath, file),
      "param first string\n\nparam second string\n",
    );
    const parameters = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, file),
    );
    await vscode.window.showTextDocument(parameters);
    await vscode.commands.executeCommand("editor.action.formatDocument");
    assert.equal(parameters.getText(), expected);
  }
  await config.update(
    "bicepParameterSpacing",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update("bicepTabWidth", 4, vscode.ConfigurationTarget.Workspace);
  await fs.writeFile(
    path.join(folder.uri.fsPath, "settings.bicep"),
    "output value object={enabled:true}\n",
  );
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "settings.bicep"),
  );
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(doc.getText(), /\n {4}enabled: true\n/);
  await config.update("bicepTabWidth", 6, vscode.ConfigurationTarget.Workspace);
  await fs.writeFile(
    path.join(folder.uri.fsPath, "individual.bicep"),
    "output value object={enabled:true}\n",
  );
  const individual = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "individual.bicep"),
  );
  await vscode.window.showTextDocument(individual);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(individual.getText(), /\n {6}enabled: true\n/);
  const settingsDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, ".vscode", "settings.json"),
  );
  await vscode.window.showTextDocument(settingsDocument);
  const settingPosition = settingsDocument.positionAt(
    settingsDocument.getText().indexOf('"bicepFlex.bicepTabWidth"') + 2,
  );
  let hoverText = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    const hovers = await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      settingsDocument.uri,
      settingPosition,
    );
    hoverText =
      hovers
        ?.flatMap((hover) =>
          hover.contents.map((content) =>
            typeof content === "string" ? content : content.value,
          ),
        )
        .join("\n") ?? "";
    if (hoverText.includes("Default: 2 in the Settings UI")) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.match(
    hoverText.replaceAll("\\", ""),
    /Default: 2 in the Settings UI; when unset, inherits tabWidth/,
  );
  const rootPosition = settingsDocument.positionAt(
    settingsDocument.getText().indexOf("{") + 1,
  );
  let settingDescription = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      settingsDocument.uri,
      rootPosition,
    );
    const suggestion = result?.items.find(
      (item) =>
        (typeof item.label === "string" ? item.label : item.label.label) ===
        "bicepFlex.bicepConditionalHeader",
    );
    settingDescription =
      typeof suggestion?.documentation === "string"
        ? suggestion.documentation
        : (suggestion?.documentation?.value ?? "");
    if (settingDescription.includes("Default:")) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.match(settingDescription, /Default:.*compact/);
  assert.match(settingDescription, /next-line.*always put if on the next line/);
  await config.update(
    "bicepTabWidth",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  const configured = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "config-case", "configured.bicep"),
  );
  await vscode.window.showTextDocument(configured);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(configured.getText(), /\n {3}enabled: true\n/);
  await config.update("bicepTabWidth", 6, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(configured.getText(), /\n {6}enabled: true\n/);
  await config.update(
    "bicepTabWidth",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(configured.getText(), /\n {3}enabled: true\n/);
  await config.update("tabWidth", 4, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(configured.getText(), /\n {3}enabled: true\n/);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(doc.getText(), /\n {4}enabled: true\n/);
  await config.update("bicepTabWidth", 2, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(doc.getText(), /\n {2}enabled: true\n/);
  await config.update(
    "bicepIndentStyle",
    "tabs",
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(doc.getText(), /\n\tenabled: true\n/);
  await config.update(
    "bicepIndentStyle",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "bicepTabWidth",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "tabWidth",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "choices.bicep"),
    "output names array=['one','two']\n",
  );
  const choices = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "choices.bicep"),
  );
  await vscode.window.showTextDocument(choices);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(choices.getText(), /\['one', 'two'\]/);
  await config.update(
    "bicepArrayLayout",
    "multiline",
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(choices.getText(), /\[\n\s+'one'\n\s+'two'\n\]/);
  await config.update(
    "bicepArrayLayout",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "bicepArrayLayout",
    "invalid",
    vscode.ConfigurationTarget.Workspace,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "invalid-setting.bicep"),
    "output names array=['one','two']\n",
  );
  const invalidSetting = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "invalid-setting.bicep"),
  );
  await vscode.window.showTextDocument(invalidSetting);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(invalidSetting.getText(), "output names array=['one','two']\n");
  await config.update(
    "bicepArrayLayout",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.match(invalidSetting.getText(), /\['one', 'two'\]/);
  await fs.writeFile(
    path.join(folder.uri.fsPath, "ordered.bicep"),
    "output result string='done'\nparam unused string\n",
  );
  const ordered = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "ordered.bicep"),
  );
  await vscode.window.showTextDocument(ordered);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(ordered.getText().startsWith("param unused"));
  await config.update(
    "bicepDeclarationOrder",
    ["output", "param"],
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(ordered.getText().startsWith("output result"));
  await config.update(
    "bicepDeclarationOrder",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(ordered.getText().startsWith("param unused"));
  const alreadyFormatted = await vscode.commands.executeCommand(
    "vscode.executeFormatDocumentProvider",
    ordered.uri,
    { insertSpaces: true, tabSize: 2 },
  );
  assert.ok(
    alreadyFormatted === undefined || alreadyFormatted.length === 0,
    "An already formatted document needs no further edits",
  );
  const schemaDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "config-case", ".prettierrc.json"),
  );
  await vscode.window.showTextDocument(schemaDocument);
  assert.equal(
    vscode.workspace.getConfiguration("json").get("schemaDownload.enable"),
    false,
  );
  const position = schemaDocument.positionAt(
    schemaDocument.getText().indexOf('"spaces"') + 1,
  );
  let completions = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      schemaDocument.uri,
      position,
    );
    completions =
      result?.items.map((item) =>
        typeof item.label === "string" ? item.label : item.label.label,
      ) ?? [];
    if (completions.some((label) => label.includes("tabs"))) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(
    completions.some((label) => label.includes("tabs")),
    "Offline option completion from VSIX schema",
  );
  await config.update(
    "preset",
    "minimal",
    vscode.ConfigurationTarget.Workspace,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "config-case", "minimal.bicep"),
    "output result string = 'done'\nparam unused string\n",
  );
  const projectPreset = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "config-case", "minimal.bicep"),
  );
  await vscode.window.showTextDocument(projectPreset);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(
    projectPreset.getText().startsWith("output result"),
    "Explicit BicepFlex preset overrides project ordering",
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "minimal.bicep"),
    "output result string = 'done'\nparam unused string\n",
  );
  const minimal = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "minimal.bicep"),
  );
  await vscode.window.showTextDocument(minimal);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(
    minimal.getText().startsWith("output result"),
    "Minimal preset retains source declaration order",
  );
  await config.update(
    "bicepSortDeclarations",
    true,
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.ok(
    minimal.getText().startsWith("param unused"),
    "Explicit individual setting overrides the minimal preset even at its default value",
  );
  await config.update(
    "bicepSortDeclarations",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "preset",
    "opinionated",
    vscode.ConfigurationTarget.Workspace,
  );
  await config.update(
    "preset",
    "unsupported",
    vscode.ConfigurationTarget.Workspace,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "invalid-preset.bicep"),
    "output result string='hi'\n",
  );
  const invalidPreset = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "invalid-preset.bicep"),
  );
  await vscode.window.showTextDocument(invalidPreset);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(invalidPreset.getText(), "output result string='hi'\n");
  await config.update(
    "preset",
    "opinionated",
    vscode.ConfigurationTarget.Workspace,
  );
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(invalidPreset.getText(), "output result string = 'hi'\n");
  const editorConfig = vscode.workspace.getConfiguration("editor");
  await editorConfig.update(
    "formatOnSave",
    true,
    vscode.ConfigurationTarget.Workspace,
  );
  await editorConfig.update(
    "formatOnSaveMode",
    "file",
    vscode.ConfigurationTarget.Workspace,
  );
  const saved = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "sample.bicep"),
  );
  const savedEditor = await vscode.window.showTextDocument(saved);
  await savedEditor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        saved.positionAt(0),
        saved.positionAt(saved.getText().length),
      ),
      "output greeting string='changed'\n",
    ),
  );
  assert.equal(await saved.save(), true);
  assert.equal(saved.getText(), "output greeting string = 'changed'\n");
  assert.equal(
    await fs.readFile(path.join(folder.uri.fsPath, "sample.bicep"), "utf8"),
    saved.getText(),
  );
  const savedParams = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "sample.bicepparam"),
  );
  const savedParamsEditor = await vscode.window.showTextDocument(savedParams);
  await savedParamsEditor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        savedParams.positionAt(0),
        savedParams.positionAt(savedParams.getText().length),
      ),
      "using none\r\nparam greeting='changed'\r\n",
    ),
  );
  assert.equal(await savedParams.save(), true);
  assert.equal(
    savedParams.getText(),
    "using none\r\n\r\nparam greeting = 'changed'\r\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(folder.uri.fsPath, "sample.bicepparam"),
      "utf8",
    ),
    savedParams.getText(),
  );
  await editorConfig.update(
    "formatOnSave",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await editorConfig.update(
    "formatOnSaveMode",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "invalid.bicep"),
    "output result string =\n",
  );
  const invalid = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "invalid.bicep"),
  );
  await vscode.window.showTextDocument(invalid);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(invalid.getText(), "output result string =\n");
  await fs.writeFile(
    path.join(folder.uri.fsPath, "invalid.bicepparam"),
    "using none\nparam name =\n",
  );
  const invalidParams = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "invalid.bicepparam"),
  );
  await vscode.window.showTextDocument(invalidParams);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(invalidParams.getText(), "using none\nparam name =\n");
  if (bicepExtension) {
    let found = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      found = vscode.languages
        .getDiagnostics(invalid.uri)
        .some(
          (diagnostic) =>
            diagnostic.severity === vscode.DiagnosticSeverity.Error,
        );
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(found, "The official Bicep server diagnoses the invalid probe");
    for (const file of ["sample.bicep", "sample.bicepparam"]) {
      assert.equal(
        vscode.languages
          .getDiagnostics(vscode.Uri.joinPath(folder.uri, file))
          .filter(
            (diagnostic) =>
              diagnostic.severity === vscode.DiagnosticSeverity.Error,
          ).length,
        0,
        `${file} has no language-server errors after formatting`,
      );
    }
  }
  await fs.mkdir(path.join(folder.uri.fsPath, "unknown-case"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(folder.uri.fsPath, "unknown-case", ".prettierrc.json"),
    JSON.stringify({ bicepUnrecognizedSetting: true }),
  );
  await fs.writeFile(
    path.join(folder.uri.fsPath, "unknown-case", "unknown.bicep"),
    "output result string='hi'\n",
  );
  const unformatted = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "unknown-case", "unknown.bicep"),
  );
  await vscode.window.showTextDocument(unformatted);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(unformatted.getText(), "output result string='hi'\n");
  assert.equal(
    await fs.stat(path.join(folder.uri.fsPath, "node_modules")).then(
      () => true,
      () => false,
    ),
    false,
  );
  await fs.writeFile(
    process.env.BICEPFLEX_HOST_EVIDENCE,
    JSON.stringify({
      success: true,
      extension: extension.id,
      withoutProjectNpm: true,
      userOptions: true,
      projectConfigWithoutPluginInstall: true,
      minimalPreset: true,
      settingsAndPrecedence: true,
      formatOnSave: true,
      invalidSyntaxRefused: true,
      invalidParametersRefused: true,
      invalidSettingsRefused: true,
      unknownOptionsRefused: true,
      offlineSchemaCompletion: true,
      bicepExtensionActive: bicepExtension?.isActive ?? false,
      outcomes,
    }),
  );
}

module.exports = { run };
