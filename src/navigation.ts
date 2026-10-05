import * as vscode from 'vscode';
import { TypeInfo, getAllTypeInfo, getTypeInfo, cleanComment, parseModule } from './parser';
import { INDEX, getWordAt } from './indexer';
import { findDeclarationLine, findDriver, typeInfo } from './lookup';
import { getConfig } from './config';

let statusBar: vscode.StatusBarItem;
let lastHoverText = '';

export function registerNavigation(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('systemverilog.showType', () => showType()),
    vscode.commands.registerCommand('systemverilog.gotoDeclaration', () => gotoDeclaration()),
    vscode.commands.registerCommand('systemverilog.gotoDriver', () => gotoDriver()),
    vscode.commands.registerCommand('systemverilog.showHierarchy', () => showHierarchy()),
    vscode.commands.registerCommand('systemverilog.findInstance', () => findInstance()),
    vscode.commands.registerCommand('systemverilog.gotoBlockBoundary', () => blockBoundary('move')),
    vscode.commands.registerCommand('systemverilog.selectBlockBoundary', () => blockBoundary('select'))
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'systemverilog' }, {
      async provideHover(document, position) {
        const cfg = getConfig();
        if (cfg.hoverMaxSize === 0) {
          return undefined;
        }
        if (cfg.hoverMaxSize > 0 && Buffer.byteLength(document.getText(), 'utf8') > cfg.hoverMaxSize) {
          return undefined;
        }
        const word = currentWord(document, position);
        if (!word) {
          return undefined;
        }
        const ti = await typeInfo(document, word);
        if (!ti || !ti.type) {
          return undefined;
        }
        lastHoverText = formatTypeInfo(ti);
        const md = new vscode.MarkdownString(lastHoverText);
        return new vscode.Hover(md, document.getWordRangeAtPosition(position));
      },
    })
  );
}

function currentWord(document: vscode.TextDocument, position: vscode.Position): string {
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.selection.isEmpty && editor.selection.contains(position)) {
    return document.getText(editor.selection).trim();
  }
  return getWordAt(document, position);
}

export function formatTypeInfo(ti: TypeInfo): string {
  if (!ti) {
    return '';
  }
  const lines: string[] = [];
  const head = ti.tag ? `**${ti.tag}** ` : '';
  lines.push(head + '`' + (ti.decl || ti.name) + '`');
  if (ti.type && ti.decl && !ti.decl.includes(ti.type)) {
    lines.push('type: `' + ti.type + '`');
  }
  if (ti.value !== null && ti.value !== undefined && ti.value !== '') {
    lines.push('value: `' + ti.value + '`');
  }
  if (ti.port && ti.port.length) {
    lines.push('ports: ' + ti.port.map((p) => p.name).join(', '));
  }
  return lines.join('\n\n');
}

