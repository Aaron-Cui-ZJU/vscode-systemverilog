import * as vscode from 'vscode';
import { VerilogBeautifier } from './beautifier';
import {
  CompletionEntry,
  DEFAULT_SYSTEMTASK,
  DEFAULT_TICK,
  DEFAULT_UVM,
  getConfig,
  mergeCompletion,
} from './config';
import { INDEX } from './indexer';
import { serverProvidesCompletion } from './languageServer';
import { cleanDocument, documentAllTypeInfo } from './documentCache';
import {
  FuncInfo,
  TypeInfo,
  cleanComment,
  fillCase,
  getAllTypeInfo,
  getEnumValues,
  getTypeInfo,
  reDecl,
} from './parser';
import { typeInfo } from './lookup';
import * as logger from './logger';

function mostCommon(list: string[]): string {
  const counts = new Map<string, number>();
  for (const x of list) {
    counts.set(x, (counts.get(x) || 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, v] of counts) {
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return best;
}

let alwaysCacheKey = '';
let alwaysCache: [string, string, string] | null = null;

export function getAlwaysTemplate(document: vscode.TextDocument): [string, string, string] {
  const cfg = getConfig();
  const cacheKey =
    document.uri.toString() +
    '@' +
    document.version +
    '|' +
    [
      cfg.clkName,
      cfg.rstName,
      cfg.rstNName,
      cfg.clkEnName,
      cfg.alwaysNameAuto,
      cfg.alwaysCeAuto,
      cfg.alwaysFfBeginEnd,
      cfg.alwaysLabel,
      cfg.alwaysOneCursor,
      cfg.indentStyle,
    ].join('\u0001');
  if (alwaysCache && alwaysCacheKey === cacheKey) {
    return alwaysCache;
  }
  let clkName = cfg.clkName;
  let rstName = cfg.rstName;
  let rstNName = cfg.rstNName;
  let clkEnName = cfg.clkEnName;
  const raw = cleanDocument(document);
  if (cfg.alwaysNameAuto) {
    const pl = Array.from(raw.matchAll(/posedge\s+(\w+)/g)).map((m) => m[1]);
    if (pl.length) {
      const plC = pl.filter((x) => x.toLowerCase().includes('c'));
      if (!pl.includes(clkName) && plC.length) {
        clkName = mostCommon(plC);
      }
      if (!pl.includes(rstName)) {
        const plR = pl.filter((x) => !plC.includes(x));
        if (plR.length) {
          rstName = mostCommon(plR);
        }
      }
    } else {
      const sig = raw.match(/(?:input|output|var|logic|wire|reg)\s+(?:\w+\s*,\s*)*((?:clk|ck|clock)(?:\w+)?)\s*(?:,|;|\))/i);
      if (sig) {
        clkName = sig[1];
      }
    }
    const nl = Array.from(raw.matchAll(/negedge\s+(\w+)/g)).map((m) => m[1]);
    if (nl.length) {
      if (!pl.includes(rstNName)) {
        rstNName = mostCommon(nl);
      }
    } else {
      const sig = raw.match(/(?:input|output|var|logic|wire|reg)\s+(?:\w+\s*,\s*)*((?:r?e?s?e?t)(?:\w+)?)\s*(?:,|;|\))/i);
      if (sig) {
        rstNName = sig[1];
      }
    }
  }
  if (cfg.alwaysCeAuto && clkEnName !== '') {
    const re = new RegExp(reDecl + clkEnName);
    if (!re.test(raw)) {
      clkEnName = '';
    }
  }
  const beautifier = new VerilogBeautifier({ useTab: true, indentSyle: cfg.indentStyle });
  let aL = 'always @(posedge ' + clkName + ' or negedge ' + rstNName + ')';
  if (cfg.alwaysFfBeginEnd) {
    aL += ' begin';
    if (cfg.alwaysLabel) {
      aL += ' : proc_$1';
    }
  }
  aL += '\n';
  aL += 'if(~' + rstNName + ') begin\n';
  aL += '$1 <= 0;';
  aL += '\nend else ';
  if (clkEnName !== '') {
    aL += 'if(' + clkEnName + ') ';
  }
  aL += 'begin\n';
  if (!cfg.alwaysOneCursor) {
    aL += '$1 <= $2;';
  }
  aL += '\nend\n';
  if (cfg.alwaysFfBeginEnd) {
    aL += 'end';
  }
  let aNr = 'always @(posedge ' + clkName + ')';
  if (cfg.alwaysFfBeginEnd || clkEnName === '') {
    aNr += ' begin';
    if (cfg.alwaysLabel) {
      aNr += ' : proc_$1';
    }
  }
  aNr += '\n';
  if (clkEnName !== '') {
    aNr += 'if(' + clkEnName + ') begin\n';
  }
  aNr += '$1';
  if (!cfg.alwaysOneCursor) {
    aNr += ' <= $2';
  }
  aNr += ';\nend\n';
  if (cfg.alwaysFfBeginEnd && clkEnName) {
    aNr += 'end';
  }
  aL = beautifier.beautifyText(aL);
  const aH = aL.replace(/neg/g, 'pos').split(rstNName).join(rstName).replace(/~/g, '');
  aNr = beautifier.beautifyText(aNr).replace('$1;', '$1');
  const result: [string, string, string] = [aL.slice(7), aH.slice(7), aNr.slice(7)];
  alwaysCacheKey = cacheKey;
  alwaysCache = result;
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveObject(document: vscode.TextDocument, expr: string): Promise<TypeInfo | null> {
  const parts = expr.split('.');
  let ti: TypeInfo | null = await typeInfo(document, parts[0]);
  if (!ti || !ti.type) {
    return null;
  }
  for (let i = 1; i < parts.length; i++) {
    ti = await memberType(document, ti, parts[i]);
    if (!ti) {
      return null;
    }
  }
  return ti;
}

async function memberType(document: vscode.TextDocument, parent: TypeInfo, member: string): Promise<TypeInfo | null> {
  const resolved = await resolveTypeInfo(document, parent);
  if (!resolved) {
    return null;
  }
  const fields = membersOf(resolved);
  for (const f of fields) {
    if (f.name === member) {
      return f;
    }
  }
  return null;
}

// Resolve a user defined type (typedef/struct/class/module) to its TypeInfo.
async function resolveTypeInfo(document: vscode.TextDocument, ti: TypeInfo): Promise<TypeInfo | null> {
  if (!ti || !ti.type) {
    return ti;
  }
  const t0 = ti.type.split(/\s+/)[0];
  if (['struct', 'union', 'enum', 'class', 'module', 'interface'].includes(t0) || ti.tag === 'typedef') {
    return ti;
  }
  // Look for a local definition first
  const local = getTypeInfo(cleanDocument(document), ti.type);
  if (local && local.type) {
    return local;
  }
  const cls = await INDEX.lookupClass(ti.type);
  if (cls) {
    return {
      name: cls.info.name,
      type: 'class',
      decl: cls.info.decl,
      array: '',
      bw: '',
      tag: 'class',
      value: null,
    };
  }
  const syms = await INDEX.findSymbols(ti.type, ['typedef']);
  for (const s of syms) {
    const text = await INDEX.readFile(s.uri);
    const found = getTypeInfo(cleanComment(text), ti.type);
    if (found && found.type) {
      return found;
    }
  }
  return ti;
}

function membersOf(ti: TypeInfo): TypeInfo[] {
  const t0 = (ti.type || '').split(/\s+/)[0];
  if (ti.decl && (t0 === 'struct' || t0 === 'union')) {
    const m = ti.decl.match(/\{([\s\S]*)\}/);
    if (m) {
      return getAllTypeInfo(m[1] + ';');
    }
  }
  return [];
}

function classMembers(info: FuncInfo[]): CompletionItemPlus[] {
  void info;
  return [];
}

interface CompletionItemPlus {
  label: string;
  detail: string;
  snippet?: string;
  kind?: vscode.CompletionItemKind;
}

function alwaysItems(document: vscode.TextDocument): CompletionItemPlus[] {
  const cfg = getConfig();
  const [aL, aH, aNr] = getAlwaysTemplate(document);
  const beginEnd = cfg.alwaysLabel ? 'begin : proc_$0\n\nend' : 'begin\n\nend';
  const isSv = /\.(sv|svh)$/i.test(document.fileName);
  const c: CompletionItemPlus[] = [];
  if (isSv) {
    c.push({ label: 'always_ff', detail: 'always_ff Async', snippet: 'always_ff ' + aL });
    c.push({ label: 'always_ffh', detail: 'always_ff Async high', snippet: 'always_ff ' + aH });
    c.push({ label: 'always_comb', detail: 'always_comb', snippet: 'always_comb ' + beginEnd });
    c.push({ label: 'always_latch', detail: 'always_latch', snippet: 'always_latch ' + beginEnd });
    c.push({ label: 'always_ff_nr', detail: 'always_ff No reset', snippet: 'always_ff ' + aNr });
    c.push({
      label: 'always_ff_sync',
      detail: 'always_ff Sync',
      snippet: 'always_ff ' + aL.replace(/ or negedge \w+/, ''),
    });
    c.push({
      label: 'always_ff_synch',
      detail: 'always_ff Sync high',
      snippet: 'always_ff ' + aH.replace(/ or posedge \w+/, ''),
    });
  }
  if (!isSv || !cfg.alwaysSvOnly) {
    c.push({ label: 'always', detail: 'always Async', snippet: 'always ' + aL });
    c.push({ label: 'alwaysh', detail: 'always Async high', snippet: 'always ' + aH });
    c.push({ label: 'alwaysc', detail: 'always *', snippet: 'always @(*) ' + beginEnd });
    c.push({ label: 'always_nr', detail: 'always NoReset', snippet: 'always_ff ' + aNr });
    c.push({ label: 'alwayss', detail: 'always sync', snippet: 'always ' + aL.replace(/ or negedge \w+/, '') });
    c.push({ label: 'alwayssh', detail: 'always sync high', snippet: 'always ' + aH.replace(/ or posedge \w+/, '') });
  }
  return c;
}

function caseTemplate(document: vscode.TextDocument, sigName: string): CompletionItemPlus | null {
  const m = sigName.match(/([\w.]+)(\s*\[(\d+):(\d+)\])?/);
  if (!m) {
    return null;
  }
  let ti = getTypeInfo(cleanDocument(document), m[1].split('.').pop()!);
  if (!ti || !ti.type) {
    return null;
  }
  const t0 = ti.type.split(/\s+/)[0];
  if (!['enum', 'logic', 'bit', 'reg', 'wire', 'input', 'output', 'inout'].includes(t0)) {
    const local = getTypeInfo(cleanDocument(document), ti.type);
    if (local && local.type) {
      ti = local;
    }
  }
  const length = m[3] ? parseInt(m[3], 10) - parseInt(m[4], 10) + 1 : 0;
  const [body] = fillCase(ti, length);
  if (!body) {
    return null;
  }
  return { label: 'case values', detail: 'Fill case with all values', snippet: body.replace(/\n/g, '\n') };
}

export function registerCompletion(context: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const cfg = getConfig();
      if (cfg.disableAutocomplete) {
        return undefined;
      }
      const line = document.lineAt(position.line).text;
      const before = line.slice(0, position.character);
      const prefixMatch = before.match(/[\w$`]*$/);
      const prefix = prefixMatch ? prefixMatch[0] : '';
      const beforePrefix = before.slice(0, before.length - prefix.length);
      let items: CompletionItemPlus[] = [];
      let prevSym = '';
      if (beforePrefix.endsWith('::')) {
        prevSym = '::';
      } else if (/[.`:$]/.test(beforePrefix.slice(-1))) {
        prevSym = beforePrefix.slice(-1);
      }
      if (cfg.languageServerEnabled && serverProvidesCompletion() && (prevSym === '.' || prevSym === '::')) {
        // Member / scope completion depends on cross-file resolution; when the
        // language server advertises completion it owns these, so return
        // undefined and keep only the local snippet completions below.
        return undefined;
      }
      if (prevSym === '.') {
        const dotIdx = before.lastIndexOf('.');
        const objM = before.slice(0, dotIdx).match(/([\w$]+(?:\.[\w$]+)*)$/);
        if (objM) {
          items = await dotItems(document, objM[1]);
        }
      } else if (prevSym === '::') {
        const scopeM = before.slice(0, -2).match(/([\w$:]+)$/);
        if (scopeM) {
          items = await scopeItems(document, scopeM[1]);
        }
      } else if (prevSym === '$') {
        items = listItems(mergeCompletion(DEFAULT_SYSTEMTASK, cfg.completionSystemtask, cfg.completionSystemtaskUser));
      } else if (prevSym === '`') {
        items = listItems(mergeCompletion(DEFAULT_TICK, cfg.completionTick, cfg.completionTickUser));
      } else if (!prefix && /\)\s*$/.test(beforePrefix)) {
        const caseM = before.match(/^\s*case\s*\((.+?)\)\s*$/);
        if (caseM) {
          const it = caseTemplate(document, caseM[1]);
          if (it) {
            items.push(it);
          }
        }
      } else if (prefix.startsWith('$')) {
        items = listItems(mergeCompletion(DEFAULT_SYSTEMTASK, cfg.completionSystemtask, cfg.completionSystemtaskUser));
      } else if (prefix.startsWith('`')) {
        items = listItems(mergeCompletion(DEFAULT_TICK, cfg.completionTick, cfg.completionTickUser));
      } else if (prefix.startsWith('a')) {
        items = alwaysItems(document);
      } else if (prefix.startsWith('u')) {
        items = listItems(mergeCompletion(DEFAULT_UVM, cfg.completionUvm, cfg.completionUvmUser));
      } else if (prefix.startsWith('m')) {
        items = modportItems(document);
      } else if (prefix.startsWith('end')) {
        items = endItems(document, position);
      } else if (prefix === '') {
        items = [];
      } else {
        items = keywordItems();
      }
      if (!items.length) {
        logger.debug(`completion: prefix="${prefix}" prevSym="${prevSym}" -> no item`);
        return undefined;
      }
      logger.debug(`completion: prefix="${prefix}" prevSym="${prevSym}" -> ${items.length} item(s)`);
      const range = new vscode.Range(position.translate(0, -prefix.length), position);
      return items.map((it) => {
        const ci = new vscode.CompletionItem(it.label, it.kind ?? vscode.CompletionItemKind.Snippet);
        ci.detail = it.detail;
        if (it.snippet !== undefined) {
          ci.insertText = new vscode.SnippetString(it.snippet);
        }
        ci.range = range;
        return ci;
      });
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider([{ language: 'systemverilog' }, { language: 'verilog' }], provider, '.', '$', '`', ':', '{', ',')
  );
}

