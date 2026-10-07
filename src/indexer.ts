import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  ClassInfo,
  ModuleInfo,
  TypeInfo,
  cleanComment,
  parseClass,
  parseModule,
  parsePackage,
} from './parser';
import { getConfig, SvConfig } from './config';
import { FileListSetting, followIncludes, resolveFileList } from './filelist';
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

export interface FileListValidation {
  file: string;
  base: string;
  listPath: string;
  basePath: string;
  listExists: boolean;
  baseExists: boolean;
  resolved: number;
  supported: number;
  missing: string[];
  sample: string[];
  error?: string;
}

export interface IncludeDirStatus {
  dir: string;
  path: string;
  exists: boolean;
  isDirectory: boolean;
}

export interface IncludeDirsValidation {
  dirs: IncludeDirStatus[];
  unresolved: { include: string; from: string }[];
}

export interface IndexedFileInfo {
  input: string;
  path: string;
  relative: string;
  exists: boolean;
  supported: boolean;
  mode: 'all' | 'fileList';
  indexed: boolean;
  via: string[];
}

function supportedExtensions(cfg: SvConfig, includeHeaders = true): Set<string> {
  const exts = new Set<string>();
  for (const e of cfg.vExt) exts.add(e);
  for (const e of cfg.svExt) exts.add(e);
  if (includeHeaders) {
    for (const e of cfg.vhExt) exts.add(e);
    for (const e of cfg.svhExt) exts.add(e);
  }
  return new Set([...exts].map((e) => e.replace(/^\./, '').toLowerCase()));
}

