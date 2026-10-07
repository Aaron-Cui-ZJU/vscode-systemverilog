import * as vscode from 'vscode';
import { VerilogBeautifier } from './beautifier';
import { getConfig, SvConfig } from './config';
import { INDEX } from './indexer';
import { ModuleInfo, TypeInfo, cleanComment, parseModule } from './parser';
import { documentModuleInfo } from './documentCache';
import * as logger from './logger';

interface ConnectInfo {
  decl: string;
  ac: Record<string, string>;
  wc: Record<string, string>;
}

function indentUnit(editor: vscode.TextEditor): string {
  const insertSpaces = editor.options.insertSpaces !== false;
  const tabSize = (editor.options.tabSize as number) || 4;
  return insertSpaces ? ' '.repeat(tabSize) : '\t';
}

function checkConnect(port: TypeInfo, sig: TypeInfo): [boolean, string] {
  const sigDecl = sig.decl || '';
  const portDecl = port.decl || '';
  if (sigDecl.startsWith('input') && !portDecl.startsWith('input')) {
    return [false, 'Incompatible port direction (not an input)'];
  }
  if (sigDecl.startsWith('inout') && !portDecl.startsWith('inout')) {
    return [false, 'Incompatible port direction not an inout'];
  }
  let ds = sigDecl.replace(/input |output |inout /g, '');
  ds = ds.replace(/var |signed |unsigned /g, '').trim();
  let d = (port as any).declSig || '';
  d = d.replace(/signed |unsigned /g, '');
  if (!d.includes('$')) {
    d = d.replace(/\(|\)/g, '');
  }
  if ((sig.type || '').match(/^(input|output|inout)/) && !ds.startsWith('logic ')) {
    ds = 'logic ' + ds;
  } else if (ds.includes('.')) {
    ds = ds.replace(/(\w+)\b(.*)/, '$1');
    d = d.replace(/(\w+)\b(.*)/, '$1');
  }
  ds = ds.replace(/\b(wire|reg)\b/g, 'logic').trim();
  d = d.replace(/\b(wire|reg)\b/g, 'logic').trim();
  if ((ds.includes('::') && !d.includes('::')) || (!ds.includes('::') && d.includes('::'))) {
    ds = ds.replace(/\w+\:\:/g, '');
    d = d.replace(/\w+\:\:/g, '');
  }
  if (sig.name !== port.name) {
    ds = ds.replace(new RegExp('\\b' + sig.name + '\\b'), port.name);
  }
  if (ds !== d) {
    const warn = 'Signal/port not matching : Expecting ' + d + ' -- Found ' + ds;
    return [false, warn.replace(new RegExp('\\b' + port.name + '\\b'), '')];
  }
  return [true, ''];
}

