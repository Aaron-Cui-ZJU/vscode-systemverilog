// TypeScript port of verilogutil/verilogutil.py from the Sublime SystemVerilog plugin.

export interface TypeInfo {
  name: string;
  type: string | null;
  decl: string | null;
  array: string;
  bw: string;
  tag: string;
  value: string | null;
  access?: string;
  array_dim?: string;
  port?: PortInfo[];
  definition?: string;
  return?: string;
}

export interface PortInfo {
  name: string;
  type: string;
}

export interface ParamInfo {
  name: string;
  decl: string;
  value: string;
  position: number;
}

export interface FuncInfo {
  name: string;
  type: string;
  port: TypeInfo[];
  return: string;
  decl: string;
  definition: string;
  access?: string;
}

export interface ModuleInfo {
  name: string;
  param: ParamInfo[];
  port: TypeInfo[];
  inst: TypeInfo[];
  type: string;
  signal: TypeInfo[];
  modport?: TypeInfo[];
  clocking?: TypeInfo[];
}

export interface ClassInfo {
  type: string;
  name: string;
  extend: string | null;
  function: FuncInfo[];
  member: TypeInfo[];
  decl: string;
  param: ParamInfo[];
}

// regular expression for signal/variable declaration:
export const reBw = '[\\w\\*\\(\\)\\/><\\:\\-\\+`\\$\\s]+';
export const reVar =
  '^\\s*(\\w+\\s+)?(\\w+\\s+)?([A-Za-z_][\\w\\:\\.]*\\s+)(\\[' + reBw + '\\])?\\s*([A-Za-z_][\\w=,\\s]*,\\s*)?\\b';
export const reDecl =
  '(?:^|,|(?:\\w|\\)|#)\\s*\\(|;)\\s*(?:const\\s+)?(\\w+\\s+)?(\\w+\\s+)?(\\w+\\s+)?([A-Za-z_][\\w\\:\\.]*\\b\\s*)((?:\\[' +
  reBw +
  '\\]\\s*)*)((?:[A-Za-z_]\\w*(?:\\s*\\[[^=\\^\\&\\|,;]*?\\]\\s*)?(?:\\=\\s*[\\w\\.\\:]+\\s*)?,\\s*)*)\\b';
export const reEnum =
  '^\\s*(typedef\\s+)?(enum)\\s+(\\w+\\s*)?(\\[' + reBw + '\\])?\\s*(\\{[^\\}]+\\})\\s*([A-Za-z_][\\w=,\\s]*,\\s*)?\\b';
export const reUnion =
  '^\\s*(typedef\\s+)?(struct|union|`\\w+)\\s+(packed\\s+)?(signed|unsigned)?\\s*(\\{[\\w,;\\s`\\[\\:\\]\\/\\*\\+\\-><\\(\\)\\$]+\\})\\s*([A-Za-z_][\\w=,\\s]*,\\s*)?\\b';
export const reTdp = '^\\s*(typedef\\s+)(\\w+)\\s*(#\\s*\\(.*?\\))?\\s*()\\b';
export const reInst = '^\\s*(virtual)?(\\s*)()(\\w+)\\s*(#\\s*\\([^;]+\\))?\\s*()\\b';
export const reParam =
  '^\\s*parameter\\b((?:\\s*(?:\\w+\\s+)?(?:[A-Za-z_]\\w+)\\s*=\\s*(?:[^,;]*)\\s*,)*)(\\s*(\\w+\\s+)?([A-Za-z_]\\w+)\\s*=\\s*([^,;]*)\\s*;)';

export const portDir = ['input', 'output', 'inout', 'ref'];

const reComment = new RegExp(
  '//.*?$|/\\*.*?\\*/|\\(\\s*(\\*)\\s*\\)|\\(\\*.*?\\*\\)|"(?:\\\\.|[^\\\\"])*"',
  'gsm'
);

export function cleanComment(text: string): string {
  return text.replace(reComment, (match: string, star: string) => {
    if (star === '*') {
      return match;
    }
    if (match.startsWith('/') || match.startsWith('(')) {
      return ' ';
    }
    return match;
  });
}

