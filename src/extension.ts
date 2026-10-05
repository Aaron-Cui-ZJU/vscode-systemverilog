import * as vscode from 'vscode';
import { registerAlignment } from './alignment';
import { registerCompletion } from './completion';
import { registerInstantiation } from './instantiation';
import { registerLint } from './lint';
import { registerNavigation } from './navigation';
import { INDEX, initIndex } from './indexer';
import { insertFsmTemplate } from './fsm';
import * as logger from './logger';

export function activate(context: vscode.ExtensionContext): void {
  logger.initLogger(context);
  logger.info('initializing workspace index');
  initIndex();

  registerNavigation(context);
  registerCompletion(context);
  registerAlignment(context);
  registerInstantiation(context);
  registerLint(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.insertFsmTemplate',
      logger.command('systemverilog.insertFsmTemplate', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await insertFsmTemplate(editor);
        }
      })
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        logger.debug(`invalidate index cache for ${d.uri.fsPath}`);
        INDEX.invalidate(d.uri);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        INDEX.invalidate(d.uri);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      logger.info('workspace folders changed, resetting index');
      initIndex();
    })
  );
  logger.info('SystemVerilog extension ready');
}

export function deactivate(): void {
  // nothing to do
}