function listItems(entries: CompletionEntry[]): CompletionItemPlus[] {
  return entries.map((e) => ({ label: e[0], detail: e[1], snippet: e[2] }));
}

async function dotItems(document: vscode.TextDocument, objExpr: string): Promise<CompletionItemPlus[]> {
  const ti = await resolveObject(document, objExpr);
  if (!ti || !ti.type) {
    return [];
  }
  const resolved = await resolveTypeInfo(document, ti);
  if (!resolved) {
    return [];
  }
  const t0 = (resolved.type || '').split(/\s+/)[0];
  // enum values
  if (resolved.tag === 'enum' || t0 === 'enum') {
    return getEnumValues(resolved.decl || '').map((v) => ({
      label: v,
      detail: 'enum value',
      kind: vscode.CompletionItemKind.EnumMember,
    }));
  }
  // struct/union fields
  if (t0 === 'struct' || t0 === 'union') {
    return membersOf(resolved).map((f) => ({
      label: f.name,
      detail: f.decl || f.type || 'field',
      kind: vscode.CompletionItemKind.Field,
    }));
  }
  // class
  if (t0 === 'class') {
    const cls = await INDEX.lookupClass(resolved.name);
    if (cls) {
      const out: CompletionItemPlus[] = cls.info.member.map((f) => ({
        label: f.name,
        detail: f.decl || f.type || 'member',
        kind: vscode.CompletionItemKind.Field,
      }));
      for (const f of cls.info.function) {
        out.push({
          label: f.name,
          detail: f.decl,
          snippet: functionSnippet(f),
          kind: vscode.CompletionItemKind.Method,
        });
      }
      return out;
    }
  }
  // module / interface instance -> ports
  if (t0 === 'module' || t0 === 'interface') {
    const mod = await INDEX.lookupModule(resolved.name);
    if (mod) {
      return mod.info.port.map((p) => ({
        label: p.name,
        detail: p.decl || 'port',
        kind: vscode.CompletionItemKind.Field,
      }));
    }
  }
  // built-in containers / strings
  return builtinMembers(t0);
}