// Python m.groups()[i] === JS match[i + 1]
function pg(m: RegExpMatchArray, i: number): string | null {
  const v = m[i + 1];
  return v === undefined ? null : v;
}

function rstrip(s: string): string {
  return s.replace(/\s+$/, '');
}

function findAll(re: RegExp, s: string): (string | null)[][] {
  const out: (string | null)[][] = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s)) !== null) {
    const groups: (string | null)[] = [];
    for (let i = 1; i < m.length; i++) {
      // Python re.findall returns an empty string (not None) for non-participating groups.
      groups.push(m[i] === undefined ? '' : m[i]);
    }
    out.push(groups);
    if (m.index === rx.lastIndex) {
      rx.lastIndex++;
    }
  }
  return out;
}

function findAllStrings(re: RegExp, s: string): string[] {
  return findAll(re, s).map((g) => g[0] as string);
}

export function getTypeInfo(txt: string, varName: string, searchDecl = true): TypeInfo {
  const notFound: TypeInfo = {
    decl: null,
    type: null,
    array: '',
    bw: '',
    name: varName,
    tag: '',
    value: null,
  };
  txt = cleanComment(txt);
  let m = txt.match(new RegExp(reEnum + '(' + varName + ')\\b.*$', 'sm'));
  if (m) {
    return getTypeInfoFromMatch(varName, m, 1, 3, 5, -1, 'enum')[0];
  }
  m = txt.match(new RegExp(reUnion + '(' + varName + ')\\b.*$', 'm'));
  if (m) {
    return getTypeInfoFromMatch(varName, m, 1, 3, 5, -1, 'struct')[0];
  }
  m = txt.match(new RegExp(reTdp + '(' + varName + ')\\b\\s*;.*$', 'm'));
  if (m) {
    return getTypeInfoFromMatch(varName, m, 1, 3, 3, -1, 'typedef')[0];
  }
  if (!searchDecl) {
    return notFound;
  }
  m = txt.match(new RegExp('\\b(clocking)\\s+(' + varName + ')(.*?)endclocking\\b', 's'));
  if (m) {
    return getClockingInfo(varName, m[3]);
  }
  const reStr =
    reDecl +
    '(' +
    varName +
    '\\b\\s*((?:\\[[^=\\^\\&\\|,;]*?\\]\\s*)*))(\\s*=\\s*(\\x27\\{.+?\\}|\\{.+?\\}|[^,;]+))?[^\\.]*?($|,|;)';
  m = txt.match(new RegExp(reStr, 'm'));
  if (m) {
    return getTypeInfoFromMatch(varName, m, 3, 4, 5, 9, 'decl')[0];
  }
  m = txt.match(new RegExp(reInst + '(' + varName + ')\\b.*$', 'm'));
  if (m) {
    return getTypeInfoFromMatch(varName, m, 3, 4, 5, 9, 'inst')[0];
  }
  return notFound;
}

