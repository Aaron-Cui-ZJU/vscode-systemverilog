import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;
let debugEnabled = false;

function ensure(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('SystemVerilog');
  }
  return channel;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function write(level: string, msg: string): void {
  ensure().appendLine(`[${stamp()}] [${level}] ${msg}`);
}

export function initLogger(context: vscode.ExtensionContext): void {
  const ch = ensure();
  context.subscriptions.push(ch);
  debugEnabled = vscode.workspace.getConfiguration('systemverilog').get<boolean>('debug', false);
  const pkg = (context.extension && (context.extension.packageJSON as any)) || {};
  write('INFO ', `SystemVerilog ${pkg.version ?? ''} activated (publisher: ${pkg.publisher ?? '?'}, debug: ${debugEnabled})`);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('systemverilog.debug')) {
        debugEnabled = vscode.workspace.getConfiguration('systemverilog').get<boolean>('debug', false);
        write('INFO ', `debug logging ${debugEnabled ? 'ENABLED' : 'disabled'}`);
      }
    })
  );
}

export function info(msg: string): void {
  write('INFO ', msg);
}

export function debug(msg: string): void {
  if (debugEnabled) {
    write('DEBUG', msg);
  }
}

export function warn(msg: string): void {
  write('WARN ', msg);
}

export function error(msg: string, err?: unknown): void {
  write('ERROR', msg);
  if (err) {
    const e = err as Error;
    ensure().appendLine(e && e.stack ? e.stack : String(e));
  }
}

export function show(): void {
  ensure().show(true);
}

export function isDebug(): boolean {
  return debugEnabled;
}

// Wrap a command handler so every invocation is logged and errors are reported.
export function command<T extends (...args: any[]) => any>(name: string, fn: T): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    info(`> ${name}`);
    const t0 = Date.now();
    try {
      const r = await fn(...args);
      debug(`< ${name} completed in ${Date.now() - t0}ms`);
      return r as ReturnType<T>;
    } catch (e) {
      error(`${name} failed`, e);
      vscode.window.showErrorMessage(`SystemVerilog: ${name} failed - ${(e as Error).message}`);
      throw e;
    }
  };
}
