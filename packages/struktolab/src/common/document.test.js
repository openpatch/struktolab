import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDocument, serializeDocument } from "./document.js";

/** Enough of an editor for the document envelope: attributes and the code getters. */
function fakeEditor(attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    hasAttribute: (name) => attrs.has(name),
    get codeLanguage() {
      const mode = attrs.get("code-mode");
      return mode && mode !== "none" ? mode : "pseudocode";
    },
    get codeHidden() {
      return attrs.has("hide-code") || attrs.get("code-mode") === "none";
    },
    saveJSON: () => "null",
    loadJSON() {},
    codeSnapshot: null,
    attrs,
  };
}

test("a hidden code area is saved with its language", () => {
  const doc = serializeDocument(fakeEditor({ "code-mode": "java", "hide-code": "" }));
  assert.equal(doc.settings.codeMode, "java");
  assert.equal(doc.settings.hideCode, true);
});

test("shown code saves no hideCode", () => {
  const doc = serializeDocument(fakeEditor({ "code-mode": "python" }));
  assert.equal(doc.settings.codeMode, "python");
  assert.equal("hideCode" in doc.settings, false);
});

test("hideCode loads as hide-code, keeping the language", () => {
  const editor = fakeEditor();
  applyDocument(editor, { model: null, settings: { codeMode: "java", hideCode: true } });
  assert.equal(editor.attrs.get("code-mode"), "java");
  assert.equal(editor.attrs.has("hide-code"), true);
});

test("a shown document shows the code of an editor that hid it", () => {
  const editor = fakeEditor({ "hide-code": "" });
  applyDocument(editor, { model: null, settings: { codeMode: "java" } });
  assert.equal(editor.attrs.has("hide-code"), false);
});

test("an older document's codeMode none still hides the code", () => {
  const editor = fakeEditor();
  applyDocument(editor, { model: null, settings: { codeMode: "none" } });
  assert.equal(editor.codeHidden, true);
});
