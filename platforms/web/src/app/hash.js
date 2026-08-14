import { inflate, deflate } from "pako";
import { serializeDocument, applyDocument } from "struktolab/editor";

/**
 * The URL-hash transport: `#pako:<url-safe base64 of a deflated document>`.
 *
 * The payload is the same envelope a `.struktolab` file holds, plus an `origin`
 * that only makes sense for a shared link.
 */

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
    return applyDocument(editor, JSON.parse(inflated));
  } catch (e) {
    console.error("StruktoLab: failed to load from URL hash", e);
  }
  return false;
}

export function saveToHash(editor) {
  try {
    const state = {
      origin: window.location.origin + window.location.pathname,
      ...serializeDocument(editor),
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
