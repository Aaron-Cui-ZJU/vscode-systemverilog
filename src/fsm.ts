import * as vscode from 'vscode';
import { getAlwaysTemplate } from './completion';
import { getConfig } from './config';
import { INDEX } from './indexer';
import { cleanComment, getEnumValues, getTypeInfo, parseModule } from './parser';
import { caseTemplate } from './completion';

export async function insertFsmTemplate(editor: vscode.TextEditor): Promise<void> {
  const cfg = getConfig();
  const mi = parseModule(cleanComment(editor.document.getText()), '\\w+', false, false);
  if (!mi) {
    vscode.window.showWarningMessage('No module found in current file');
    return;
  }
  const til = mi.signal.filter((x) => !(x.decl || '').startsWith('typedef'));
  if (!til.length) {
    vscode.window.showInformationMessage('No signal available for FSM');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    til.map((x) => ({ label: x.name, description: (x.type || '') + ' ' + x.bw })),
    { placeHolder: 'Select the state signal' }
  );
  if (!pick) {
    return;
  }
  const ti = til.find((x) => x.name === pick.label)!;
  const caseIt = caseTemplate(editor.document, ti.name);
  if (!caseIt || !caseIt.snippet) {
    vscode.window.showWarningMessage('Could not build a case template for ' + ti.name);
    return;
  }
  const sigName = ti.name;
  const stateNext = sigName + '_next';
  let s = caseIt.snippet.replace(/\n/g, '\n\t');
  s = 'case (' + sigName + ')' + s;
  s = 'always_comb begin : proc_' + stateNext + '\n\t' + stateNext + ' = ' + sigName + ';\n\t' + s + '\nend';
  const [aL] = getAlwaysTemplate(editor.document);
  const isSv = /\.(sv|svh)$/i.test(editor.document.fileName);
  let seq = (isSv ? 'always_ff ' : 'always') + aL;
  seq = seq.split('$1').join(sigName);
  seq = seq.replace('<= 0', '<= ' + firstEnumValue(ti));
  seq = seq.split('$2').join(stateNext);
  // replace any remaining tabstops
  seq = seq.replace(/\$\d/g, sigName);
  let out = seq + '\n\n' + s;
  const indent = (editor.options.insertSpaces !== false ? ' '.repeat((editor.options.tabSize as number) || 4) : '\t');
  out = indent + out.replace(/\n/g, '\n' + indent);

  const insertPos = editor.selection.active;
  await editor.edit((eb) => eb.insert(insertPos, out));
  // Add state_next declaration next to state if missing
  const docText = editor.document.getText();
  if (!getTypeInfo(cleanComment(docText), stateNext).type) {
    const target = ti.type || '';
    const re = new RegExp(target + '[\\s\\S]+?' + sigName);
    const m = docText.match(re);
    if (m && m.index !== undefined) {
      const idx = m.index + m[0].lastIndexOf(sigName);
      const start = editor.document.positionAt(idx);
      const end = editor.document.positionAt(idx + sigName.length);
      editor.edit((eb) => eb.replace(new vscode.Range(start, end), sigName + ', ' + stateNext));
    }
  }
}

function firstEnumValue(ti: { decl: string | null; tag: string; type: string | null }): string {
  if (ti.decl && (ti.tag === 'enum' || (ti.type || '').split(/\s+/)[0] === 'enum')) {
    const vals = getEnumValues(ti.decl);
    if (vals.length) {
      return vals[0];
    }
  }
  return '0';
}
