import * as vscode from 'vscode';
import * as path from 'path';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import { getConfig } from './config';
import * as logger from './logger';

// External language server integration. The client is generic: any LSP server
// whose command speaks the protocol over stdio can be plugged in through the
// `systemverilog.languageServer.*` settings. The defaults target `slang-server`,
// which reads its own `.slang/server.json` at the workspace root.
//
// The `vscode-languageclient` runtime is required lazily (see `requireClient`)
// rather than imported at the top level: the extension is published with
// `vsce publish --no-dependencies`, so `node_modules` is not shipped. A
// top-level import would therefore throw on activation while the LSP feature is
// disabled. Loading it only when a server is actually started keeps the packaged
// extension loadable without the dependency.
type LanguageClient = import('vscode-languageclient/node').LanguageClient;

let client: LanguageClient | null = null;

function requireClient(): typeof import('vscode-languageclient/node') {
  return require('vscode-languageclient/node');
}

function firstRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

// A bare command name is left untouched so the OS resolves it from PATH. A
// command that looks like a path (absolute, or containing a separator) is
// resolved relative to the first workspace folder when not absolute.
function resolveCommand(command: string, root: vscode.Uri | undefined): string {
  if (!command || path.isAbsolute(command)) {
    return command;
  }
  if (root && (command.includes('/') || command.includes('\\'))) {
    return path.join(root.fsPath, command);
  }
  return command;
}

function expandArgs(args: string[], root: vscode.Uri | undefined): string[] {
  if (!root) {
    return args;
  }
  return args.map((a) => a.replace(/\{root\}/g, root.fsPath));
}

function buildClient(): LanguageClient | null {
  const cfg = getConfig();
  if (!cfg.languageServerCommand.trim()) {
    logger.warn('language server: empty command, not starting');
    return null;
  }
  const lc = requireClient();
  const root = firstRoot();
  const command = resolveCommand(cfg.languageServerCommand.trim(), root);
  const args = expandArgs(cfg.languageServerArgs, root);
  const options = root ? { cwd: root.fsPath } : undefined;
  const serverOptions: ServerOptions = {
    run: { command, args, transport: lc.TransportKind.stdio, options },
    debug: { command, args, transport: lc.TransportKind.stdio, options },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'systemverilog' }],
    outputChannel: logger.getChannel(),
  };
  const c = new lc.LanguageClient(
    'systemverilog',
    'SystemVerilog Language Server',
    serverOptions,
    clientOptions
  );
  c.onDidChangeState((e) => logger.info(`language server state: ${e.newState}`));
  return c;
}

export async function startLanguageServer(): Promise<void> {
  if (client) {
    return;
  }
  // Disabled for now: the LSP integration is retained for future development but
  // `languageServerEnabled` is forced off in config, so this is a guard only.
  if (!getConfig().languageServerEnabled) {
    return;
  }
  const c = buildClient();
  if (!c) {
    return;
  }
  const cmd = getConfig().languageServerCommand.trim();
  try {
    await c.start();
    client = c;
    logger.info(`language server started: ${cmd}`);
  } catch (e) {
    logger.error('language server failed to start', e);
    try {
      await c.stop();
    } catch {
      // ignore stop errors on a client that never started
    }
    vscode.window.showErrorMessage(
      `SystemVerilog: failed to start language server "${cmd}". ` +
        'Download "slang-server" from ' +
        'https://github.com/hudson-trading/slang-server/releases (or set ' +
        'systemverilog.languageServer.command to your binary).'
    );
  }
}

export async function stopLanguageServer(): Promise<void> {
  if (!client) {
    return;
  }
  const c = client;
  client = null;
  try {
    await c.stop();
    logger.info('language server stopped');
  } catch (e) {
    logger.error('language server failed to stop', e);
  }
}

export async function restartLanguageServer(): Promise<void> {
  await stopLanguageServer();
  await startLanguageServer();
}

// Called from deactivate so the server process is torn down with the extension.
export function stopLanguageServerOnDeactivate(): Thenable<void> {
  return stopLanguageServer();
}

// Capability probes. They report whether the running server advertised each
// feature, so the built-in regex providers can keep serving when the server does
// not implement it (or has not finished initializing yet).
export function serverProvidesHover(): boolean {
  return !!client?.initializeResult?.capabilities.hoverProvider;
}

export function serverProvidesDocumentSymbol(): boolean {
  return !!client?.initializeResult?.capabilities.documentSymbolProvider;
}

export function serverProvidesCompletion(): boolean {
  return !!client?.initializeResult?.capabilities.completionProvider;
}