function builtinMembers(t: string): CompletionItemPlus[] {
  if (t === 'string') {
    return ['len', 'putc', 'getc', 'substr', 'itoa', 'atoi', 'toupper', 'tolower'].map((m) => ({
      label: m,
      detail: 'string method',
      kind: vscode.CompletionItemKind.Method,
    }));
  }
  if (['queue', 'associative', 'dynamic', 'fixed', 'multidimension'].includes(t)) {
    return ['size', 'delete', 'insert', 'push_back', 'push_front', 'pop_back', 'pop_front', 'find', 'sum', 'max', 'min', 'unique', 'sort', 'reverse', 'shuffle'].map(
      (m) => ({ label: m, detail: 'array method', kind: vscode.CompletionItemKind.Method })
    );
  }
  return [];
}

async function scopeItems(document: vscode.TextDocument, scope: string): Promise<CompletionItemPlus[]> {
  const name = scope.split('::').pop()!;
  // package
  const members = await INDEX.lookupPackage(name);
  if (members) {
    const out: CompletionItemPlus[] = [];
    for (const x of members as any[]) {
      if ((x as TypeInfo).name) {
        out.push({ label: (x as TypeInfo).name, detail: (x as TypeInfo).decl || 'package member' });
      } else if (x.name && x.decl) {
        out.push({ label: x.name, detail: x.decl, snippet: functionSnippet(x) });
      }
    }
    if (out.length) {
      return out;
    }
  }
  // enum type
  const local = getTypeInfo(cleanDocument(document), name);
  if (local && (local.tag === 'enum' || (local.type || '').split(/\s+/)[0] === 'enum')) {
    return getEnumValues(local.decl || '').map((v) => ({ label: v, detail: 'enum value' }));
  }
  return [];
}

