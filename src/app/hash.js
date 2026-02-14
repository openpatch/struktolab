import { inflate, deflate } from "pako";

export function loadFromHash(editor) {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return false;
  const data = hash.slice(1);
  if (!data.includes(":")) return false;
  const parts = data.split(":");
  const type = parts[0];
  const payload = parts.slice(1).join(":");
  if (type !== "pako") return false;
  try {
    const raw = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const inflated = inflate(bytes, { to: "string" });
    const state = JSON.parse(inflated);
    if (state.model) {
      editor.loadJSON(state.model);
      if (state.settings && state.settings.lang) {
        editor.setAttribute("lang", state.settings.lang === "en" ? "en" : "de");
      }
      if (state.settings && state.settings.fontSize) {
        editor.setAttribute("font-size", state.settings.fontSize);
      }
      if (state.settings && state.settings.colorMode) {
        editor.setAttribute("color-mode", state.settings.colorMode);
      }
      if (state.settings && state.settings.scale) {
        editor.setAttribute("scale", state.settings.scale);
      }
      return true;
    }
  } catch (e) {
    console.error("StruktoLab: failed to load from URL hash", e);
  }
  return false;
}

export function saveToHash(editor) {
  try {
    const state = {
      origin: window.location.origin + window.location.pathname,
      version: 2,
      model: JSON.parse(editor.saveJSON()),
      settings: {
        lang: editor.getAttribute("lang") || "de",
        fontSize: editor.getAttribute("font-size") || "14",
        colorMode: editor.getAttribute("color-mode") || "color",
        scale: editor.getAttribute("scale") || "1",
      },
    };
    const json = JSON.stringify(state);
    const data = new TextEncoder().encode(json);
    const compressed = deflate(data, { level: 9 });
    let binary = "";
    for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
    const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return "pako:" + b64;
  } catch (e) {
    console.error("StruktoLab: failed to serialize state", e);
    return "";
  }
}
