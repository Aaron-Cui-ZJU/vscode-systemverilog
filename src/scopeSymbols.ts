import {
  FuncInfo,
  ParamInfo,
  TypeInfo,
  getAllFunction,
  getAllTypeInfo,
  getEnumValues,
  maskCommentRanges,
  maskComments,
  parseModule,
  parsePackage,
} from './parser';

export type ScopeSymbolKind =
  | 'port'
  | 'param'
  | 'signal'
  | 'local'
  | 'instance'
  | 'typedef'
  | 'enumValue'
  | 'function'
  | 'task';

export interface ScopeSymbol {
  name: string;
  detail: string;
  kind: ScopeSymbolKind;
}

export interface ScopeSpan {
  kind: 'module' | 'interface' | 'package';
  name: string;
  start: number;
  end: number;
  symbols: ScopeSymbol[];
}

export interface ScopeTable {
  text: string;
  masked: string;
  ranges: [number, number][];
  spans: ScopeSpan[];
  unitText: string;
  unit: ScopeSymbol[];
}

type BlockKind = 'module' | 'interface' | 'package';

interface Region {
  start: number;
  end: number;
}

interface FunctionSpan {
  start: number;
  end: number;
  endKeywordStart: number;
}

const reOpen =
  /\b(module|interface|package|endmodule|endinterface|endpackage|class|endclass)\b/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readName(masked: string, from: number): string {
  const m = masked.slice(from).match(/^\s*([A-Za-z_]\w*)/);
  return m ? m[1] : '';
}

function scanSpans(masked: string): { spans: ScopeSpan[]; classes: Region[] } {
  const stack: { kind: BlockKind; name: string; start: number }[] = [];
  const classStack: number[] = [];
  const spans: ScopeSpan[] = [];
  const classes: Region[] = [];
  const re = new RegExp(reOpen.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const kw = m[1];
    const tokenEnd = m.index + m[0].length;
    if (kw === 'endmodule' || kw === 'endinterface' || kw === 'endpackage') {
      const want = kw.slice(3) as BlockKind;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === want) {
          const open = stack.splice(i, 1)[0];
          spans.push({ kind: open.kind, name: open.name, start: open.start, end: tokenEnd, symbols: [] });
          break;
        }
      }
      continue;
    }
    if (kw === 'endclass') {
      const start = classStack.pop();
      if (start !== undefined) {
        classes.push({ start, end: tokenEnd });
      }
      continue;
    }
    if (kw === 'class') {
      // `typedef class Foo;` is a forward declaration, not a scope.
      const before = masked.slice(Math.max(0, m.index - 32), m.index);
      if (/(?:^|[^\w$])typedef\s+$/.test(before)) {
        continue;
      }
      classStack.push(m.index);
      continue;
    }
    if (kw === 'interface') {
      // `virtual interface if_t vif;` is a variable declaration, not a scope.
      const before = masked.slice(Math.max(0, m.index - 32), m.index);
      if (/(?:^|[^\w$])virtual\s+$/.test(before)) {
        continue;
      }
      // `interface class C;` is a class declaration; the `class` token that
      // follows opens the class scope.
      if (/^\s*class\b/.test(masked.slice(tokenEnd))) {
        continue;
      }
    }
    stack.push({ kind: kw as BlockKind, name: readName(masked, tokenEnd), start: m.index });
  }
  for (const open of stack) {
    spans.push({ kind: open.kind, name: open.name, start: open.start, end: masked.length, symbols: [] });
  }
  for (const start of classStack) {
    classes.push({ start, end: masked.length });
  }
  return { spans, classes };
}

function blankRegions(text: string, regions: Region[]): string {
  const chars = text.split('');
  for (const region of regions) {
    const end = Math.min(region.end, chars.length);
    for (let i = Math.max(0, region.start); i < end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') {
        chars[i] = ' ';
      }
    }
  }
  return chars.join('');
}

