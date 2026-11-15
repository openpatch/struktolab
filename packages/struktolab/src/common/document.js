/**
 * The StruktoLab document envelope.
 *
 * A structogram on its own is just the model tree, but a saved document also has
 * to remember how it was being looked at — language, font size, colour mode and
 * scale. That envelope is what a `.struktolab` file contains, and what the web
 * app packs into the URL hash.
 *
 *   { version: 2, model: <tree | null>, settings: { lang, fontSize, colorMode, scale, codeMode },
 *     code?: { lang, text } }
 *
 * `code` is the student's own code when the structogram was written in Java,
 * Python or JavaScript, so it comes back as they wrote it — class, comments
 * and all — rather than as generated code.
 */

export const DOCUMENT_VERSION = 2;

const DEFAULT_SETTINGS = {
  lang: "de",
  fontSize: "14",
  colorMode: "color",
  scale: "1",
  codeMode: "pseudocode",
};

/** Read the current state of an editor element as a document envelope. */
export function serializeDocument(editor) {
  const code = editor.codeSnapshot;
  return {
    version: DOCUMENT_VERSION,
    model: JSON.parse(editor.saveJSON()),
    settings: {
      lang: editor.getAttribute("lang") || DEFAULT_SETTINGS.lang,
      fontSize: editor.getAttribute("font-size") || DEFAULT_SETTINGS.fontSize,
      colorMode: editor.getAttribute("color-mode") || DEFAULT_SETTINGS.colorMode,
      scale: editor.getAttribute("scale") || DEFAULT_SETTINGS.scale,
      codeMode: editor.getAttribute("code-mode") || DEFAULT_SETTINGS.codeMode,
    },
    ...(code ? { code } : {}),
  };
}

/**
 * Push a document envelope into an editor element.
 *
 * Also accepts a bare model tree, which is what StruktoLab downloaded as
 * `structogram.json` before the envelope existed.
 *
 * @returns {boolean} whether a model was loaded
 */
export function applyDocument(editor, doc) {
  if (!doc || typeof doc !== "object") return false;

  const isEnvelope = "model" in doc || "settings" in doc;
  const model = isEnvelope ? doc.model : doc;
  const settings = (isEnvelope && doc.settings) || {};

  if (settings.lang) editor.setAttribute("lang", settings.lang === "en" ? "en" : "de");
  if (settings.fontSize) editor.setAttribute("font-size", settings.fontSize);
  if (settings.colorMode) editor.setAttribute("color-mode", settings.colorMode);
  if (settings.scale) editor.setAttribute("scale", settings.scale);
  if (settings.codeMode) {
    // The editor falls back to pseudocode for a mode it does not know.
    editor.setAttribute("code-mode", settings.codeMode);
  }

  // An empty structogram serializes to `null` — there is nothing to load, and
  // the editor's own empty root is exactly the right thing to leave in place.
  if (!model) {
    editor.restoreCode?.(doc.code);
    return false;
  }

  editor.loadJSON(model);
  editor.restoreCode?.(doc.code);
  return true;
}

/** The envelope for a brand new, empty structogram. */
export function emptyDocument() {
  return {
    version: DOCUMENT_VERSION,
    model: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}
