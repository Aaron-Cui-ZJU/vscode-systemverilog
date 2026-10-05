import * as vscode from 'vscode';
import { registerAlignment } from './alignment';
import { registerCompletion } from './completion';
import { registerInstantiation } from './instantiation';
import { registerLint } from './lint';
import { registerNavigation } from './navigation';
import { INDEX, initIndex } from './indexer';
import { insertFsmTemplate } from './fsm';

export function activate(context: vscode.ExtensionContext): void {
  initIndex();

  registerNavigation(context);
  registerCompletion(context);
  registerAlignment(context);
  registerInstantiation(context);
  registerLint(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('systemverilog.insertFsmTemplate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await insertFsmTemplate(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        INDEX.invalidate(d.uri);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        INDEX.invalidate(d.uri);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      initIndex();
    })
  );
}

export function deactivate(): void {
  // nothing to do
}