export function getMacro(txt: string, name: string): [string, string] | null {
  txt = cleanComment(txt);
  const m = txt.match(
    new RegExp('^\\s*`define\\s+' + name + '\\b[ \\t]*(?:\\((.*?)\\)[ \\t]*)?(.*?)(?<!\\\\)\\n', 'sm')
  );
  if (!m) {
    return null;
  }
  let macro = m[2].replace(/\\\n/g, '');
  let paramList = m[1];
  if (paramList) {
    paramList = paramList.replace(/\\\n/g, '');
  }
  macro = macro.replace(/`"/g, '"');
  return [macro, paramList ?? ''];
}

export function getTypeInfoFromMatch(
  varName: string,
  m: RegExpMatchArray,
  idxType: number,
  idxBw: number,
  idxMax: number,
  idxVal: number,
  tag: string
): TypeInfo[] {
  const notFound: TypeInfo = {
    decl: null,
    type: null,
    array: '',
    bw: '',
    name: varName,
    tag,
    value: null,
  };
  if (!m) {
    return [notFound];
  }
  if (!pg(m, idxType)) {
    return [notFound];
  }
  const line = m[0].trim();
  let t = rstrip(pg(m, idxType) as string);
  if (
    [
      'begin',
      'end',
      'endcase',
      'endspecify',
      'else',
      'posedge',
      'negedge',
      'timeunit',
      'timeprecision',
      'assign',
      'disable',
      'property',
      'initial',
      'assert',
      'cover',
      'always_comb',
    ].includes(t) ||
    t.endsWith('.')
  ) {
    return [notFound];
  }
  t = t.split('.')[0];
  if (t === 'unsigned' || t === 'signed') {
    if (pg(m, 2) !== null) {
      t = rstrip(pg(m, 2) as string) + ' ' + t;
    } else if (pg(m, 1) !== null) {
      t = rstrip(pg(m, 1) as string) + ' ' + t;
    } else if (pg(m, 0) !== null && !(pg(m, 0) as string).startsWith('end')) {
      t = rstrip(pg(m, 0) as string) + ' ' + t;
    }
  } else if (t === 'const') {
    const cm = line.match(new RegExp(reUnion + varName + '.*$', 'm'));
    if (cm === null) {
      return [notFound];
    }
    t = cm[2];
    idxBw = 3;
  }
  let value: string | null = null;
  let ft = '';
  let bw = '';
  let signalList: (string | null)[][];
  if (varName !== '') {
    signalList = [];
    const rx = new RegExp('(' + varName + ')\\b\\s*((?:\\[(.*?)\\]\\s*)*)', 'gm');
    const src = pg(m, idxMax + 1) ?? '';
    let mm: RegExpExecArray | null;
    while ((mm = rx.exec(src)) !== null) {
      signalList.push([mm[1], mm[2] ?? '', mm[3] ?? '']);
    }
    if (idxVal > 0 && m.length - 1 > idxVal && pg(m, idxVal)) {
      value = rstrip(pg(m, idxVal) as string);
    }
  } else {
    signalList = [];
    const reStr =
      '(\\w+)\\b\\s*((?:\\[(.*)\\]\\s*)*)(?:\\=\\s*(\\\'\\{.+?\\}|[^;,]+)\\s*)?,?';
    if (pg(m, idxMax)) {
      signalList = findAll(new RegExp(reStr, 'm'), pg(m, idxMax) as string);
    }
    if (pg(m, idxMax + 1)) {
      let s = pg(m, idxMax + 1) as string;
      if (idxVal > 0 && m.length - 1 > idxVal && pg(m, idxVal)) {
        s += ' = ' + pg(m, idxVal);
      }
      signalList = signalList.concat(findAll(new RegExp(reStr, 'm'), s));
    }
  }
  signalList = signalList.filter(
    (s) =>
      !['if', 'case', 'casex', 'casez', 'for', 'foreach', 'generate', 'input', 'output', 'inout', 'return'].includes(
        s[0] as string
      )
  );
  if (signalList.length === 0) {
    return [notFound];
  }
  for (let i = 0; i < idxMax; i++) {
    const g = pg(m, i);
    if (g !== null) {
      let tmp = g.trim();
      if (tmp) {
        if (i === 4 && (t === 'enum' || t === 'struct')) {
          tmp = tmp.replace(/\s+/g, ' ');
        }
        if (i === idxBw) {
          tmp = tmp.replace(/\s+/g, '');
          bw = tmp;
        }
        if (!tmp.startsWith('end')) {
          ft += tmp + ' ';
        }
      }
    }
  }
  if (!ft.trim()) {
    return [notFound];
  }
  const ti: TypeInfo[] = [];
  if (t === 'class' && signalList.length === 1) {
    let l = line.trim();
    if (!l.endsWith(';')) {
      if (l.endsWith(',')) {
        l = l.slice(0, -1);
      }
      l += ');';
    }
    l += '\nendclass';
    const ci = parseClass(l);
    if (ci) {
      (ci as any).tag = 'decl';
      ti.push(ci as any);
    } else {
      ti.push(notFound);
    }
  } else {
    for (const signal of signalList) {
      let fts = ft + signal[0];
      let at = '';
      const s1 = signal[1] || '';
      if (s1 !== '') {
        fts += s1.trim();
        if ((s1.match(/\[/g) || []).length > 1) {
          at = 'multidimension';
        } else if ((signal[2] ?? '') === '') {
          at = 'dynamic';
        } else if (signal[2] === '$') {
          at = 'queue';
        } else if (signal[2] === '*') {
          at = 'associative';
        } else if (/^[A-Za-z_]\w*$/.test(signal[2] as string)) {
          at = 'associative';
        } else {
          at = 'fixed';
        }
      }
      if (!value && signal.length >= 4) {
        value = signal[3];
      }
      const d: TypeInfo = {
        decl: fts,
        type: t,
        array: at,
        bw,
        name: signal[0] as string,
        tag,
        value: value,
      };
      if (at) {
        d.array_dim = s1.trim();
      }
      const ft0 = ft.split(/\s+/)[0];
      if (ft0 === 'local' || ft0 === 'protected') {
        d.access = ft0;
      }
      ti.push(d);
    }
  }
  return ti;
}

export function getClockingInfo(name: string, content: string): any {
  const ports: PortInfo[] = [];
  let mPort: RegExpExecArray | null;
  const rxIn = /input\s+([^;]+);/g;
  while ((mPort = rxIn.exec(content)) !== null) {
    for (const x of mPort[1].split(',')) {
      ports.push({ name: x.trim(), type: 'input' });
    }
  }
  const rxOut = /output\s+([^;]+);/g;
  while ((mPort = rxOut.exec(content)) !== null) {
    for (const x of mPort[1].split(',')) {
      ports.push({ name: x.trim(), type: 'output' });
    }
  }
  return {
    decl: 'clocking ' + name,
    type: 'clocking',
    array: '',
    bw: '',
    name,
    tag: 'clocking',
    port: ports,
  };
}

export function getAllTypeInfo(txt: string, noInst = false): TypeInfo[] {
  txt = txt.replace(
    /^[ \t]*(import|export)[ \t]*(".*?"[ \t]*)?(pure)?[ \t]*(?<block>function|task)\b[\s\S]*?;/gm,
    ''
  );
  txt = txt.replace(/^[ \t\w]*extern\b[^;]+;/gm, '');
  txt = txt.replace(
    /^[ \t\w]*(?<block>function|task)\b[\s\S]*?\bend\k<block>\b[\s\S]*?$/gm,
    ''
  );
  // Cleanup constraint definition
  const constraints: [string, number, number][] = [];
  let cm: RegExpExecArray | null;
  const crx = /constraint\s+(?<name>\w+)\s*\{/gs;
  while ((cm = crx.exec(txt)) !== null) {
    constraints.push([cm.groups!.name, cm.index, cm.index + cm[0].length]);
  }
  for (const [name, start, end] of constraints.reverse()) {
    let cnt = 1;
    let pos = end;
    while (cnt > 0 && cnt < 64) {
      const rest = txt.slice(pos);
      const bm = rest.match(/[{}]/);
      if (!bm || bm.index === undefined) {
        console.warn('[SV] Error parsing constraint ' + name + ', unbalanced curly bracket !');
        cnt = -1;
        break;
      }
      pos = pos + bm.index + 1;
      cnt = bm[0] === '{' ? cnt + 1 : cnt - 1;
      if (cnt > 64) {
        console.warn('[SV] Too many nested bracket in constraint ' + name + ' !');
        cnt = -1;
        break;
      }
    }
    if (pos > start && cnt === 0) {
      txt = txt.slice(0, start) + txt.slice(pos);
    }
  }

  const ti: TypeInfo[] = [];
  // Look all modports
  const modportRe = /modport\s+(\w+)\s*\(([\s\S]*?)\);/g;
  const modports = findAll(new RegExp(modportRe.source, modportRe.flags), txt);
  if (modports.length) {
    for (const mp of modports) {
      ti.push({
        decl: (mp[1] as string).replace(/\n/g, ''),
        type: '',
        array: '',
        bw: '',
        name: mp[0] as string,
        tag: 'modport',
        value: null,
      });
    }
    txt = txt.replace(new RegExp(modportRe.source, 'g'), '');
  }
  // Look for clocking block
  const cbRe = /(default\s+)?(clocking)\s+(\w+)([\s\S]*?)endclocking(\s*:\s*\w+)?/g;
  const cbs = findAll(new RegExp(cbRe.source, cbRe.flags), txt);
  if (cbs.length) {
    for (const cb of cbs) {
      ti.push(getClockingInfo(cb[2] as string, cb[3] as string));
    }
    txt = txt.replace(new RegExp(cbRe.source, 'g'), '');
  }
  // Look for enum declaration
  let r = new RegExp(reEnum + '(\\w+\\b(\\s*\\[[^=\\^\\&\\|,;]*?\\]\\s*)?)\\s*;', 'gm');
  for (const m of txt.matchAll(r)) {
    const arr = m as unknown as RegExpMatchArray;
    const tiTmp = getTypeInfoFromMatch('', arr, 1, 3, 5, -1, 'enum');
    for (const x of tiTmp) {
      if (x.type) {
        ti.push(x);
      }
    }
  }
  txt = txt.replace(r, '');
  // Look for struct declaration
  r = new RegExp(reUnion + '(\\w+\\b(\\s*\\[[^=\\^\\&\\|,;]*?\\]\\s*)?)\\s*;', 'gm');
  for (const m of txt.matchAll(r)) {
    const arr = m as unknown as RegExpMatchArray;
    const tiTmp = getTypeInfoFromMatch('', arr, 1, 3, 5, -1, 'struct');
    for (const x of tiTmp) {
      if (x.type) {
        ti.push(x);
      }
    }
  }
  txt = txt.replace(r, '');
  // Look for typedef declaration
  r = new RegExp(reTdp + '(\\w+\\b(\\s*\\[[^=\\^\\&\\|,;]*?\\]\\s*)?)\\s*;', 'gm');
  for (const m of txt.matchAll(r)) {
    const arr = m as unknown as RegExpMatchArray;
    const tiTmp = getTypeInfoFromMatch('', arr, 1, 3, 3, -1, 'typedef');
    for (const x of tiTmp) {
      if (x.type) {
        ti.push(x);
      }
    }
  }
  txt = txt.replace(r, '');
  // Look for signal declaration
  const declRe = new RegExp(
    reDecl + '(\\w+\\b(\\s*\\[[^=\\^\\&\\|,;\\[\\]]*?\\]\\s*)*)\\s*(?:\\=\\s*(\\\'\\{.+\\}|[^;,]+)\\s*)?(?=;|,|\\)\\s*;)',
    'gm'
  );
  for (const m of txt.matchAll(declRe)) {
    const arr = m as unknown as RegExpMatchArray;
    const tiTmp = getTypeInfoFromMatch('', arr, 3, 4, 5, 8, 'decl');
    for (const x of tiTmp) {
      if (x.type) {
        ti.push(x);
      }
    }
  }
  // Look for interface instantiation
  if (!noInst) {
    const instRe = new RegExp(reInst + '(\\w+\\b(\\s*\\[[^=\\^\\&\\|,;]*?\\]\\s*)?)\\s*\\(', 'gm');
    for (const m of txt.matchAll(instRe)) {
      const arr = m as unknown as RegExpMatchArray;
      const tiTmp = getTypeInfoFromMatch('', arr, 3, 4, 5, -1, 'inst');
      for (const x of tiTmp) {
        if (x.type) {
          ti.push(x);
        }
      }
    }
  }
  // Merge duplicate non-ansi declarations
  const tiDict: Record<string, [TypeInfo, number]> = {};
  const popList: number[] = [];
  for (let i = 0; i < ti.length; i++) {
    const x = ti[i];
    if (x.name in tiDict) {
      const tiIndex = tiDict[x.name][1];
      if (ti[tiIndex].type && portDir.includes((ti[tiIndex].type as string).split(/\s+/)[0])) {
        ti[tiIndex].decl = (ti[tiIndex].decl as string).replace(
          ti[tiIndex].type as string,
          (ti[tiIndex].type as string).split(/\s+/)[0] + ' ' + x.type
        );
        ti[tiIndex].type = x.type;
        popList.push(i);
      }
    } else {
      tiDict[x.name] = [x, i];
    }
  }
  for (const i of popList.sort((a, b) => b - a)) {
    ti.splice(i, 1);
  }
  return ti;
}

export function extractParams(m: RegExpMatchArray): ParamInfo[] {
  const params: ParamInfo[] = [];
  let paramType = '';
  let pos = 0;
  const r = /(parameter\s+)?(?<decl>\b\w+\b\s*(\[[\w\:\-\+`\s]+\]\s*)?)?(?<name>\w+)\s*=\s*(?<value>[^,;\n]+)/g;
  const process = (s: string) => {
    let mp: RegExpExecArray | null;
    while ((mp = r.exec(s)) !== null) {
      const gd = mp.groups as any;
      const p: ParamInfo = { decl: gd.decl, name: gd.name, value: gd.value.trim(), position: pos };
      if (!p.decl) {
        p.decl = paramType;
      } else {
        p.decl = p.decl.trim();
        paramType = p.decl;
      }
      params.push(p);
      pos += 1;
    }
  };
  if (m.groups && m.groups.param) {
    process(cleanComment(m.groups.param));
  }
  if (m.groups && m.groups.content) {
    const s = cleanComment(m.groups.content);
    const rParamList = new RegExp(reParam, 'gm');
    let mpl: RegExpExecArray | null;
    while ((mpl = rParamList.exec(s)) !== null) {
      paramType = '';
      r.lastIndex = 0;
      process(mpl[0]);
    }
  }
  return params;
}

