import * as vscode from "vscode";
import { generateCode } from "struktolab/core";

import { StruktogramEditorProvider } from "./StruktogramEditorProvider";

/** The languages a structogram can be turned into, and how VS Code names them. */
const LANGUAGES = [
  { label: "Python", generator: "python", languageId: "python", extension: "py" },
  { label: "Java", generator: "java", languageId: "java", extension: "java" },
  {
    label: "JavaScript",
    generator: "javascript",
    languageId: "javascript",
    extension: "js",
  },
] as const;

type Language = (typeof LANGUAGES)[number];

/**
 * What a brand new structogram contains: the envelope with no model yet, which
 * the editor opens as a single empty slot to build from.
 */
const emptyDocument = {
  version: 2,
  model: null,
  settings: { lang: "de", fontSize: "14", colorMode: "color", scale: "1" },
};

/**
 * The `.struktolab` file the user is looking at.
 *
 * With a custom editor in front, there is no active *text* editor, so the tab
 * is what has to be asked. Falling back to the text editor covers the case of
 * a structogram opened as source.
 */
const activeStructogramUri = (): vscode.Uri | undefined => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const fromTab =
    input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText
      ? input.uri
      : undefined;
  const uri = fromTab ?? vscode.window.activeTextEditor?.document.uri;
  return uri?.path.endsWith(".struktolab") ? uri : undefined;
};

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      StruktogramEditorProvider.viewType,
      new StruktogramEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("struktolab.new", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage(
          "Open a folder or workspace before creating a structogram.",
        );
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: "Name for the new structogram",
        placeHolder: "bubble-sort",
        validateInput: (value) => {
          if (!value) return "A name is required";
          if (!/^[a-zA-Z0-9 _-]+$/.test(value)) {
            return "Use letters, numbers, spaces, hyphens and underscores";
          }
          return null;
        },
      });
      if (!name) return;

      const uri = vscode.Uri.joinPath(folder.uri, `${name}.struktolab`);
      try {
        await vscode.workspace.fs.stat(uri);
        vscode.window.showErrorMessage(`${name}.struktolab already exists.`);
        return;
      } catch {
        // Does not exist yet, which is what we want.
      }

      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(`${JSON.stringify(emptyDocument, null, 2)}\n`, "utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        StruktogramEditorProvider.viewType,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("struktolab.showSource", async () => {
      const uri = activeStructogramUri();
      if (!uri) {
        vscode.window.showErrorMessage("No .struktolab file is open.");
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", uri, "default");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("struktolab.showDiagram", async () => {
      const uri = activeStructogramUri();
      if (!uri) {
        vscode.window.showErrorMessage("No .struktolab file is open.");
        return;
      }
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        StruktogramEditorProvider.viewType,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("struktolab.showCode", async () => {
      const language = await pickLanguage();
      if (!language) return;
      const result = await generateForActiveDocument(language);
      if (!result) return;

      // An untitled document rather than a file: the code is a view of the
      // structogram, and saving it is the user's decision, not ours.
      const doc = await vscode.workspace.openTextDocument({
        content: result.code,
        language: language.languageId,
      });
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("struktolab.copyCode", async () => {
      const language = await pickLanguage();
      if (!language) return;
      const result = await generateForActiveDocument(language);
      if (!result) return;

      await vscode.env.clipboard.writeText(result.code);
      vscode.window.showInformationMessage(`Copied the ${language.label} code.`);
    }),
  );
}

/**
 * Read the model out of the `.struktolab` the user is looking at and generate
 * code from it.
 *
 * The generator is pure data-in, data-out, so this runs in the extension host
 * without asking the webview for anything — it works even on a structogram
 * opened as source.
 */
async function generateForActiveDocument(
  language: Language,
): Promise<{ code: string; uri: vscode.Uri } | undefined> {
  const uri = activeStructogramUri();
  if (!uri) {
    vscode.window.showErrorMessage("No .struktolab file is open.");
    return undefined;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  let model: unknown;
  try {
    const parsed = JSON.parse(document.getText() || "{}");
    model = parsed && typeof parsed === "object" && "model" in parsed ? parsed.model : parsed;
  } catch {
    vscode.window.showErrorMessage("This structogram is not valid JSON.");
    return undefined;
  }

  if (!model) {
    vscode.window.showInformationMessage("This structogram is empty.");
    return undefined;
  }

  return { code: generateCode(model, language.generator), uri };
}

async function pickLanguage(): Promise<Language | undefined> {
  const picked = await vscode.window.showQuickPick(
    LANGUAGES.map((l) => l.label),
    { placeHolder: "Generate which language?" },
  );
  return LANGUAGES.find((l) => l.label === picked);
}

export function deactivate() {}
