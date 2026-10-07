import * as vscode from 'vscode';
import {
  ClassInfo,
  FuncInfo,
  TypeInfo,
  enclosingClassScope,
  getTypeInfo,
} from './parser';
import { INDEX } from './indexer';
import { cleanDocument, documentAllTypeInfo, documentModuleInfo } from './documentCache';

const NOT_FOUND: TypeInfo = {
  decl: null,
  type: null,
  array: '',
  bw: '',
  name: '',
  tag: '',
  value: null,
};

// Retrieve type info for a variable, falling back to imported packages.
export async function typeInfo(document: vscode.TextDocument, name: string): Promise<TypeInfo> {
  const text = cleanDocument(document);
  let ti = getTypeInfo(text, name);
  if (ti && ti.type) {
    return ti;
  }
  const impRe = /\bimport\s+(.+?);/gm;
  let m: RegExpExecArray | null;
  while ((m = impRe.exec(text)) !== null) {
    const pkgRe = /\b(\w+)(?:::\s*(?:[\w*]+))+/g;
    let pm: RegExpExecArray | null;
    while ((pm = pkgRe.exec(m[1])) !== null) {
      const members = await INDEX.lookupPackage(pm[1]);
      if (members) {
        for (const x of members) {
          if (x.name === name && x.decl) {
            return x;
          }
        }
      }
    }
  }
  return ti || { ...NOT_FOUND, name };
}

export interface MemberDeclaration {
  member: TypeInfo;
  isFunction: boolean;
  owner: ClassInfo;
  ownerUri: vscode.Uri;
  line: number;
}

// 0-based line of a member declaration/definition inside `text`. For a function,
// the out-of-body definition (`Class::name(`) is preferred so the jump lands on
// the body; otherwise the declaration line is used.
function findMemberLine(
  text: string,
  className: string,
  name: string,
  isFunction: boolean,
  decl: string
): number {
  const lines = text.split(/\r?\n/);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cEsc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (isFunction) {
    const def = new RegExp('\\b' + cEsc + '\\s*::\\s*' + esc + '\\s*\\(');
    for (let i = 0; i < lines.length; i++) {
      if (def.test(lines[i])) {
        return i;
      }
    }
  }
  if (decl) {
    const parts = decl
      .trim()
      .split(/\s+/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    const re = new RegExp(parts);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        return i;
      }
    }
  }
  const word = new RegExp('\\b' + esc + '\\b');
  for (let i = 0; i < lines.length; i++) {
    if (word.test(lines[i])) {
      return i;
    }
  }
  return 0;
}

// Present a function/task declaration as a TypeInfo for hover rendering.
function funcToTypeInfo(f: FuncInfo): TypeInfo {
  return {
    name: f.name,
    type: f.return || f.type,
    decl: f.decl,
    array: '',
    bw: '',
    tag: f.type,
    value: null,
    port: (f.port || []).map((p) => ({ name: p.name, type: p.decl || p.type || '' })),
  };
}

// Resolve `name` as a class member (variable, function or task), following the
// `extends` chain so declarations inherited from a base class (possibly in another
// file) are found. Handles a qualified access `obj.member`, an unqualified member
// used inside a class body, and out-of-body method definitions (`Class::method`).
// Returns the declaration together with the class that owns it.
export async function memberDeclaration(
  document: vscode.TextDocument,
  position: vscode.Position,
  name: string
): Promise<MemberDeclaration | null> {
  const text = document.getText();
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w$]*/);
  const wordStart = range ? document.offsetAt(range.start) : document.offsetAt(position);
  const before = text.slice(0, wordStart);
  const dotMatch = before.match(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\s*$/);
  let className: string | null = null;
  if (dotMatch) {
    if (dotMatch[1] === 'this' || dotMatch[1] === 'super') {
      className = enclosingClassScope(text, wordStart);
    } else {
      const obj = await typeInfo(document, dotMatch[1]);
      if (obj && obj.type) {
        const t = obj.type.split(/\s+/)[0];
        if (await INDEX.lookupClass(t)) {
          className = t;
        }
      }
    }
  }
  if (!className) {
    className = enclosingClassScope(text, wordStart);
  }
  if (!className) {
    return null;
  }
  const chain = await INDEX.classHierarchy(className);
  for (const { info, uri } of chain) {
    const member = info.member.find((x) => x.name === name);
    if (member) {
      const ownerText = await INDEX.readFile(uri);
      const line = findMemberLine(ownerText, info.name, name, false, member.decl || '');
      return { member, isFunction: false, owner: info, ownerUri: uri, line };
    }
    const fn = info.function.find((f) => f.name === name);
    if (fn) {
      const ownerText = await INDEX.readFile(uri);
      const line = findMemberLine(ownerText, info.name, name, true, fn.decl || '');
      return { member: funcToTypeInfo(fn), isFunction: true, owner: info, ownerUri: uri, line };
    }
  }
  return null;
}

// Find all signals declared in the current file (used for linting/completion).
export function signalsInFile(document: vscode.TextDocument): TypeInfo[] {
  return documentAllTypeInfo(document, true);
}