export function parseModule(flines: string, mname = '\\w+', instOnly = false, noInst = false): ModuleInfo | null {
  flines = cleanComment(flines);
  const reStr =
    '(?<type>module|interface)\\s+(?<name>' +
    mname +
    ')(?<import>\\s+import\\s+[\\s\\S]*?;)?\\s*(#\\s*\\((?<param>[\\s\\S]*?)\\))?\\s*(\\((?<port>[\\s\\S]*?)\\))?\\s*;(?<content>[\\s\\S]*?)(?<ending>endmodule|endinterface)';
  const m = flines.match(new RegExp(reStr, 's'));
  if (m === null) {
    return null;
  }
  const name = m.groups!.name;
  const txt = m[0];
  if (instOnly) {
    const minfo: ModuleInfo = {
      name,
      param: [],
      port: [],
      inst: [],
      type: m.groups!.type,
      signal: [],
    };
    const instRe = /^[ \t]*(\w+)\s*(?:#\s*\([^;]+\))?\s*\b(\w+)\b(?:\s*\[[^=\^\&\|,;]*?\]\s*)?\s*\(/gm;
    const li = findAll(new RegExp(instRe.source, instRe.flags), txt);
    for (const l of li) {
      if (
        ![
          'module',
          'class',
          'interface',
          'begin',
          'end',
          'endcase',
          'endspecify',
          'else',
          'posedge',
          'negedge',
          'timeunit',
          'timeprecision',
          'assign',
          'disable',
          'property',
          'initial',
          'assert',
          'cover',
          'generate',
        ].includes(l[0] as string)
      ) {
        minfo.inst.push({ type: l[0] as string, name: l[1] as string } as any);
      }
    }
    return minfo;
  }
  const paramsName: string[] = [];
  const params = extractParams(m);
  if (params) {
    for (const p of params) {
      paramsName.push(p.name);
    }
  }
  let txt2 = txt;
  if (m.groups!.param) {
    txt2 = txt2.replace(m.groups!.param, '');
  }
  let ati: TypeInfo[] = [];
  if (m.groups!.port) {
    ati = ati.concat(getAllTypeInfo(m.groups!.port + ';'));
  }
  if (m.groups!.content) {
    ati = ati.concat(getAllTypeInfo(m.groups!.content));
  }
  let ports: TypeInfo[] = [];
  let portsName: string[] = [];
  if (m.groups!.port) {
    const s = m.groups!.port;
    portsName = findAllStrings(/(\w+)\s*(?=,|$|=|\[[^=\^\&\|,;]*?\]\s*(?=,|$|=))/g, s);
    ports = ati.filter((ti) => portsName.includes(ti.name));
  }
  portsName = portsName.concat(paramsName);
  const inst = ati.filter((ti) => ti.type !== 'module' && ti.type !== 'interface' && ti.tag === 'inst');
  const signals = ati.filter(
    (ti) =>
      ti.type !== 'module' &&
      ti.type !== 'interface' &&
      !['inst', 'modport', 'clocking'].includes(ti.tag) &&
      !portsName.includes(ti.name)
  );
  const minfo: ModuleInfo = { name, param: params, port: ports, inst, type: m.groups!.type, signal: signals };
  const modports = ati.filter((ti) => ti.tag === 'modport');
  if (modports.length) {
    minfo.modport = modports;
  }
  const clocking = ati.filter((ti) => ti.tag === 'clocking');
  if (clocking.length) {
    minfo.clocking = clocking;
  }
  return minfo;
}

export function parsePackage(flines: string, pname = '\\w+'): TypeInfo[] | null {
  const m = flines.match(
    new RegExp('(?<type>package)\\s+(?<name>' + pname + ')\\s*;\\s*(?<content>[\\s\\S]+?)(?<ending>endpackage)', 's')
  );
  if (m === null) {
    return null;
  }
  const txt = cleanComment(m.groups!.content);
  const ti: any[] = getAllFunction(txt);
  ti.push(...getAllTypeInfo(txt, true));
  return ti;
}

export function parseFunction(flines: string, funcname: string): FuncInfo | null {
  const fi = getAllFunction(flines, funcname);
  if (!fi.length) {
    return null;
  }
  return fi[0];
}

export function parseClass(flines: string, cname = '\\w+'): ClassInfo | null {
  const reStr =
    '(?<type>class)\\s+(?<name>' +
    cname +
    ')\\s*(#\\s*\\((?<param>[\\s\\S]*?)\\))?\\s*(extends\\s+(?<extend>\\w+(?:\\s*#\\([\\s\\S]*?\\))?))?\\s*;(?<content>[\\s\\S]*?)(?<ending>endclass)';
  const m = flines.match(new RegExp(reStr, 's'));
  if (m === null) {
    return null;
  }
  const txt = cleanComment(m.groups!.content);
  const ci: ClassInfo = {
    type: 'class',
    name: m.groups!.name,
    extend: m.groups!.extend ? m.groups!.extend : null,
    function: [],
    member: [],
    decl: '',
    param: [],
  };
  ci.decl = 'class ' + ci.name + (m.groups!.param ? ' #(' + m.groups!.param + ') ' : ' ') + (ci.extend ? 'extends ' + ci.extend : '');
  ci.param = extractParams(m);
  ci.function = getAllFunction(txt);
  ci.member = getAllTypeInfo(txt, true);
  return ci;
}

export function getAllFunction(txt: string, funcname = '\\w+'): FuncInfo[] {
  const fil: FuncInfo[] = [];
  const names: string[] = [];
  let fl: (string | null)[][] = [];
  let reStr =
    'extern\\s+(?:\\b(protected|local)\\s+)?(\\b(?:virtual|static)\\s+)?\\b(function|task)\\s+((?:\\w+\\s+)?(?:\\w+\\s+|\\[[\\d:]+\\]\\s+)?)\\b(' +
    funcname +
    ')\\b\\s*(\\((.*?)\\s*\\))?\\s*;()';
  fl = fl.concat(findAll(new RegExp(reStr, 'gsm'), txt));
  txt = txt.replace(new RegExp(reStr, 'gm'), '');
  reStr =
    '^[ \\t]*(import)\\s+".*?"\\s*()()(function)\\s+((?:\\w+\\s+)?(?:\\w+\\s+|\\[[\\d:]+\\]\\s+)?)\\b(' +
    funcname +
    ')\\b\\s*(\\((.*?)\\s*\\))?\\s*;()';
  fl = fl.concat(findAll(new RegExp(reStr, 'gm'), txt));
  txt = txt.replace(new RegExp(reStr, 'gm'), '');
  reStr =
    '()(?:\\b(protected|local)\\s+)?(\\bvirtual\\s+)?\\b(function|task)\\s+((?:\\w+\\s+)?(?:\\w+\\s+|\\[[\\d:]+\\]\\s+)?)\\b((?:\\w+::)?' +
    funcname +
    ')\\b\\s*(\\((.*?)\\s*\\))?\\s*;(.*?)\\bend\\4\\b';
  fl = fl.concat(findAll(new RegExp(reStr, 'gs'), txt));

  for (const f of fl) {
    const fDef = f[0];
    const fAccess = f[1];
    const fVirtual = f[2];
    const fType = f[3];
    const fReturn = f[4];
    const fName = f[5];
    const fArgsUnderscore = f[6];
    const fArgs = f[7];
    const fContent = f[8];
    if (names.includes(fName as string)) {
      continue;
    }
    names.push(fName as string);
    let pi: TypeInfo[];
    if (fArgs) {
      pi = getAllTypeInfo(fArgs + ';');
    } else if (fArgsUnderscore) {
      pi = [];
    } else {
      const tiAll = getAllTypeInfo(fContent ?? '');
      pi = tiAll.filter((x) => x.decl && /^(input|output|inout|ref)/.test(x.decl));
    }
    let fDecl = `${fAccess ?? ''} ${fVirtual ?? ''} ${fType ?? ''} ${fReturn ?? ''} ${fName ?? ''}`;
    fDecl = fDecl.replace(/\s+/g, ' ').trim();
    const d: FuncInfo = {
      name: fName as string,
      type: fType as string,
      port: pi,
      return: fReturn as string,
      decl: fDecl,
      definition: (fDef ?? '') as string,
    };
    if (fAccess) {
      d.access = fAccess;
    }
    if (d.return && d.return.startsWith('automatic')) {
      d.return = d.return.split(/\s+/).filter(Boolean).slice(1).join(' ');
    }
    fil.push(d);
  }
  return fil;
}

export function fillCase(ti: TypeInfo, length = 0): [string | null, any] {
  if (!ti.type) {
    console.warn('[fillCase] No type for signal ' + ti.name);
    return [null, null];
  }
  const t = ti.type.split(/\s+/)[0];
  let s = '\n';
  if (t === 'enum') {
    const m = (ti.decl as string).match(/\{(.*)\}/s);
    if (m) {
      const el = findAll(new RegExp('(\\w+).*?(,|$)', 'g'), m[1]) as any;
      let maxlen = Math.max(...el.map((x: any) => (x[0] as string).length));
      if (maxlen < 7) {
        maxlen = 7;
      }
      for (const x of el) {
        s += '\t' + (x[0] as string).padEnd(maxlen) + ' : ;\n';
      }
      s += '\t' + 'default'.padEnd(maxlen) + ' : ;\nendcase';
      return [s, el.map((x: any) => x[0])];
    }
  } else if (['logic', 'bit', 'reg', 'wire', 'input', 'output'].includes(t)) {
    const m = ti.bw.match(/\[\s*(\d+)\s*\:\s*(\d+)/);
    if (m) {
      let bw: number;
      if (length > 0) {
        bw = length;
      } else {
        bw = parseInt(m[1], 10) + 1 - parseInt(m[2], 10);
      }
      if (bw <= 8) {
        for (let i = 0; i < 1 << bw; i++) {
          s += '\t' + String(i).padEnd(7) + ' : ;\n';
        }
        s += '\tdefault : ;\nendcase';
        return [s, Array.from({ length: 1 << bw }, (_, i) => i)];
      }
    }
  }
  console.warn('[fillCase] Type not supported: ' + t);
  return [null, null];
}

export function getEnumValues(decl: string): string[] {
  const m = decl.match(/\{(.*)\}/s);
  if (!m) {
    return [];
  }
  return findAllStrings(new RegExp('(\\w+).*?(?:,|$)', 'g'), m[1]);
}
