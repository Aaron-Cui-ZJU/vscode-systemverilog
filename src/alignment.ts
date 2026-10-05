import * as vscode from 'vscode';
import { VerilogBeautifier } from './beautifier';
import { getConfig } from './config';

export function makeBeautifier(reindentOnly: boolean, editor: vscode.TextEditor): VerilogBeautifier {
  const c = getConfig();
  const insertSpaces = editor.options.insertSpaces !== false;
  const tabSize = (editor.options.tabSize as number) || 4;
  return new VerilogBeautifier({
    nbSpace: tabSize,
    useTab: !insertSpaces,
    oneBindPerLine: c.oneBindPerLine,
    oneDeclPerLine: c.oneDeclPerLine,
    paramOneLine: c.paramOneline,
    indentSyle: c.indentStyle,
    reindentOnly,
    stripEmptyLine: c.stripEmptyLine,
    instAlignPort: c.paramPortAlignment,
    ignoreTick: c.alignmentIgnoreTick,
    importSameLine: c.modImportSameLine,
    alignComma: c.alignCommaSemicolon,
  });
}

function replaceRange(
  editor: vscode.TextEditor,
  range: vscode.Range,
  text: string,
  cursorOffsetInRange: number
): Thenable<boolean> {
  const start = editor.document.offsetAt(range.start);
  const applied = editor.edit((eb) => {
    eb.replace(range, text);
  });
  applied.then((ok) => {
    if (!ok) {
      return;
    }
    const pos = editor.document.positionAt(start + Math.min(cursorOffsetInRange, text.length));
    editor.selection = new vscode.Selection(pos, pos);
  });
  return applied;
}

export function align(editor: vscode.TextEditor, reindentOnly: boolean): void {
  const doc = editor.document;
  let range: vscode.Range;
  let cursorOffset = 0;
  if (!editor.selection.isEmpty) {
    range = new vscode.Range(editor.selection.start, editor.selection.end);
    cursorOffset = doc.offsetAt(editor.selection.active) - doc.offsetAt(range.start);
  } else {
    range = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    cursorOffset = doc.offsetAt(editor.selection.active);
  }
  const txt = doc.getText(range);
  const beautifier = makeBeautifier(reindentOnly, editor);
  let out: string;
  try {
    out = beautifier.beautifyText(txt);
  } catch (e) {
    vscode.window.showErrorMessage('SystemVerilog alignment failed: ' + (e as Error).message);
    return;
  }
  if (!out) {
    vscode.window.showInformationMessage('No alignment support for this block of code.');
    return;
  }
  if (out === txt) {
    return;
  }
  replaceRange(editor, range, out, cursorOffset);
}

export function registerAlignment(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('systemverilog.align', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        align(editor, false);
      }
    }),
    vscode.commands.registerCommand('systemverilog.reindent', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        align(editor, true);
      }
    })
  );
}
