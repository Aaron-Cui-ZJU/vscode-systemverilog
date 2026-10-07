import * as vscode from 'vscode';
import {
  ModuleInfo,
  TypeInfo,
  cleanComment,
  getAllTypeInfo,
  parseModule,
} from './parser';

// Per-document memoization keyed by `TextDocument.version`. Editing the document
// bumps the version, which drops the entry; repeated hover/completion requests on
// an unchanged document reuse the same cleaned text and parse results instead of
// re-running the (expensive) regular expressions on every keystroke.
interface DocEntry {
  version: number;
  text: string;
  cleaned?: string;
  types: Map<string, TypeInfo[]>;
  modules: Map<string, ModuleInfo | null>;
}

const cache = new WeakMap<vscode.TextDocument, DocEntry>();

function entryFor(document: vscode.TextDocument): DocEntry {
  let e = cache.get(document);
  if (!e || e.version !== document.version) {
    e = {
      version: document.version,
      text: document.getText(),
      types: new Map(),
      modules: new Map(),
    };
    cache.set(document, e);
  }
  return e;
}

function cleanedOf(e: DocEntry): string {
  if (e.cleaned === undefined) {
    e.cleaned = cleanComment(e.text);
  }
  return e.cleaned;
}

export function cleanDocument(document: vscode.TextDocument): string {
  return cleanedOf(entryFor(document));
}

export function documentAllTypeInfo(document: vscode.TextDocument, noInst = false): TypeInfo[] {
  const e = entryFor(document);
  const key = noInst ? 'noinst' : 'inst';
  let value = e.types.get(key);
  if (!value) {
    value = getAllTypeInfo(cleanedOf(e), noInst);
    e.types.set(key, value);
  }
  return value;
}

export function documentModuleInfo(
  document: vscode.TextDocument,
  instOnly = false,
  noInst = false
): ModuleInfo | null {
  const e = entryFor(document);
  const key = (instOnly ? 'i' : '-') + (noInst ? 'n' : '-');
  if (!e.modules.has(key)) {
    e.modules.set(key, parseModule(cleanedOf(e), '\\w+', instOnly, noInst));
  }
  return e.modules.get(key)!;
}
