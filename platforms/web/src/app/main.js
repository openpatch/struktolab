import "struktolab/editor";
import { loadFromHash, saveToHash } from "./hash.js";

const editor = document.getElementById("editor");

// Wait for custom element to be ready, then load hash
customElements.whenDefined("struktolab-editor").then(() => {
  loadFromHash(editor);
});

editor.addEventListener("change", () => {
  const hash = saveToHash(editor);
  if (hash) history.replaceState(null, "", "#" + hash);
});

document.getElementById("share-btn").addEventListener("click", () => {
  const hash = saveToHash(editor);
  if (!hash) return;
  const url = window.location.origin + window.location.pathname + "#" + hash;
  navigator.clipboard.writeText(url).then(() => {
    const label = document.getElementById("share-label");
    const orig = label.textContent;
    label.textContent = "✓ Copied!";
    setTimeout(() => { label.textContent = orig; }, 2000);
  });
});

window.addEventListener("hashchange", () => {
  loadFromHash(editor);
});