// Same regions with their characters deleted, used as parser input: feeding
// thousands of blank lines to the declaration scanner is quadratic (the
// line-anchored patterns backtrack over whitespace), while real code costs
// linear time.
function removeRegions(text: string, regions: Region[]): string {
  const sorted = regions.slice().sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const region of sorted) {
    if (region.start > cursor) {
      parts.push(text.slice(cursor, region.start));
    }
    cursor = Math.max(cursor, region.end);
  }
  parts.push(text.slice(cursor));
  return parts.join('\n');
}

function dedupeSymbols(list: ScopeSymbol[]): ScopeSymbol[] {
  const seen = new Set<string>();
  const out: ScopeSymbol[] = [];
  for (const s of list) {
    if (!s.name || seen.has(s.name)) {
      continue;
    }
    seen.add(s.name);
    out.push(s);
  }
  return out;
}

function typeSymbol(ti: TypeInfo): ScopeSymbol[] {
  const detail = ti.decl ?? ti.type ?? ti.name;
  if (ti.tag === 'enum') {
    const out: ScopeSymbol[] = [{ name: ti.name, detail, kind: 'typedef' }];
    for (const value of ti.decl ? getEnumValues(ti.decl) : []) {
      out.push({ name: value, detail, kind: 'enumValue' });
    }
    return out;
  }
  if (ti.tag === 'typedef' || ti.tag === 'struct' || ti.tag === 'union') {
    return [{ name: ti.name, detail, kind: 'typedef' }];
  }
  return [{ name: ti.name, detail, kind: 'signal' }];
}

function funcSymbol(fn: FuncInfo): ScopeSymbol {
  const kind = fn.type === 'task' || /\btask\b/.test(fn.decl) ? 'task' : 'function';
  return { name: fn.name, detail: fn.decl || fn.name, kind };
}

function pushTypes(out: ScopeSymbol[], list: TypeInfo[]): void {
  for (const ti of list) {
    out.push(...typeSymbol(ti));
  }
}

function pushFunctions(out: ScopeSymbol[], list: FuncInfo[]): void {
  for (const fn of list) {
    out.push(funcSymbol(fn));
  }
}

// A span cut out of the masked text has no end keyword when the file is still
// being typed; the parser needs one, so append it (masked text keeps the span
// identifiable, and the appended keyword only affects the tail of the slice).
function withTerminator(slice: string, kind: BlockKind): string {
  if (kind === 'package') {
    return /\bendpackage\b/.test(slice) ? slice : slice + '\nendpackage';
  }
  const end = kind === 'interface' ? 'endinterface' : 'endmodule';
  return new RegExp('\\b' + end + '\\b').test(slice) ? slice : slice + '\n' + end;
}

function blockSymbols(slice: string, span: ScopeSpan): ScopeSymbol[] {
  const out: ScopeSymbol[] = [];
  const source = withTerminator(slice, span.kind);
  if (span.kind === 'package') {
    // parsePackage returns FuncInfo and TypeInfo interleaved; every TypeInfo
    // carries a `tag`, which FuncInfo does not.
    const members = parsePackage(source, escapeRe(span.name)) as (TypeInfo | FuncInfo)[] | null;
    for (const member of members ?? []) {
      if ('tag' in member) {
        out.push(...typeSymbol(member as TypeInfo));
      } else {
        out.push(funcSymbol(member as FuncInfo));
      }
    }
    return out;
  }
  const info = parseModule(source, escapeRe(span.name));
  if (info) {
    for (const p of info.port) {
      out.push({ name: p.name, detail: p.decl ?? p.type ?? p.name, kind: 'port' });
    }
    for (const p of info.param as ParamInfo[]) {
      out.push({ name: p.name, detail: p.decl || p.name, kind: 'param' });
    }
    for (const i of info.inst) {
      out.push({ name: i.name, detail: i.decl ?? i.type ?? i.name, kind: 'instance' });
    }
    pushTypes(out, info.signal);
    pushFunctions(out, getAllFunction(source, '\\w+'));
  }
  return out;
}

