import * as vscode from "vscode";
import { format, resolveConfig, type Options } from "prettier";
import plugin, {
  BicepFormattingError,
  defaultOptions,
  options as bicepOptions,
  presets,
} from "../../../src/index.js";

const languageParsers = {
  bicep: "bicep",
  "bicep-params": "bicepparam",
} as const;
type LanguageId = keyof typeof languageParsers;
const supportedSettings = new Set([
  ...Object.keys(bicepOptions),
  "printWidth",
  "tabWidth",
  "useTabs",
  "endOfLine",
]);

function isLanguageId(value: string): value is LanguageId {
  return value in languageParsers;
}

function isExplicitSetting(
  settings: vscode.WorkspaceConfiguration,
  name: string,
): boolean {
  const inspected = settings.inspect(name);
  return (
    inspected !== undefined &&
    [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
      inspected.globalLanguageValue,
      inspected.workspaceLanguageValue,
      inspected.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("BicepFlex");
  context.subscriptions.push(output);
  const provider: vscode.DocumentFormattingEditProvider = {
    async provideDocumentFormattingEdits(document, _formatOptions, token) {
      if (token.isCancellationRequested) return [];
      if (document.uri.scheme !== "file" || !isLanguageId(document.languageId))
        return [];
      try {
        const text = document.getText();
        const settings = vscode.workspace.getConfiguration("bicepFlex", {
          uri: document.uri,
          languageId: document.languageId,
        });
        const preset = settings.get<"opinionated" | "minimal">(
          "preset",
          "opinionated",
        );
        if (preset !== "opinionated" && preset !== "minimal") {
          throw new Error(
            "bicepFlex.preset must be 'opinionated' or 'minimal'.",
          );
        }
        const individual: Record<string, unknown> = {};
        for (const name of supportedSettings) {
          if (isExplicitSetting(settings, name)) {
            individual[name] = settings.get(name);
          }
        }
        const project = vscode.workspace.isTrusted
          ? await resolveConfig(document.uri.fsPath, { editorconfig: true })
          : null;
        const unknownProjectOption = Object.keys(project ?? {}).find(
          (key) => key.startsWith("bicep") && !(key in bicepOptions),
        );
        if (unknownProjectOption)
          throw new Error(
            `Unknown Bicep Prettier option: ${unknownProjectOption}.`,
          );
        if (token.isCancellationRequested) return [];
        const explicitPreset = isExplicitSetting(settings, "preset");
        const formatted = await format(text, {
          ...defaultOptions,
          ...(!explicitPreset ? presets[preset] : {}),
          ...project,
          ...(explicitPreset ? presets[preset] : {}),
          ...individual,
          plugins: [plugin],
          filepath: document.uri.fsPath,
          parser: languageParsers[document.languageId],
        } as Options);
        if (token.isCancellationRequested || formatted === text) return [];
        return [
          vscode.TextEdit.replace(
            new vscode.Range(
              document.positionAt(0),
              document.positionAt(text.length),
            ),
            formatted,
          ),
        ];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(
          `Could not format ${document.uri.fsPath}: ${message}`,
        );
        if (error instanceof BicepFormattingError && error.loc) {
          output.appendLine(
            `At line ${error.loc.start.line}, column ${error.loc.start.column}.`,
          );
        }
        output.show(true);
        void vscode.window.showErrorMessage(`BicepFlex: ${message}`);
        throw error;
      }
    },
  };
  for (const language of Object.keys(languageParsers) as LanguageId[]) {
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider(
        { language, scheme: "file" },
        provider,
      ),
    );
  }
}

export function deactivate(): void {}