export function moduleInfo(document: vscode.TextDocument) {
  return documentModuleInfo(document);
}

// Keywords that introduce a declaration. Used by findDeclarationLine to tell a
// declaration apart from a plain use of the name.
const DECL_KEYWORDS =
  'input|output|inout|ref|logic|wire|reg|bit|int|integer|byte|shortint|longint|real|realtime|shortreal|' +
  'time|string|var|parameter|localparam|typedef|struct|union|enum|class|module|interface|package|program|' +
  'function|task|genvar|chandle|event';

// Locate a declaration line for `name` in the given text; returns 0-based line or -1.
// With `strongOnly`, only a genuine declaration is accepted (an instantiation or a
// call such as `foo name(` is rejected) and the first-occurrence fallback is skipped.
export function findDeclarationLine(text: string, name: string, strongOnly = false): number {
  const lines = text.split(/\r?\n/);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp('\\b' + escaped + '\\b');
  // declaration keyword (before the name, on the same statement)
  const keywordRe = new RegExp('\\b(?:' + DECL_KEYWORDS + ')\\b[^;\\n]*\\b' + escaped + '\\b');
  // user-defined type followed by the name and a declarator endpoint: `my_type name;`
  const userTypeRe = new RegExp(
    '^[ \\t]*[A-Za-z_]\\w*(?:::\\w+)?[ \\t]*(?:#\\s*\\([^;]*\\))?[ \\t]+\\*?[ \\t]*' +
      escaped +
      '\\b[ \\t]*(?:\\[|;|,|\\)|=|$)'
  );
  // `name (` looks like an instantiation or a function call.
  const callLikeRe = new RegExp('\\b' + escaped + '\\b\\s*\\(');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!wordRe.test(l)) {
      continue;
    }
    const byKeyword = keywordRe.test(l);
    if (byKeyword) {
      return i;
    }
    if (!callLikeRe.test(l) && userTypeRe.test(l)) {
      return i;
    }
  }
  if (strongOnly) {
    return -1;
  }
  // fallback: first occurrence of the name
  for (let i = 0; i < lines.length; i++) {
    if (wordRe.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

export interface DriverResult {
  line: number;
  character: number;
  detail: string;
}

// 0-based line/character of an absolute offset in `text`.
function offsetToLineChar(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

// True when `name` at `start` is written by an assignment (an lvalue). Handles a
// plain target (`sig`, `sig[3:0]`, `mem[i]`) and an element of a concatenation
// target (`{a, b, sig} = ...`), including one split across several lines.
function isAssignmentTarget(text: string, start: number, length: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  if (before && /[\w.]/.test(before)) {
    return false;
  }
  const tail = text.slice(start + length);
  // plain target: optional bit/part selects, then `=` or `<=` (but not `==`).
  if (/^\s*(?:\[[^\]]*\]\s*)*(?:<=|=)(?!=)/.test(tail)) {
    return true;
  }
  // concatenation element: some closing `}` before the statement end is followed
  // by `=`/`<=`, and the name sits after an unmatched `{` in the statement.
  const semi = tail.indexOf(';');
  const between = semi >= 0 ? tail.slice(0, semi) : tail;
  let close = -1;
  let closesTarget = false;
  while ((close = between.indexOf('}', close + 1)) >= 0) {
    if (/^\s*(?:<=|=)(?!=)/.test(between.slice(close + 1))) {
      closesTarget = true;
      break;
    }
  }
  if (!closesTarget) {
    return false;
  }
  const stmtStart = text.lastIndexOf(';', start) + 1;
  const head = text.slice(stmtStart, start);
  return head.lastIndexOf('{') > head.lastIndexOf('}');
}

// Heuristic driver search for a signal inside the given text.
export function findDriver(text: string, name: string): DriverResult | null {
  const lines = text.split(/\r?\n/);
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // output port declaration
  let re = new RegExp('^[ \\t]*output\\b[^;\\n]*\\b' + e + '\\b');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return { line: i, character: lines[i].search(new RegExp('\\b' + e + '\\b')), detail: 'output port' };
    }
  }
  // assignment target (procedural or continuous), including a signal inside a
  // concatenation lvalue such as `{a, b, sig} = expr;`.
  const nameRe = new RegExp('\\b' + e + '\\b', 'g');
  let occ: RegExpExecArray | null;
  while ((occ = nameRe.exec(text)) !== null) {
    if (isAssignmentTarget(text, occ.index, name.length)) {
      const pos = offsetToLineChar(text, occ.index);
      return { line: pos.line, character: pos.character, detail: 'assignment' };
    }
  }
  // connection to an output of a submodule: .name(...) is the port; the driver is
  // the port on the submodule side. Report the port binding line.
  re = new RegExp('\\.\\s*\\w+\\s*\\(\\s*' + e + '\\s*\\)');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return { line: i, character: lines[i].indexOf(e), detail: 'submodule output' };
    }
  }
  return null;
}
