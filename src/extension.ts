import * as vscode from 'vscode';
import { registerAlignment } from './alignment';
import { registerCompletion } from './completion';
import { registerInstantiation } from './instantiation';
import { registerLint } from './lint';
import { registerNavigation } from './navigation';
import { registerSettingsPanel } from './settingsPanel';
import { registerSymbols } from './symbols';
import { INDEX, initIndex } from './indexer';
import { insertFsmTemplate } from './fsm';
import { getConfig, invalidateConfigCache } from './config';
import * as logger from './logger';

export function activate(context: vscode.ExtensionContext): void {
  logger.initLogger(context);
  logger.info('initializing workspace index');
  initIndex();
  INDEX.start();

  registerNavigation(context);
  registerSettingsPanel(context);
  registerSymbols(context);
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

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{v,sv,vh,svh}');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((uri) => {
      logger.debug(`index: file created ${uri.fsPath}`);
      void INDEX.refresh(uri);
    }),
    watcher.onDidChange((uri) => {
      logger.debug(`index: file changed ${uri.fsPath}`);
      void INDEX.refresh(uri);
    }),
    watcher.onDidDelete((uri) => {
      logger.debug(`index: file deleted ${uri.fsPath}`);
      INDEX.remove(uri);
    }),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        logger.debug(`index: refresh after save ${d.uri.fsPath}`);
        void INDEX.refresh(d.uri);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d.languageId === 'systemverilog') {
        INDEX.invalidate(d.uri);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      logger.info('workspace folders changed, rebuilding index');
      initIndex();
      INDEX.start();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      invalidateConfigCache();
      if (
        e.affectsConfiguration('systemverilog.fileLists') ||
        e.affectsConfiguration('systemverilog.includeDirs')
      ) {
        logger.info('index settings changed, rebuilding index');
        void INDEX.rebuild();
      }
    })
  );

  const listWatcher = vscode.workspace.createFileSystemWatcher('**/*.{f,filelist}');
  const rebuildIfListed = (): void => {
    if (getConfig().fileLists.some((l) => l.file && l.base)) {
      logger.info('filelist changed, rebuilding index');
      void INDEX.rebuild();
    }
  };
  context.subscriptions.push(
    listWatcher,
    listWatcher.onDidCreate(rebuildIfListed),
    listWatcher.onDidChange(rebuildIfListed),
    listWatcher.onDidDelete(rebuildIfListed)
  );
  logger.info('SystemVerilog extension ready');
}

export function deactivate(): void {
  // nothing to do
}
