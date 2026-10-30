import { maskComments } from './parser';

// Context of a `.` typed inside a module/interface instantiation's port
// connection list. Offsets index the raw document text; `bound` and
// `wildcard` are derived from the comment-masked binding region.
export interface PortBindingContext {
  moduleName: string;
  instanceName: string;
  openParen: number;
  closeParen: number;
  dotOffset: number;
  hasBinding: boolean;
  isLast: boolean;
  multiline: boolean;
  bound: Set<string>;
  wildcard: boolean;
  commaOffset: number | null;
}

export interface PortBindingSuggestion {
  label: string;
  detail: string;
  insertText: string;
  isSnippet: boolean;
  order: number;
}

const KEYWORDS = new Set([
  'module',
  'interface',
  'function',
  'task',
  'if',
  'for',
  'while',
  'case',
  'casex',
  'casez',
  'always',
  'always_ff',
  'always_comb',
  'always_latch',
  'assign',
  'generate',
  'begin',
  'end',
  'initial',
  'final',
  'return',
  'do',
  'repeat',
  'forever',
  'typedef',
  'parameter',
  'localparam',
  'import',
  'export',
  'bind',
  'assert',
  'cover',
  'property',
  'sequence',
  'clocking',
  'modport',
  'virtual',
  'extern',
  'static',
]);

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

function skipWsBack(s: string, i: number): number {
  while (i >= 0 && /\s/.test(s[i])) {
    i--;
  }
  return i;
}

// Last identifier ending at (or just before) `end`, ignoring trailing
// whitespace. `start` is the index of its first character.
function identEndingAt(s: string, end: number): { name: string; start: number } | null {
  let e = end;
  while (e > 0 && /\s/.test(s[e - 1])) {
    e--;
  }
  const m = s.slice(0, e).match(/([A-Za-z_]\w*)$/);
  if (!m) {
    return null;
  }
  return { name: m[1], start: e - m[1].length };
}

// Index of the opener matching the closer at `closeIdx`, or -1.
function matchOpenBack(s: string, closeIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (s[i] === closeCh) {
      depth++;
    } else if (s[i] === openCh) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function rejectBefore(s: string, start: number): boolean {
  if (start <= 0) {
    return false;
  }
  const c = s[start - 1];
  return c === '.' || c === ':' || c === '$';
}

// Parse `moduleName [#(...) ] instanceName [ [range] ]` backwards from the
// port list's opening paren.
function parseInstantiationHead(masked: string, open: number): { moduleName: string; instanceName: string } | null {
  let j = skipWsBack(masked, open - 1);
  if (j < 0) {
    return null;
  }
  if (masked[j] === ']') {
    const k = matchOpenBack(masked, j, '[', ']');
    if (k < 0) {
      return null;
    }
    j = skipWsBack(masked, k - 1);
    if (j < 0) {
      return null;
    }
  }
  const inst = identEndingAt(masked, j + 1);
  if (!inst || rejectBefore(masked, inst.start)) {
    return null;
  }
  let p = skipWsBack(masked, inst.start - 1);
  if (p >= 0 && masked[p] === ')') {
    const k = matchOpenBack(masked, p, '(', ')');
    if (k < 0) {
      return null;
    }
    p = skipWsBack(masked, k - 1);
    if (p < 0 || masked[p] !== '#') {
      return null;
    }
    p = skipWsBack(masked, p - 1);
  }
  const mod = identEndingAt(masked, p + 1);
  if (!mod || rejectBefore(masked, mod.start) || KEYWORDS.has(mod.name)) {
    return null;
  }
  return { moduleName: mod.name, instanceName: inst.name };
}

// Nearest-first unmatched `(` candidates scanning backwards from `from`,
// stopping at a `;` seen outside every bracket.
function findOpenParens(masked: string, from: number): number[] {
  const out: number[] = [];
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let i = from; i >= 0; i--) {
    const c = masked[i];
    if (c === ')') {
      paren++;
    } else if (c === '(') {
      if (paren > 0) {
        paren--;
      } else {
        out.push(i);
      }
    } else if (c === ']') {
      bracket++;
    } else if (c === '[') {
      if (bracket > 0) {
        bracket--;
      }
    } else if (c === '}') {
      brace++;
    } else if (c === '{') {
      if (brace > 0) {
        brace--;
      }
    } else if (c === ';' && paren === 0 && bracket === 0 && brace === 0) {
      break;
    }
  }
  return out;
}

