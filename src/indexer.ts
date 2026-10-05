import * as vscode from 'vscode';
import * as path from 'path';
import {
  ClassInfo,
  ModuleInfo,
  TypeInfo,
  cleanComment,
  parseClass,
  parseModule,
  parsePackage,
} from './parser';
import { getConfig } from './config';
import * as logger from './logger';

export type SymbolKind = 'module' | 'interface' | 'package' | 'class' | 'function' | 'task' | 'macro' | 'typedef';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  uri: vscode.Uri;
  line: number;
}

interface FileRecord {
  mtime: number;
  text: string;
  symbols: SymbolEntry[];
}

export class WorkspaceIndex {
  private records = new Map<string, FileRecord>();

  private async stat(uri: vscode.Uri): Promise<number> {
    try {
      const s = await vscode.workspace.fs.stat(uri);
      return s.mtime;
    } catch {
      return -1;
    }
  }

  async readFile(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const mtime = await this.stat(uri);
    const rec = this.records.get(key);
    if (rec && rec.mtime === mtime) {
      return rec.text;
    }
    const data = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(data).toString('utf8');
    logger.debug(`index: read ${uri.fsPath} (${text.length} chars)`);
    this.records.set(key, {
      mtime,
      text,
      symbols: rec ? rec.symbols : [],
    });
    return text;
  }

  invalidate(uri: vscode.Uri): void {
    this.records.delete(uri.toString());
  }

  private scanSymbols(uri: vscode.Uri, text: string): SymbolEntry[] {
    const out: SymbolEntry[] = [];
    const lines = text.split(/\r?\n/);
    const add = (name: string, kind: SymbolKind, line: number) => {
      if (!name) {
        return;
      }
      out.push({ name, kind, uri, line });
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let m = l.match(/^[ \t]*(module|interface)\s+(\w+)/);
      if (m) {
        add(m[2], m[1] as SymbolKind, i);
        continue;
      }
      m = l.match(/^[ \t]*package\s+(\w+)/);
      if (m) {
        add(m[1], 'package', i);
        continue;
      }
      m = l.match(/^[ \t]*class\s+(\w+)/);
      if (m) {
        add(m[1], 'class', i);
        continue;
      }
      m = l.match(/^[ \t]*`define\s+(\w+)/);
      if (m) {
        add(m[1], 'macro', i);
        continue;
      }
      m = l.match(
        /^[ \t]*(?:extern\s+)?(?:virtual\s+|static\s+|automatic\s+|protected\s+|local\s+)*(function|task)\s+(?:.{0,40}?\s+)?(\w+)\s*[\(;]/
      );
      if (m) {
        add(m[2], m[1] as SymbolKind, i);
        continue;
      }
      m = l.match(/^[ \t]*typedef\b[^;=]*?(\w+)\s*;/);
      if (m) {
        add(m[1], 'typedef', i);
      }
    }
    return out;
  }

  async getAllFiles(includeHeaders = true): Promise<vscode.Uri[]> {
    const cfg = getConfig();
    const exts = new Set<string>();
    for (const e of cfg.vExt) {
      exts.add(e);
    }
    for (const e of cfg.svExt) {
      exts.add(e);
    }
    if (includeHeaders) {
      for (const e of cfg.vhExt) {
        exts.add(e);
      }
      for (const e of cfg.svhExt) {
        exts.add(e);
      }
    }
    const all = await vscode.workspace.findFiles('**/*.{v,sv,vh,svh}', '**/{node_modules,.git,out}/**');
    const filtered = all.filter((u) => exts.has(path.extname(u.fsPath).slice(1).toLowerCase()));
    logger.debug(`index: ${filtered.length} file(s) matched (headers=${includeHeaders})`);
    return filtered;
  }

  async getSymbols(uri: vscode.Uri): Promise<SymbolEntry[]> {
    const key = uri.toString();
    const mtime = await this.stat(uri);
    const rec = this.records.get(key);
    if (rec && rec.mtime === mtime && rec.symbols.length) {
      return rec.symbols;
    }
    const text = await this.readFile(uri);
    const symbols = this.scanSymbols(uri, text);
    const r = this.records.get(key);
    if (r) {
      r.symbols = symbols;
    } else {
      this.records.set(key, { mtime, text, symbols });
    }
    return symbols;
  }

  async findSymbols(name: string, kinds?: SymbolKind[]): Promise<SymbolEntry[]> {
    const files = await this.getAllFiles();
    const out: SymbolEntry[] = [];
    for (const uri of files) {
      const syms = await this.getSymbols(uri);
      for (const s of syms) {
        if (s.name === name && (!kinds || kinds.includes(s.kind))) {
          out.push(s);
        }
      }
    }
    // Prefer the current file first
    const active = vscode.window.activeTextEditor?.document.uri.toString();
    if (active) {
      out.sort((a, b) => (b.uri.toString() === active ? 1 : 0) - (a.uri.toString() === active ? 1 : 0));
    }
    logger.debug(`findSymbols "${name}": ${out.length} match(es)`);
    return out;
  }

  async lookupModule(name: string): Promise<{ info: ModuleInfo; uri: vscode.Uri; text: string } | null> {
    const syms = await this.findSymbols(name, ['module', 'interface']);
    for (const s of syms) {
      const text = await this.readFile(s.uri);
      const info = parseModule(cleanComment(text), name, false, true);
      if (info) {
        logger.debug(`lookupModule "${name}" -> ${s.uri.fsPath}`);
        return { info, uri: s.uri, text };
      }
    }
    logger.debug(`lookupModule "${name}": not found`);
    return null;
  }

  async lookupPackage(name: string): Promise<TypeInfo[] | null> {
    const syms = await this.findSymbols(name, ['package']);
    for (const s of syms) {
      const text = await this.readFile(s.uri);
      const members = parsePackage(cleanComment(text), name);
      if (members) {
        return members;
      }
    }
    return null;
  }

  async lookupClass(name: string): Promise<{ info: ClassInfo; uri: vscode.Uri; text: string } | null> {
    const syms = await this.findSymbols(name, ['class']);
    for (const s of syms) {
      const text = await this.readFile(s.uri);
      const info = parseClass(cleanComment(text), name);
      if (info) {
        return { info, uri: s.uri, text };
      }
    }
    return null;
  }

  async listModuleFiles(): Promise<vscode.Uri[]> {
    const files = await this.getAllFiles(false);
    return files;
  }

  moduleNamesInFile(text: string): string[] {
    const names: string[] = [];
    const re = /^[ \t]*module\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      names.push(m[1]);
    }
    return names;
  }
}

export let INDEX: WorkspaceIndex;

export function initIndex(): WorkspaceIndex {
  INDEX = new WorkspaceIndex();
  return INDEX;
}

export function getWordAt(document: vscode.TextDocument, position: vscode.Position): string {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w$]*/);
  if (!range) {
    return '';
  }
  return document.getText(range);
}

export function getModuleInfoForDocument(document: vscode.TextDocument): ModuleInfo | null {
  const text = cleanComment(document.getText());
  return parseModule(text, '\\w+', false, false);
}
