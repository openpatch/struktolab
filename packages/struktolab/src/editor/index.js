import StruktolabEditor, { renderStructogramSVG, parsePseudocode, generateCode, treeToPseudocode, KEYWORDS_DE, KEYWORDS_EN } from "./struktolab-editor.js";
import { stripInsertNodes } from "../common/tree-ops.js";
import { DOCUMENT_VERSION, serializeDocument, applyDocument, emptyDocument } from "../common/document.js";

if (!customElements.get("struktolab-editor")) {
  customElements.define("struktolab-editor", StruktolabEditor);
}

export { StruktolabEditor, renderStructogramSVG, parsePseudocode, generateCode, treeToPseudocode, stripInsertNodes, KEYWORDS_DE, KEYWORDS_EN, DOCUMENT_VERSION, serializeDocument, applyDocument, emptyDocument };
