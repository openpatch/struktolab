import "../editor/index.js";
import { loadFromHash, saveToHash } from "./hash.js";

const editor = document.getElementById("editor");
const codeOutput = document.getElementById("code-output");
const tabBtns = document.querySelectorAll(".code-tabs button");
let currentLang = "python";

function updateCode() {
  try {
    codeOutput.textContent = editor.toCode(currentLang);
  } catch (e) {
    codeOutput.textContent = "";
  }
}

// Wait for custom element to be ready, then load hash
customElements.whenDefined("struktolab-editor").then(() => {
  loadFromHash(editor);
  updateCode();
});

editor.addEventListener("change", () => {
  updateCode();
  const hash = saveToHash(editor);
  if (hash) history.replaceState(null, "", "#" + hash);
});

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentLang = btn.dataset.lang;
    updateCode();
  });
});

document.getElementById("share-btn").addEventListener("click", () => {
  const hash = saveToHash(editor);
  if (!hash) return;
  const url = window.location.origin + window.location.pathname + "#" + hash;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById("share-btn");
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

window.addEventListener("hashchange", () => {
  loadFromHash(editor);
});
