import { serializeDocument, applyDocument, emptyDocument } from "struktolab/editor";
import "./webview.css";

interface VSCodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
}

declare function acquireVsCodeApi(): VSCodeApi;
const vscode = acquireVsCodeApi();

type HostMessage = { type: "update"; content: string } | { type: "flush" };

/** Long enough that a drag is one edit, short enough to feel immediate. */
const EDIT_DEBOUNCE = 250;

const root = document.getElementById("root")!;

const editor = document.createElement("struktolab-editor") as HTMLElement & {
  saveJSON(): string;
  loadJSON(json: string | object): void;
};
// The document is the file; the toolbar must not also try to be one.
editor.setAttribute("embedded", "");
root.appendChild(editor);

/**
 * Set while a document from the host is being pushed into the editor.
 *
 * `loadJSON` fires "change" like any other edit, and without this the update we
 * just applied would go straight back to the host as an edit of our own.
 */
let applying = false;

let timer: ReturnType<typeof setTimeout> | null = null;

const send = (type: "edit" | "flushed") => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  vscode.postMessage({ type, content: serializeDocument(editor) });
};

editor.addEventListener("change", () => {
  if (applying) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => send("edit"), EDIT_DEBOUNCE);
});

editor.addEventListener("export-image", (event) => {
  const { format, blob } = (event as CustomEvent<{ format: string; blob: Blob }>).detail;
  const reader = new FileReader();
  reader.onload = () => {
    // A data: URL, of which only the payload after the comma is the image.
    const base64 = String(reader.result).split(",", 2)[1];
    vscode.postMessage({ type: "exportImage", format, data: base64 });
  };
  reader.readAsDataURL(blob);
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "update") {
    // The document changed under us — someone edited the source, or undid
    // something there. Whatever is in the file wins.
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    applying = true;
    try {
      applyDocument(editor, parseDocument(message.content));
    } finally {
      applying = false;
    }
  } else if (message.type === "flush") {
    // A save is waiting on the keystroke the debounce is still holding.
    send("flushed");
  }
});

/** An unparseable file is left to the source editor rather than overwritten. */
function parseDocument(text: string): unknown {
  if (!text.trim()) return emptyDocument();
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("struktolab: the document is not valid JSON", error);
    return emptyDocument();
  }
}

vscode.postMessage({ type: "ready" });