export function buildScopeTable(text: string): ScopeTable {
  const { masked, ranges } = maskCommentRanges(text);
  const { spans, classes } = scanSpans(masked);
  for (const span of spans) {
    span.symbols = dedupeSymbols(blockSymbols(masked.slice(span.start, span.end), span));
  }
  const blanks: Region[] = spans.slice();
  blanks.push(...classes);
  const unitText = blankRegions(masked, blanks);
  const unitSource = removeRegions(masked, blanks);
  const unit: ScopeSymbol[] = [];
  pushTypes(unit, getAllTypeInfo(unitSource, true));
  pushFunctions(unit, getAllFunction(unitSource, '\\w+'));
  return { text, masked, ranges, spans, unitText, unit: dedupeSymbols(unit) };
}

export function enclosingSpan(table: ScopeTable, offset: number): ScopeSpan | null {
  let best: ScopeSpan | null = null;
  for (const span of table.spans) {
    if (offset >= span.start && offset <= span.end && (!best || span.start > best.start)) {
      best = span;
    }
  }
  return best;
}

function functionSpans(masked: string, from: number, to: number): FunctionSpan[] {
  const re = /\b(function|task|endfunction|endtask)\b/g;
  const stack: { kind: string; start: number }[] = [];
  const out: FunctionSpan[] = [];
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null && m.index < to) {
    const kw = m[1];
    if (kw === 'function' || kw === 'task') {
      stack.push({ kind: kw, start: m.index });
      continue;
    }
    const want = kw === 'endfunction' ? 'function' : 'task';
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === want) {
        const open = stack.splice(i, 1)[0];
        out.push({ start: open.start, end: m.index + m[0].length, endKeywordStart: m.index });
        break;
      }
    }
  }
  for (const open of stack) {
    out.push({ start: open.start, end: to, endKeywordStart: to });
  }
  return out;
}

function localSymbols(table: ScopeTable, span: ScopeSpan, offset: number): ScopeSymbol[] {
  let best: FunctionSpan | null = null;
  for (const fn of functionSpans(table.masked, span.start, span.end)) {
    if (offset >= fn.start && offset <= fn.end && (!best || fn.start > best.start)) {
      best = fn;
    }
  }
  if (!best) {
    return [];
  }
  const semi = table.masked.indexOf(';', best.start);
  if (semi < 0 || semi > best.endKeywordStart) {
    return [];
  }
  const out: ScopeSymbol[] = [];
  const header = table.masked.slice(best.start, semi) + ';';
  const body = table.masked.slice(semi + 1, best.endKeywordStart);
  for (const ti of getAllTypeInfo(header).concat(getAllTypeInfo(body))) {
    out.push({ name: ti.name, detail: ti.decl ?? ti.type ?? ti.name, kind: 'local' });
  }
  return dedupeSymbols(out);
}

export function symbolsAt(table: ScopeTable, offset: number): ScopeSymbol[] {
  if (!isCodePosition(table, offset)) {
    return [];
  }
  const span = enclosingSpan(table, offset);
  if (!span) {
    return table.unit.slice();
  }
  return dedupeSymbols(span.symbols.concat(localSymbols(table, span, offset)));
}

export function isCodePosition(table: ScopeTable, offset: number): boolean {
  if (offset <= 0) {
    return true;
  }
  const inMasked = (position: number): boolean =>
    table.ranges.some(([start, end]) => position >= start && position < end);
  if (inMasked(offset - 1)) {
    return false;
  }
  return offset >= table.text.length || !inMasked(offset);
}

export function importedPackages(text: string): string[] {
  const masked = maskComments(text);
  const re = /^[ \t]*import\s+([^;]+);/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    for (const part of m[1].split(',')) {
      const spec = part.trim();
      if (!spec.endsWith('::*')) {
        continue;
      }
      const name = spec.slice(0, -3).split('::')[0].trim();
      if (/^[A-Za-z_]\w*$/.test(name) && !out.includes(name)) {
        out.push(name);
      }
    }
  }
  return out;
}

export function packageImportSource(table: ScopeTable, offset: number): string {
  const span = enclosingSpan(table, offset);
  if (!span) {
    return table.unitText;
  }
  return table.masked.slice(span.start, span.end) + '\n' + table.unitText;
}