// Matching `)` forward from `open`; when the parentheses never close, fall
// back to the next `;` at depth zero, then to the end of the text.
function findPortListEnd(masked: string, open: number): { end: number; closeParen: number } {
  let depth = 1;
  for (let i = open + 1; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        return { end: i, closeParen: i };
      }
    }
  }
  depth = 0;
  for (let i = open + 1; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      if (depth > 0) {
        depth--;
      }
    } else if (c === ';' && depth === 0) {
      return { end: i, closeParen: -1 };
    }
  }
  return { end: masked.length, closeParen: -1 };
}

export function findPortBindingContext(text: string, cursorOffset: number): PortBindingContext | null {
  const masked = maskComments(text);
  const cursor = Math.max(0, Math.min(cursorOffset, masked.length));
  let wordStart = cursor;
  while (wordStart > 0 && /[A-Za-z0-9_$]/.test(masked[wordStart - 1])) {
    wordStart--;
  }
  const dotOffset = wordStart - 1;
  if (dotOffset < 0 || masked[dotOffset] !== '.') {
    return null;
  }
  const hasBinding = wordStart < cursor;
  // `u_dut.`, `pkg::x.` and similar are member/hierarchy completion.
  if (isIdentChar(masked[dotOffset - 1]) || masked[dotOffset - 1] === '.') {
    return null;
  }
  for (const open of findOpenParens(masked, dotOffset - 1)) {
    const { end, closeParen } = findPortListEnd(masked, open);
    if (dotOffset <= open || dotOffset >= end) {
      continue;
    }
    const head = parseInstantiationHead(masked, open);
    if (!head) {
      continue;
    }
    const region = masked.slice(open + 1, end);
    const bound = new Set<string>();
    const re = /\.(\w+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(region)) !== null) {
      bound.add(m[1]);
    }
    const wildcard = /\.\s*\*/.test(region);
    const multiline = region.includes('\n');
    const isLast = !hasBinding && masked.slice(cursor, end).trim() === '';
    let commaOffset: number | null = null;
    if (!hasBinding) {
      const i = skipWsBack(masked, dotOffset - 1);
      if (i >= 0) {
        const c = masked[i];
        if (c !== ',' && c !== '(' && (c === ')' || isIdentChar(c))) {
          commaOffset = i + 1;
        }
      }
    }
    return {
      moduleName: head.moduleName,
      instanceName: head.instanceName,
      openParen: open,
      closeParen,
      dotOffset,
      hasBinding,
      isLast,
      multiline,
      bound,
      wildcard,
      commaOffset,
    };
  }
  return null;
}

function escapeSnippet(s: string): string {
  return s.replace(/[\\$}]/g, '\\$&');
}

export function buildBindingSuggestions(
  ctx: PortBindingContext,
  ports: { name: string; decl?: string | null; type?: string | null }[]
): PortBindingSuggestion[] {
  if (ctx.wildcard) {
    return [];
  }
  const out: PortBindingSuggestion[] = [];
  if (ctx.hasBinding) {
    ports.forEach((p, i) => {
      if (ctx.bound.has(p.name)) {
        return;
      }
      out.push({
        label: p.name,
        detail: p.decl || p.type || 'port',
        insertText: p.name,
        isSnippet: false,
        order: i,
      });
    });
    return out;
  }
  let pad = 0;
  if (ctx.multiline) {
    for (const p of ports) {
      if (p.name.length > pad) {
        pad = p.name.length;
      }
    }
  }
  ports.forEach((p, i) => {
    if (ctx.bound.has(p.name)) {
      return;
    }
    const insertText =
      p.name.padEnd(pad) + '(${1:' + escapeSnippet(p.name) + '})' + (ctx.isLast ? '' : ',');
    out.push({
      label: p.name,
      detail: p.decl || p.type || 'port',
      insertText,
      isSnippet: true,
      order: i,
    });
  });
  return out;
}