function getConnect(
  editor: vscode.TextEditor,
  cfg: SvConfig,
  pm: ModuleInfo,
  unit: string
): ConnectInfo {
  const decl: string[] = [];
  const ac: Record<string, string> = {};
  const wc: Record<string, string> = {};
  const fname = editor.document.fileName.toLowerCase();
  const sigType = fname.endsWith('.v') ? 'wire' : 'logic';
  const mi = documentModuleInfo(editor.document, false, true);
  if (!mi) {
    return { decl: '', ac, wc };
  }
  const signalDict: Record<string, TypeInfo> = {};
  for (const ti of mi.port) {
    signalDict[ti.name] = ti;
  }
  for (const ti of mi.signal) {
    signalDict[ti.name] = ti;
  }
  let signalDictText = '';
  for (const name of Object.keys(signalDict)) {
    signalDictText += name + '\n';
  }
  const paramDict: Record<string, string> = {};
  for (const p of pm.param || []) {
    paramDict[p.name] = p.value;
  }
  for (const p of pm.port) {
    let pname = p.name;
    for (const prefix of cfg.autoconnectPortPrefix) {
      if (pname.startsWith(prefix)) {
        pname = pname.slice(prefix.length);
        break;
      }
    }
    for (const suffix of cfg.autoconnectPortSuffix) {
      if (pname.endsWith(suffix)) {
        pname = pname.slice(0, -suffix.length);
        break;
      }
    }
    if (pname !== p.name) {
      ac[p.name] = pname;
    }
    let ti: TypeInfo = signalDict[pname] || {
      decl: null,
      type: null,
      array: '',
      bw: '',
      name: pname,
      tag: '',
      value: null,
    };
    if (p.decl) {
      let declSig = p.decl.replace(/input |output |inout /g, '');
      declSig = declSig.replace(/var /g, '');
      declSig = declSig.replace(new RegExp('\\b' + p.name + '\\b'), pname);
      if ((p.type || '').match(/^(input|output|inout)/)) {
        declSig = sigType + ' ' + declSig;
      } else if (declSig.includes('.')) {
        declSig = declSig.replace(/(\w+)\.\w+\s+(.*)/, '$1 $2()');
      }
      if (p.decl.startsWith('output') && /\breg\b/.test(p.decl)) {
        if (new RegExp('\\b' + sigType + '\\b').test(p.decl)) {
          declSig = declSig.replace(/\breg\s+/, '');
        } else {
          declSig = declSig.replace(/\breg\b/, sigType);
        }
      }
      for (const [k, v] of Object.entries(paramDict)) {
        if (declSig.includes(k)) {
          declSig = declSig.replace(new RegExp('\\b' + k + '\\b'), v);
        }
      }
      const fa = declSig.match(/((\[|:)\s*(\d+)\s*(\+|-)\s*(\d+))/g);
      if (fa) {
        for (const f of fa) {
          const m = f.match(/(\[|:)\s*(\d+)\s*(\+|-)\s*(\d+)/);
          if (m) {
            const value =
              m[3] === '+' ? parseInt(m[3], 10) + parseInt(m[4], 10) : parseInt(m[3], 10) - parseInt(m[4], 10);
            declSig = declSig.replace(f, m[1] + value);
          }
        }
      }
      (p as any).declSig = declSig;
    }
    if (ti.decl === null && cfg.autoconnectAllowPrefix) {
      const re = new RegExp('\\b(\\w+_' + pname + ')\\b', 'gm');
      let m: RegExpExecArray | null;
      while ((m = re.exec(signalDictText)) !== null) {
        if (signalDict[m[1]]) {
          const cand = signalDict[m[1]];
          if (cand.decl) {
            const [match] = checkConnect(p, cand);
            if (match) {
              if (m[1] !== p.name) {
                ac[p.name] = m[1];
              }
              ti = cand;
              break;
            }
          }
        }
      }
    }
    if (ti.decl === null && cfg.autoconnectAllowSuffix) {
      const re = new RegExp('\\b(' + pname + '_\\w+)\\b', 'gm');
      let m: RegExpExecArray | null;
      while ((m = re.exec(signalDictText)) !== null) {
        if (signalDict[m[1]]) {
          const cand = signalDict[m[1]];
          if (cand.decl) {
            const [match] = checkConnect(p, cand);
            if (match) {
              if (m[1] !== p.name) {
                ac[p.name] = m[1];
              }
              ti = cand;
              break;
            }
          }
        }
      }
    }
    if (p.decl) {
      if (ti.decl === null) {
        decl.push(unit + (p as any).declSig + ';');
      } else {
        const [match, warn] = checkConnect(p, ti);
        if (!match) {
          wc[p.name] = warn;
        }
      }
    }
  }
  return { decl: decl.length ? decl.join('\n') + '\n' : '', ac, wc };
}

function findDeclPosition(text: string, cfg: SvConfig, cursorOffset: number): number {
  if (cfg.declStart) {
    const start = text.indexOf(cfg.declStart);
    if (start >= 0) {
      if (cfg.declEnd) {
        const stop = text.indexOf(cfg.declEnd, start);
        if (stop >= 0) {
          return firstEmptyLineAtOrAfter(text, stop);
        }
      }
      return firstEmptyLineAtOrAfter(text, start);
    }
  }
  return cursorOffset;
}

function firstEmptyLineAtOrAfter(text: string, offset: number): number {
  let idx = offset;
  while (idx < text.length) {
    const nl = text.indexOf('\n', idx);
    if (nl === -1) {
      return text.length;
    }
    const line = text.slice(idx, nl);
    if (line.trim() === '') {
      return nl + 1;
    }
    idx = nl + 1;
  }
  return text.length;
}

export async function instantiateModule(editor: vscode.TextEditor): Promise<void> {
  const cfg = getConfig();
  const files = await INDEX.listModuleFiles();
  const items: { label: string; description: string; name: string }[] = [];
  for (const uri of files) {
    const text = await INDEX.readFile(uri);
    for (const name of INDEX.moduleNamesInFile(text)) {
      items.push({
        label: name,
        description: vscode.workspace.asRelativePath(uri),
        name,
      });
    }
  }
  if (!items.length) {
    logger.warn('instantiateModule: no module found in the project');
    vscode.window.showWarningMessage('No module found in the project');
    return;
  }
  logger.debug(`instantiateModule: ${items.length} candidate module(s)`);
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select module to instantiate',
    matchOnDescription: true,
  });
  if (!picked) {
    logger.debug('instantiateModule: cancelled at module selection');
    return;
  }
  logger.info(`instantiateModule: selected "${picked.name}" from ${picked.description}`);
  const found = await INDEX.lookupModule(picked.name);
  if (!found) {
    logger.error(`instantiateModule: unable to parse module ${picked.name}`);
    vscode.window.showErrorMessage('Unable to parse module ' + picked.name);
    return;
  }
  const pm = found.info;
  const unit = indentUnit(editor);
  // Parameter prompting
  let paramDecl = '';
  const pv: { name: string; value: string }[] = [];
  if (pm.param && pm.param.length && cfg.fillparam) {
    for (const p of pm.param) {
      const defaultValue = cfg.paramPropagate
        ? 'parameter ' + (p.decl ? p.decl + ' ' : '') + p.name + ' = ' + p.value
        : 'Default: ' + p.value;
      const content = await vscode.window.showInputBox({
        prompt: 'Parameter ' + p.name,
        value: defaultValue,
        valueSelection: [0, defaultValue.length],
        ignoreFocusOut: true,
      });
      if (content === undefined) {
        return;
      }
      let value = content;
      if (!content.startsWith('Default')) {
        value = content;
      } else if (cfg.paramExplicit) {
        value = content.slice(9);
      } else {
        value = '';
      }
      if (value.startsWith('parameter') || value.startsWith('localparam')) {
        paramDecl += unit.repeat(cfg.declIndent) + value + ';\n';
        const m = value.match(/(\w+)\s*=/);
        const useVal = m ? m[1] : p.value;
        p.value = p.name;
        pv.push({ name: p.name, value: useVal });
      } else if (value !== '') {
        p.value = value;
        pv.push({ name: p.name, value: value });
      }
    }
  } else if (cfg.paramExplicit && pm.param) {
    for (const p of pm.param) {
      pv.push({ name: p.name, value: p.value });
    }
  }

  // Auto connect
  let decl = '';
  const ac: Record<string, string> = {};
  const wc: Record<string, string> = {};
  if (cfg.autoconnect && pm.port.length) {
    const res = getConnect(editor, cfg, pm, unit);
    decl = res.decl;
    Object.assign(ac, res.ac);
    Object.assign(wc, res.wc);
    logger.debug(`instantiateModule: autoconnect declared ${decl ? decl.replace(/\n$/, '').split('\n').length : 0} signal(s), ${Object.keys(ac).length} renamed, ${Object.keys(wc).length} mismatch(es)`);
  }

  const instName = cfg.instancePrefix + pm.name + cfg.instanceSuffix;
  let isParamOneLine = cfg.paramOneline;
  let isInstOneLine = cfg.instOneline;
  if (isInstOneLine) {
    let lenInst = pm.name.length + 1 + instName.length + 2;
    if (pv.length) {
      lenInst += 2;
      for (const p of pv) {
        lenInst += p.name.length + p.value.length + 5;
      }
    }
    if (lenInst + 3 > cfg.maxLineLength) {
      isParamOneLine = false;
    } else if (pm.port.length) {
      for (const p of pm.port) {
        lenInst += p.name.length + 5;
        lenInst += p.name in ac ? ac[p.name].length : p.name.length;
      }
    }
    if (lenInst + 3 > cfg.maxLineLength) {
      isInstOneLine = false;
    }
  }
  let inst = pm.name + ' ';
  if (pv.length) {
    const maxLen = isParamOneLine || !cfg.paramPortAlignment ? 0 : Math.max(...pv.map((x) => x.name.length));
    inst += '#(';
    if (!isParamOneLine) {
      inst += '\n';
    }
    for (let i = 0; i < pv.length; i++) {
      if (!isParamOneLine) {
        inst += '\t';
      }
      inst += '.' + pv[i].name.padEnd(maxLen) + '(' + pv[i].value + ')';
      if (i < pv.length - 1) {
        inst += ',';
      }
      if (!isParamOneLine) {
        inst += '\n';
      } else if (i < pv.length - 1) {
        inst += ' ';
      }
    }
    inst += ') ';
  }
  inst += instName + ' (';
  if (!isInstOneLine) {
    inst += '\n';
  }
  if (pm.port.length) {
    let maxLenP = 0;
    let maxLenS = 0;
    if (!isInstOneLine && cfg.paramPortAlignment) {
      maxLenP = Math.max(...pm.port.map((x) => x.name.length));
      maxLenS = maxLenP;
      if (Object.keys(ac).length) {
        maxLenS = Math.max(...Object.values(ac).map((x) => x.length));
        if (maxLenP > maxLenS) {
          maxLenS = maxLenP;
        }
      }
    }
    for (let i = 0; i < pm.port.length; i++) {
      const portname = pm.port[i].name;
      if (!isInstOneLine) {
        inst += '\t';
      }
      inst += '.' + portname.padEnd(maxLenP) + '(';
      if (cfg.autoconnect) {
        if (portname in ac) {
          inst += ac[portname].padEnd(maxLenS);
        } else {
          inst += portname.padEnd(maxLenS);
        }
      }
      inst += ')';
      if (i < pm.port.length - 1) {
        inst += ',';
      }
      if (!isInstOneLine) {
        if (portname in wc) {
          inst += ' // TODO: Check connection ! ' + wc[portname];
        }
        inst += '\n';
      } else if (i < pm.port.length - 1) {
        inst += ' ';
      }
    }
  }
  inst += ');\n';

  const cursor = editor.selection.active;
  await editor.edit((eb) => {
    const cursorOffset = editor.document.offsetAt(cursor);
    if (decl || paramDecl) {
      const pos = findDeclPosition(editor.document.getText(), cfg, cursorOffset);
      eb.insert(editor.document.positionAt(pos), '\n' + paramDecl + decl);
    }
    eb.insert(cursor, inst);
  });

  const s: string[] = [];
  const nbDecl = decl ? decl.replace(/\n$/, '').split('\n').length : 0;
  if (nbDecl) {
    s.push('Adding ' + nbDecl + ' signal declaration(s)');
  }
  if (Object.keys(ac).length) {
    s.push('Non-perfect name match for ' + Object.keys(ac).length + ' port(s): ' + JSON.stringify(ac));
  }
  if (Object.keys(wc).length) {
    s.push('Found ' + Object.keys(wc).length + ' mismatch(es): ' + JSON.stringify(wc));
  }
  if (s.length) {
    logger.info('instantiateModule: ' + s.join(' | '));
    vscode.window.showInformationMessage(s.join(' | '));
  }
}