function functionSnippet(fi: FuncInfo): string {
  let head = (fi.return ? fi.return.trim() : '') + ' ' + fi.name + '(';
  const args = (fi.port || [])
    .map((p: TypeInfo, i: number) => '${' + (i + 1) + ':' + p.name + '}')
    .join(', ');
  head += args + ')';
  return head;
}

function modportItems(document: vscode.TextDocument): CompletionItemPlus[] {
  const txt = document.getText();
  const m = txt.match(/modport\s+(\w+)\s*\(/);
  const signals = documentAllTypeInfo(document, true)
    .filter((s) => s.tag === 'decl')
    .map((s) => s.name)
    .slice(0, 20);
  const body = 'modport $0 (' + signals.join(', ') + ');';
  return [{ label: 'modport', detail: 'Modport template', snippet: body }];
}

function endItems(document: vscode.TextDocument, position: vscode.Position): CompletionItemPlus[] {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const stack: string[] = [];
  const re = /\b(module|interface|package|class|function|task|begin|case|casex|casez|covergroup|generate)\b|\b(endmodule|endinterface|endpackage|endclass|endfunction|endtask|end|endcase|endgroup|endgenerate)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      stack.push(m[1]);
    } else if (stack.length) {
      stack.pop();
    }
  }
  const top = stack[stack.length - 1];
  const map: Record<string, string> = {
    module: 'endmodule',
    interface: 'endinterface',
    package: 'endpackage',
    class: 'endclass',
    function: 'endfunction',
    task: 'endtask',
    begin: 'end',
    case: 'endcase',
    casex: 'endcase',
    casez: 'endcase',
    covergroup: 'endgroup',
    generate: 'endgenerate',
  };
  if (top && map[top]) {
    return [{ label: 'end' + top, detail: 'close ' + top, snippet: map[top] + '${0}' }];
  }
  return [];
}

function keywordItems(): CompletionItemPlus[] {
  return [
    { label: 'fork', detail: 'fork..join', snippet: 'fork\n\t$0\njoin' },
    { label: 'forkn', detail: 'fork..none', snippet: 'fork\n\t$0\njoin_none' },
    { label: 'forka', detail: 'fork..any', snippet: 'fork\n\t$0\njoin_any' },
    { label: 'generate', detail: 'generate block', snippet: 'generate\n\t$0\nendgenerate' },
    { label: 'foreach', detail: 'foreach loop', snippet: 'foreach($1) begin\n\t$0\nend' },
    { label: 'posedge', detail: 'posedge', snippet: 'posedge ' },
    { label: 'negedge', detail: 'negedge', snippet: 'negedge ' },
  ];
}

// expose for FSM feature
export { caseTemplate };