function resolveWorkspacePath(p: string): string {
  if (path.isAbsolute(p)) {
    return p;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.join(folder.uri.fsPath, p) : path.resolve(p);
}

function readTextSync(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Resolve each configured filelist the same way the index does, reporting missing
// paths so the settings UI can confirm a configuration before saving it.
export function validateFileLists(entries: FileListSetting[]): FileListValidation[] {
  const cfg = getConfig();
  const exts = supportedExtensions(cfg);
  const globalInc = cfg.includeDirs.map((d) => resolveWorkspacePath(d));
  const results: FileListValidation[] = [];
  for (const entry of entries) {
    const listPath = resolveWorkspacePath(entry.file);
    const basePath = resolveWorkspacePath(entry.base);
    const report: FileListValidation = {
      file: entry.file,
      base: entry.base,
      listPath,
      basePath,
      listExists: fs.existsSync(listPath),
      baseExists: fs.existsSync(basePath),
      resolved: 0,
      supported: 0,
      missing: [],
      sample: [],
    };
    if (!report.listExists) {
      report.error = 'filelist not found';
      results.push(report);
      continue;
    }
    let paths: string[];
    try {
      const { files: listed, incdirs } = resolveFileList(listPath, basePath, readTextSync);
      paths = followIncludes(listed, [...incdirs, ...globalInc, basePath], readTextSync);
    } catch (e) {
      report.error = String(e);
      results.push(report);
      continue;
    }
    report.resolved = paths.length;
    for (const p of paths) {
      if (!exts.has(path.extname(p).slice(1).toLowerCase())) {
        continue;
      }
      report.supported++;
      if (fs.existsSync(p)) {
        if (report.sample.length < 5) {
          report.sample.push(vscode.workspace.asRelativePath(vscode.Uri.file(p)));
        }
      } else {
        report.missing.push(vscode.workspace.asRelativePath(vscode.Uri.file(p)));
      }
    }
    results.push(report);
  }
  return results;
}

// Check the configured include directories (exist / is a directory) and, for the
// current filelists, list every `` `include `` directive that no search directory
// could resolve. IO uses the same search order as the index.
export function validateIncludeDirs(
  entries: FileListSetting[],
  includeDirs: string[]
): IncludeDirsValidation {
  const dirs: IncludeDirStatus[] = includeDirs.map((dir) => {
    const p = resolveWorkspacePath(dir);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(p).isDirectory();
    } catch {
      isDirectory = false;
    }
    return { dir, path: p, exists: fs.existsSync(p), isDirectory };
  });

  const globalInc = includeDirs.map((d) => resolveWorkspacePath(d));
  const unresolved: { include: string; from: string }[] = [];
  const seen = new Set<string>();
  for (const entry of entries.filter((l) => l.file && l.base)) {
    const listPath = resolveWorkspacePath(entry.file);
    const baseDir = resolveWorkspacePath(entry.base);
    if (!fs.existsSync(listPath)) {
      continue;
    }
    let listed: string[];
    let incdirs: string[];
    try {
      ({ files: listed, incdirs } = resolveFileList(listPath, baseDir, readTextSync));
    } catch {
      continue;
    }
    followIncludes(listed, [...incdirs, ...globalInc, baseDir], readTextSync, (include, fromFile) => {
      const key = `${fromFile}\0${include}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unresolved.push({
        include,
        from: vscode.workspace.asRelativePath(vscode.Uri.file(fromFile)),
      });
    });
  }
  return { dirs, unresolved };
}

// Workspace-wide symbol index. The symbol table (`byName`) is built once in the
// background and kept resident, so navigation lookups are O(1) map reads instead
// of re-globbing and re-stat'ing every file on each command. File texts are
// cached by mtime and refreshed on save or on filesystem changes.
export class WorkspaceIndex {
  private records = new Map<string, FileRecord>();
  private byName = new Map<string, SymbolEntry[]>();
  private allFiles: vscode.Uri[] = [];
  private ready: Promise<void> | null = null;
  // When fileLists are configured the index is limited to the resolved set.
  private restricted = false;
  private scope = new Set<string>();
  private scopeVia = new Map<string, Set<string>>();

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

  // Drop the cached file text. Symbols stay valid (they describe the on-disk
  // content) and the text is re-read on demand.
  invalidate(uri: vscode.Uri): void {
    this.records.delete(uri.toString());
  }

  // Remove every symbol entry that points at `uri`.
  private dropSymbols(uri: vscode.Uri): void {
    const key = uri.toString();
    for (const [name, entries] of this.byName) {
      const kept = entries.filter((e) => e.uri.toString() !== key);
      if (kept.length) {
        this.byName.set(name, kept);
      } else {
        this.byName.delete(name);
      }
    }
  }

  private addSymbols(symbols: SymbolEntry[]): void {
    for (const s of symbols) {
      const list = this.byName.get(s.name);
      if (list) {
        list.push(s);
      } else {
        this.byName.set(s.name, [s]);
      }
    }
  }

  // Re-scan a single file's symbols and update the table.
  private indexText(uri: vscode.Uri, text: string): SymbolEntry[] {
    this.dropSymbols(uri);
    const symbols = this.scanSymbols(uri, text);
    this.addSymbols(symbols);
    return symbols;
  }

  private globFiles(): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles('**/*.{v,sv,vh,svh}', '**/{node_modules,.git,out}/**');
  }

  // Resolve the file set to index from the configured filelists. With no usable
  // entry (missing list or missing base) every supported file is indexed.
  // `scope` keeps every listed path (even one that does not exist yet) so a file
  // created later is picked up by the watcher; `files` only holds existing ones.
  private async collectIndexFiles(): Promise<{
    files: vscode.Uri[];
    scope: string[];
    via: Map<string, Set<string>>;
    restricted: boolean;
  }> {
    const cfg = getConfig();
    const entries = cfg.fileLists.filter((l) => l.file && l.base);
    const via = new Map<string, Set<string>>();
    if (!entries.length) {
      const files = await this.globFiles();
      return { files, scope: files.map((f) => f.toString()), via, restricted: false };
    }
    const exts = supportedExtensions(cfg);
    const globalInc = cfg.includeDirs.map((d) => resolveWorkspacePath(d));
    const existing = new Map<string, vscode.Uri>();
    const scope = new Set<string>();
    for (const entry of entries) {
      const listPath = resolveWorkspacePath(entry.file);
      const baseDir = resolveWorkspacePath(entry.base);
      let paths: string[];
      try {
        const { files: listed, incdirs } = resolveFileList(listPath, baseDir, readTextSync);
        paths = followIncludes(listed, [...incdirs, ...globalInc, baseDir], readTextSync);
      } catch (e) {
        logger.warn(`fileList ${entry.file}: ${e}`);
        continue;
      }
      for (const p of paths) {
        if (!exts.has(path.extname(p).slice(1).toLowerCase())) {
          continue;
        }
        const uri = vscode.Uri.file(p);
        const key = uri.toString();
        scope.add(key);
        let sources = via.get(key);
        if (!sources) {
          sources = new Set<string>();
          via.set(key, sources);
        }
        sources.add(entry.file);
        if (fs.existsSync(p)) {
          existing.set(key, uri);
        }
      }
      logger.debug(`fileList ${entry.file}: ${paths.length} path(s)`);
    }
    return { files: [...existing.values()], scope: [...scope], via, restricted: true };
  }

  // Build the index on first use; subsequent calls resolve immediately.
  async ensureIndex(): Promise<void> {
    if (!this.ready) {
      this.ready = this.buildIndex();
    }
    return this.ready;
  }

  // Kick off indexing without blocking the caller (used at activation).
  start(): void {
    void this.ensureIndex().catch((e) => logger.warn(`index build failed: ${e}`));
  }

  // Drop everything and rebuild (e.g. workspace folders changed).
  rebuild(): Promise<void> {
    this.records.clear();
    this.byName.clear();
    this.allFiles = [];
    this.ready = this.buildIndex();
    return this.ready;
  }

  private async buildIndex(): Promise<void> {
    const t0 = Date.now();
    const { files, scope, via, restricted } = await this.collectIndexFiles();
    this.restricted = restricted;
    this.scope = new Set(scope);
    this.scopeVia = via;
    this.allFiles = files;
    this.byName.clear();
    this.records.clear();
    for (const uri of files) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(data).toString('utf8');
        const mtime = await this.stat(uri);
        const symbols = this.scanSymbols(uri, text);
        this.addSymbols(symbols);
        this.records.set(uri.toString(), { mtime, text, symbols });
      } catch {
        // File may have been removed while scanning; skip it.
      }
    }
    logger.info(
      `index built: ${files.length} file(s) in ${Date.now() - t0} ms${restricted ? ' (fileList)' : ''}`
    );
  }

  // Re-read a single file from disk and update its symbols.
  async refresh(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    if (this.restricted && !this.scope.has(key)) {
      return;
    }
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(data).toString('utf8');
      const mtime = await this.stat(uri);
      const symbols = this.indexText(uri, text);
      this.records.set(key, { mtime, text, symbols });
      if (!this.allFiles.some((u) => u.toString() === key)) {
        this.allFiles.push(uri);
      }
    } catch {
      this.remove(uri);
    }
  }

  remove(uri: vscode.Uri): void {
    const key = uri.toString();
    this.records.delete(key);
    this.dropSymbols(uri);
    this.allFiles = this.allFiles.filter((u) => u.toString() !== key);
  }

  // Report whether a path is part of the current index and, when filelists are
  // in use, which filelist entries pull it in.
  async inspectFile(input: string): Promise<IndexedFileInfo> {
    await this.ensureIndex();
    const abs = resolveWorkspacePath(input.trim());
    const uri = vscode.Uri.file(abs);
    const key = uri.toString();
    const exts = supportedExtensions(getConfig());
    const supported = exts.has(path.extname(abs).slice(1).toLowerCase());
    const indexed = this.restricted
      ? this.scope.has(key)
      : this.allFiles.some((u) => u.toString() === key);
    return {
      input,
      path: abs,
      relative: vscode.workspace.asRelativePath(uri),
      exists: fs.existsSync(abs),
      supported,
      mode: this.restricted ? 'fileList' : 'all',
      indexed,
      via: [...(this.scopeVia.get(key) ?? [])],
    };
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
      let m = l.match(/^[ \t]*(module|interface)\s+(?!class\b)(\w+)/);
      if (m) {
        add(m[2], m[1] as SymbolKind, i);
        continue;
      }
      m = l.match(/^[ \t]*package\s+(\w+)/);
      if (m) {
        add(m[1], 'package', i);
        continue;
      }
      m = l.match(
        /^[ \t]*(?:virtual\s+|local\s+|protected\s+|static\s+|pure\s+|interface\s+)*class\s+(\w+)/
      );
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
    await this.ensureIndex();
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
    const filtered = this.allFiles.filter((u) => exts.has(path.extname(u.fsPath).slice(1).toLowerCase()));
    logger.debug(`index: ${filtered.length} file(s) matched (headers=${includeHeaders})`);
    return filtered;
  }

  async getSymbols(uri: vscode.Uri): Promise<SymbolEntry[]> {
    await this.ensureIndex();
    const key = uri.toString();
    const rec = this.records.get(key);
    if (rec) {
      return rec.symbols;
    }
    const text = await this.readFile(uri);
    const symbols = this.indexText(uri, text);
    const mtime = await this.stat(uri);
    this.records.set(key, { mtime, text, symbols });
    return symbols;
  }

  async findSymbols(name: string, kinds?: SymbolKind[]): Promise<SymbolEntry[]> {
    await this.ensureIndex();
    const entries = this.byName.get(name);
    if (!entries || !entries.length) {
      logger.debug(`findSymbols "${name}": 0 match(es)`);
      return [];
    }
    const out = kinds ? entries.filter((e) => kinds.includes(e.kind)) : entries.slice();
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

  // Walk the `extends` chain of a class, returning [derived, base, ...]. Cross-file
  // and cycle-safe. Each entry carries the file that declares it so callers can
  // link back to the class body.
  async classHierarchy(name: string): Promise<{ info: ClassInfo; uri: vscode.Uri }[]> {
    const out: { info: ClassInfo; uri: vscode.Uri }[] = [];
    const seen = new Set<string>();
    let current: string | null = name;
    while (current && !seen.has(current)) {
      seen.add(current);
      const found = await this.lookupClass(current);
      if (!found) {
        break;
      }
      out.push({ info: found.info, uri: found.uri });
      const base = found.info.extend;
      current = base ? base.split(/\s+/)[0].split('#')[0] : null;
    }
    return out;
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
