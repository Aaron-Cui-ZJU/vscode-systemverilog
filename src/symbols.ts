import * as vscode from 'vscode';
import { documentModuleInfo } from './documentCache';
import { getConfig } from './config';
import { serverProvidesDocumentSymbol } from './languageServer';
import * as logger from './logger';

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findInstanceRange(
  document: vscode.TextDocument,
  type: string,
  name: string
): vscode.Range | null {
  const text = document.getText();
  const re = new RegExp(
    '(?<![\\w.])' + esc(type) + '\\b\\s*(?:#\\s*\\([^;]*\\))?\\s*' + esc(name) + '\\b\\s*\\(',
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Only treat it as an instance when the type/name is the first thing on its
    // line (possibly indented, e.g. inside a generate block).
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prefix = text.slice(lineStart, m.index);
    if (prefix.trim() === '') {
      let lineEnd = text.indexOf('\n', m.index);
      if (lineEnd === -1) {
        lineEnd = text.length;
      }
      return new vscode.Range(document.positionAt(lineStart), document.positionAt(lineEnd));
    }
  }
  return null;
}

function moduleRange(document: vscode.TextDocument, name: string): vscode.Range {
  const text = document.getText();
  const re = new RegExp('^[ \\t]*module\\s+' + esc(name) + '\\b', 'm');
  const m = re.exec(text);
  if (!m) {
    return new vscode.Range(document.positionAt(0), document.positionAt(text.length));
  }
  const start = document.positionAt(m.index);
  const endRe = /^[ \t]*endmodule\b/m;
  endRe.lastIndex = m.index;
  const e = endRe.exec(text);
  const end = e ? document.positionAt(e.index + e[0].length) : document.positionAt(text.length);
  return new vscode.Range(start, end);
}

// Outline / Go to Symbol (Ctrl+Shift+O): only the module and its instantiations.
function moduleSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const mi = documentModuleInfo(document);
  if (!mi) {
    return [];
  }
  const rootRange = moduleRange(document, mi.name);
  const root = new vscode.DocumentSymbol(mi.name, mi.type, vscode.SymbolKind.Module, rootRange, rootRange);

  const children: vscode.DocumentSymbol[] = [];
  for (const inst of mi.inst) {
    if (!inst.type || !inst.name) {
      continue;
    }
    const r = findInstanceRange(document, inst.type as string, inst.name);
    if (r) {
      children.push(
        new vscode.DocumentSymbol(inst.name, inst.type as string, vscode.SymbolKind.Class, r, r)
      );
    }
  }
  root.children = children;
  return [root];
}

async function showInstances(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const document = editor.document;
  const mi = documentModuleInfo(document);
  if (!mi || !mi.inst.length) {
    logger.debug('showInstances: no instance found');
    vscode.window.showInformationMessage('No module instance found in the current module');
    return;
  }
  logger.info(`showInstances "${mi.name}": ${mi.inst.length} instance(s)`);
  const items: vscode.QuickPickItem[] = mi.inst.map((i) => ({
    label: i.name,
    description: i.type ?? '',
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Modules instantiated in ${mi.name}`,
    matchOnDescription: true,
  });
  if (!pick) {
    return;
  }
  const inst = mi.inst.find((i) => i.name === pick.label && (i.type ?? '') === pick.description);
  if (!inst) {
    return;
  }
  const r = findInstanceRange(document, inst.type as string, inst.name);
  if (r) {
    editor.selection = new vscode.Selection(r.start, r.start);
    editor.revealRange(r, vscode.TextEditorRevealType.InCenter);
  }
}

export function registerSymbols(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      [{ language: 'systemverilog' }, { language: 'verilog' }],
      {
        provideDocumentSymbols(document) {
          if (getConfig().languageServerEnabled && serverProvidesDocumentSymbol()) {
            // The language server owns document symbols when it advertises them.
            return undefined;
          }
          const syms = moduleSymbols(document);
          logger.debug(
            `documentSymbols: ${syms[0] ? syms[0].children.length : 0} instance(s) in ${document.fileName}`
          );
          return syms;
        },
      }
    ),
    vscode.commands.registerCommand(
      'systemverilog.showInstances',
      logger.command('systemverilog.showInstances', () => showInstances())
    )
  );
}
