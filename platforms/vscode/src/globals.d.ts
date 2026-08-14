declare module "*.css";

/** The library is plain JavaScript, so it ships no types of its own. */
declare module "struktolab/editor" {
  export function serializeDocument(editor: Element): unknown;
  export function applyDocument(editor: Element, doc: unknown): boolean;
  export function emptyDocument(): unknown;
}

declare module "struktolab/core" {
  export function generateCode(tree: unknown, lang: string): string;
  export function emptyDocument(): unknown;
}