async function showType(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const word = selectedOrWord(editor);
  if (!word) {
    return;
  }
  const text = editor.document.getText();
  let ti = await typeInfo(editor.document, word);
  // If the word is a member access (X.word), try to resolve through struct/enum too.
  if (!ti || !ti.type) {
    const alt = getTypeInfo(cleanComment(text), word);
    if (alt && alt.type) {
      ti = alt;
    }
  }
  const cfg = getConfig();
  if (!ti || !ti.type) {
    vscode.window.showInformationMessage('No type information found for "' + word + '"');
    return;
  }
  const md = formatTypeInfo(ti);
  if (cfg.tooltip) {
    const editor2 = vscode.window.activeTextEditor!;
    const pos = editor2.selection.active;
    const hoverProvider = vscode.languages.registerHoverProvider(
      { language: 'systemverilog' },
      { provideHover: () => new vscode.Hover(new vscode.MarkdownString(md)) }
    );
    // show a transient message too, and dispose the temporary provider shortly after
    vscode.window.showInformationMessage(ti.decl || word);
    setTimeout(() => hoverProvider.dispose(), 4000);
  } else {
    statusBar.text = 'SV: ' + md.replace(/\*\*/g, '').replace(/`/g, '');
    statusBar.show();
  }
}

function selectedOrWord(editor: vscode.TextEditor): string {
  if (!editor.selection.isEmpty) {
    return editor.document.getText(editor.selection).trim();
  }
  return getWordAt(editor.document, editor.selection.active);
}

async function gotoDeclaration(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const word = selectedOrWord(editor);
  if (!word) {
    return;
  }
  // Search project symbols first (module/interface/package/class/function/task/typedef/macro).
  const syms = await INDEX.findSymbols(word);
  if (syms.length) {
    const target = syms[0];
    const doc = await vscode.workspace.openTextDocument(target.uri);
    const ed = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(target.line, 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    return;
  }
  const line = findDeclarationLine(editor.document.getText(), word);
  if (line >= 0) {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  } else {
    vscode.window.showInformationMessage('Declaration not found for "' + word + '"');
  }
}

function gotoDriver(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const word = selectedOrWord(editor);
  if (!word) {
    return;
  }
  const res = findDriver(editor.document.getText(), word);
  if (res) {
    const pos = new vscode.Position(res.line, Math.max(0, res.character));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  } else {
    vscode.window.showInformationMessage('Driver not found for "' + word + '"');
  }
}

async function showHierarchy(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const mi = parseModule(cleanComment(editor.document.getText()), '\\w+', false, false);
  if (!mi) {
    vscode.window.showWarningMessage('No module found in current file');
    return;
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  async function recurse(name: string, inst: string, level: number): Promise<void> {
    if (level > 40) {
      return;
    }
    const prefix = '    '.repeat(level);
    lines.push(prefix + (inst ? inst : name) + ' : ' + name);
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const found = await INDEX.lookupModule(name);
    if (!found || !found.info.inst) {
      return;
    }
    for (const sub of found.info.inst) {
      if (sub.type && sub.type !== 'module' && sub.type !== 'interface') {
        await recurse(sub.type, sub.name, level + 1);
      }
    }
  }
  await recurse(mi.name, '', 0);
  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'systemverilog' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function findInstance(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  let name = selectedOrWord(editor);
  const mi = parseModule(cleanComment(editor.document.getText()), '\\w+', false, false);
  if (!name && mi) {
    name = mi.name;
  }
  if (!name) {
    return;
  }
  const files = await INDEX.getAllFiles();
  const results: string[] = [];
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^[ \\t]*' + e + '\\b\\s*(#\\s*\\([^;]*\\))?\\s*(\\w+)\\s*\\(', 'gm');
  for (const uri of files) {
    const text = await INDEX.readFile(uri);
    let m: RegExpExecArray | null;
    const local = new RegExp(re.source, 'gm');
    while ((m = local.exec(text)) !== null) {
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      results.push(`${vscode.workspace.asRelativePath(uri)}:${line}  ${m[2]}`);
    }
  }
  if (!results.length) {
    vscode.window.showInformationMessage('No instance of "' + name + '" found');
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    content: 'Instances of ' + name + ':\n\n' + results.join('\n'),
    language: 'systemverilog',
  });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

const OPENERS: Record<string, string> = {
  begin: 'end',
  endmodule: '',
  module: 'endmodule',
  interface: 'endinterface',
  package: 'endpackage',
  class: 'endclass',
  function: 'endfunction',
  task: 'endtask',
  case: 'endcase',
  casex: 'endcase',
  casez: 'endcase',
  generate: 'endgenerate',
  fork: 'join',
};

function blockBoundary(cmd: 'move' | 'select'): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const text = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const match = findEnclosingBlock(text, offset);
  if (!match) {
    vscode.window.showInformationMessage('No block found at cursor');
    return;
  }
  const start = editor.document.positionAt(match.start);
  const end = editor.document.positionAt(match.end);
  if (cmd === 'select') {
    editor.selection = new vscode.Selection(start, end);
  } else {
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
  }
}

interface BlockMatch {
  start: number;
  end: number;
}

function findEnclosingBlock(text: string, offset: number): BlockMatch | null {
  const tokenRe = /\b(begin|end|module|endmodule|interface|endinterface|package|endpackage|class|endclass|function|endfunction|task|endtask|case|casex|casez|endcase|generate|endgenerate|fork|join|join_any|join_none)\b|[{}()\[\]]/g;
  const tokens: { text: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    tokens.push({ text: m[0], index: m.index });
  }
  const isOpener = (t: string) => t in OPENERS || t === '{' || t === '(' || t === '[';
  const closerFor = (t: string): string => {
    if (t === '{') {
      return '}';
    }
    if (t === '(') {
      return ')';
    }
    if (t === '[') {
      return ']';
    }
    return OPENERS[t] || '';
  };
  const matchesClose = (expected: string, t: string): boolean =>
    expected === 'join' ? t.startsWith('join') : t === expected;

  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (tok.index >= offset || !isOpener(tok.text)) {
      continue;
    }
    const close = closerFor(tok.text);
    if (!close) {
      continue;
    }
    const stack: string[] = [close];
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j].text;
      const c = closerFor(t);
      if (c) {
        stack.push(c);
      } else if (matchesClose(stack[stack.length - 1], t)) {
        stack.pop();
        if (stack.length === 0) {
          if (tokens[j].index >= offset) {
            return { start: tok.index, end: tokens[j].index + t.length };
          }
          break;
        }
      }
    }
  }
  return null;
}