// -------------------- dot star --------------------

export function findInstantiationRange(text: string, offset: number): { start: number; end: number } | null {
  const end = text.indexOf(';', offset);
  if (end === -1) {
    return null;
  }
  let start = text.lastIndexOf(';', offset);
  start = start === -1 ? 0 : start + 1;
  const seg = text.slice(start, end + 1);
  if (!/^[ \t]*\w+\s*(#\s*\([^;]*\))?\s*\w+\s*\(/s.test(seg)) {
    // maybe previous ';' is inside the instantiation parameters; retry a line-based search
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    const back = text.lastIndexOf(';', lineStart - 1);
    start = back === -1 ? 0 : back + 1;
  }
  return { start, end: end + 1 };
}

export function toggleDotStar(editor: vscode.TextEditor): void {
  const text = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const range = findInstantiationRange(text, offset);
  if (!range) {
    logger.debug('toggleDotStar: cursor not inside a module instantiation');
    vscode.window.showInformationMessage('Cursor is not inside a module instantiation');
    return;
  }
  logger.debug(`toggleDotStar: instantiation ${range.start}..${range.end}`);
  let raw = text.slice(range.start, range.end);
  const cleaned = cleanComment(raw);
  const bl = Array.from(cleaned.matchAll(/\.(\w+)\s*\(\s*([\s\S]*?)\s*\)/g)).map((m) => [m[1], m[2]] as [string, string]);
  if (cleaned.includes('.*')) {
    const mname = (cleaned.match(/\w+/) || [''])[0];
    INDEX.lookupModule(mname).then((found) => {
      if (!found) {
        return;
      }
      const bound = bl.map((b) => b[0]);
      let dot = '';
      for (const p of found.info.port) {
        if (!bound.includes(p.name)) {
          dot += '.' + p.name + '(' + p.name + '),\n';
        }
      }
      if (dot !== '') {
        const idx = raw.indexOf('.*');
        raw = raw.slice(0, idx) + dot.slice(0, -2) + raw.slice(idx + 2);
      } else {
        const m = raw.match(/\.\*\s*(,)?/);
        if (m && m.index !== undefined) {
          raw = raw.slice(0, m.index) + raw.slice(m.index + m[0].length);
        }
      }
      applyDotStar(editor, range, raw);
    });
    return;
  }
  // Expand explicit bindings to .*
  const beginMatch = raw.match(/(\w+|\))\b\s*\w+\s*\(/);
  if (!beginMatch || beginMatch.index === undefined) {
    return;
  }
  let cnt = 0;
  const selfBindings = bl.filter((b) => b[0] === b[1]);
  for (const b of selfBindings) {
    const re = new RegExp('\\.' + b[0] + '\\s*\\(\\s*' + b[0] + '\\s*\\)\\s*(,)?');
    const m = raw.match(re);
    if (m && m.index !== undefined) {
      cnt++;
      let newRaw = raw.slice(0, m.index) + raw.slice(m.index + m[0].length);
      // remove the now-empty line
      const lineStart = newRaw.lastIndexOf('\n', m.index) + 1;
      const lineEnd = newRaw.indexOf('\n', lineStart);
      const line = newRaw.slice(lineStart, lineEnd === -1 ? newRaw.length : lineEnd);
      if (line.trim() === '') {
        const removeEnd = lineEnd === -1 ? newRaw.length : lineEnd + 1;
        newRaw = newRaw.slice(0, lineStart) + newRaw.slice(removeEnd);
      }
      raw = newRaw;
    }
  }
  if (cnt > 0) {
    const insertPos = raw.indexOf(beginMatch[0]) + beginMatch[0].length;
    const insert = cnt === bl.length ? '.*' : '.*,';
    raw = raw.slice(0, insertPos) + insert + raw.slice(insertPos);
  }
  applyDotStar(editor, range, raw);
}

function applyDotStar(editor: vscode.TextEditor, range: { start: number; end: number }, raw: string): void {
  const cfg = getConfig();
  const b = new VerilogBeautifier({
    nbSpace: (editor.options.tabSize as number) || 4,
    useTab: editor.options.insertSpaces === false,
    oneBindPerLine: cfg.oneBindPerLine,
    paramOneLine: cfg.paramOneline,
    instAlignPort: cfg.paramPortAlignment,
    alignComma: cfg.alignCommaSemicolon,
  });
  const ilvl = b.getIndentLevel(raw);
  let out = raw;
  try {
    const aligned = b.alignInstance(raw, ilvl);
    if (aligned) {
      out = aligned;
    }
  } catch {
    // keep raw
  }
  const startPos = editor.document.positionAt(range.start);
  const endPos = editor.document.positionAt(range.end);
  editor.edit((eb) => eb.replace(new vscode.Range(startPos, endPos), out));
}

export function registerInstantiation(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.instantiateModule',
      logger.command('systemverilog.instantiateModule', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await instantiateModule(editor);
        }
      })
    ),
    vscode.commands.registerCommand(
      'systemverilog.toggleDotStar',
      logger.command('systemverilog.toggleDotStar', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          toggleDotStar(editor);
        }
      })
    )
  );
}
