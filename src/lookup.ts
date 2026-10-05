import * as vscode from 'vscode';
import { TypeInfo, cleanComment, getAllTypeInfo, getTypeInfo, parseModule } from './parser';
import { INDEX } from './indexer';

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
  const text = cleanComment(document.getText());
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

// Find all signals declared in the current file (used for linting/completion).
export function signalsInFile(document: vscode.TextDocument): TypeInfo[] {
  return getAllTypeInfo(cleanComment(document.getText()), true);
}

export function moduleInfo(document: vscode.TextDocument) {
  return parseModule(cleanComment(document.getText()), '\\w+', false, false);
}

// Locate a declaration line for `name` in the given text; returns 0-based line or -1.
export function findDeclarationLine(text: string, name: string): number {
  const lines = text.split(/\r?\n/);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // declaration keyword followed by name
  const declRe = new RegExp(
    '\\b(?:input|output|inout|ref|logic|wire|reg|bit|int|integer|byte|shortint|longint|real|string|' +
      'parameter|localparam|typedef|struct|union|enum|class|module|interface|package|virtual|extern|function|task|' +
      '\\w+)\\b[^;\\n]*\\b' +
      escaped +
      '\\b'
  );
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (new RegExp('\\b' + escaped + '\\b').test(l) && declRe.test(l)) {
      return i;
    }
  }
  // fallback: first occurrence of the name
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('\\b' + escaped + '\\b').test(lines[i])) {
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
  // procedural / continuous assignment (LHS)
  re = new RegExp('(?:^|[^\\w.])(?:' + e + ')\\s*(?:<=|=)[^=]');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return {
        line: i,
        character: lines[i].search(new RegExp('\\b' + e + '\\b')),
        detail: 'assignment',
      };
    }
  }
  // assign statement
  re = new RegExp('\\bassign\\b[^;\\n]*\\b' + e + '\\b\\s*=');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return { line: i, character: lines[i].search(new RegExp('\\b' + e + '\\b')), detail: 'assign' };
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
