import * as vscode from 'vscode';
import { INDEX } from './indexer';
import { getEnumValues } from './parser';
import { cleanDocument, documentModuleInfo } from './documentCache';
import * as logger from './logger';

function signalNames(document: vscode.TextDocument) {
  const txt = cleanDocument(document);
  const mi = documentModuleInfo(document);
  return { txt, mi };
}

export function findUnused(document: vscode.TextDocument): { names: string[]; decls: Record<string, string> } {
  const { txt, mi } = signalNames(document);
  if (!mi) {
    return { names: [], decls: {} };
  }
  const sl = mi.signal.map((x) => x.name);
  const words = txt.match(/(?<!\.)\b\w+\b/g) || [];
  const counts = new Map<string, number>();
  for (const w of words) {
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const names = sl.filter((s) => (counts.get(s) || 0) === 1);
  const decls: Record<string, string> = {};
  for (const x of mi.signal) {
    if (names.includes(x.name) && x.decl) {
      decls[x.name] = x.decl;
    }
  }
  return { names, decls };
}

export async function findUndeclared(document: vscode.TextDocument): Promise<string[]> {
  const { txt, mi } = signalNames(document);
  if (!mi) {
    return [];
  }
  const reSig = /(?<!(?:\.|:|\$))\b([A-Za-z_]\w+)\b(?!:)/g;
  const collect = (s: string): string[] => s.match(reSig) || [];
  let signals: string[] = [];
  let m: RegExpExecArray | null;
  const assignRe = /^\s*(?:assign\s+)?(\w+\b\s*<?=[\s\S]*?);/gm;
  while ((m = assignRe.exec(txt)) !== null) {
    signals = signals.concat(collect(m[1]));
  }
  const sensRe = /@\s*\(([\s\S]*?)\)/g;
  while ((m = sensRe.exec(txt)) !== null) {
    const x = m[1].replace(/\b(pos|neg)?edge\b/g, '');
    signals = signals.concat(collect(x));
  }
  const bindRe = /\.([A-Za-z_]\w+)\s*\(([\s\S]*?)\)/g;
  while ((m = bindRe.exec(txt)) !== null) {
    signals = signals.concat(collect(m[2]));
  }
  const decl: string[] = [];
  for (const x of mi.signal) {
    if (x.tag === 'enum' && x.decl) {
      decl.push(...getEnumValues(x.decl));
    } else {
      decl.push(x.name);
    }
  }
  for (const x of mi.port) {
    decl.push(x.name);
  }
  for (const x of mi.param) {
    decl.push(x.name);
  }
  for (const x of mi.inst) {
    decl.push(x.name);
  }
  let unique = Array.from(new Set(signals));
  unique = unique.filter((s) => !['and', 'or', 'int'].includes(s));
  let undecl = unique.filter((s) => !decl.includes(s));
  if (undecl.length) {
    const impRe = /^\s*import\s*([\s\S]*?);/gm;
    const imps: string[] = [];
    while ((m = impRe.exec(txt)) !== null) {
      imps.push(m[1]);
    }
    if (imps.length) {
      const pkgDecl: string[] = [];
      const pkgs: string[] = [];
      for (const imp of imps) {
        const r = /\b(\w+)::/g;
        let pm: RegExpExecArray | null;
        while ((pm = r.exec(imp)) !== null) {
          pkgs.push(pm[1]);
        }
      }
      for (const pkg of pkgs) {
        const members = await INDEX.lookupPackage(pkg);
        if (members) {
          for (const x of members as any[]) {
            if (x.tag === 'decl' && x.name) {
              pkgDecl.push(x.name);
            } else if (x.tag === 'enum' && x.decl) {
              pkgDecl.push(...getEnumValues(x.decl));
            }
          }
        }
      }
      undecl = undecl.filter((x) => !pkgDecl.includes(x));
    }
  }
  return undecl;
}

export async function lint(document: vscode.TextDocument): Promise<void> {
  const undeclared = await findUndeclared(document);
  const { names } = findUnused(document);
  const s: string[] = [];
  if (undeclared.length) {
    s.push('Found undeclared signals: ' + undeclared.join(', '));
  }
  if (names.length) {
    s.push('Found unused signals: ' + names.join(', '));
  }
  logger.info(`lint ${vscode.workspace.asRelativePath(document.uri)}: ${undeclared.length} undeclared, ${names.length} unused`);
  if (s.length) {
    for (const line of s) {
      logger.info(line);
    }
    logger.show();
  } else {
    vscode.window.showInformationMessage('Linting successful: no issue found');
  }
}

export async function findUnusedInteractive(document: vscode.TextDocument): Promise<void> {
  const { names } = findUnused(document);
  if (!names.length) {
    vscode.window.showInformationMessage('No unused signal found');
    return;
  }
  const picks = await vscode.window.showQuickPick(
    names.map((n) => ({ label: n, picked: true })),
    { canPickMany: true, placeHolder: 'Select unused signals to remove (unselected are kept)' }
  );
  if (!picks || !picks.length) {
    return;
  }
  await deleteSignals(document, picks.map((p) => p.label));
}

export async function deleteSignals(document: vscode.TextDocument, signals: string[]): Promise<void> {
  const { txt, mi } = signalNames(document);
  if (!mi) {
    return;
  }
  const editor = await vscode.window.showTextDocument(document);
  const declByName: Record<string, string> = {};
  for (const x of mi.signal) {
    if (x.decl) {
      declByName[x.name] = x.decl;
    }
  }
  // Compute ranges in reverse order to keep offsets stable
  interface Del {
    start: number;
    end: number;
  }
  const deletes: Del[] = [];
  const used = new Set<number>();
  for (const s of signals) {
    const decl = declByName[s];
    if (decl) {
      const declRe = new RegExp('^\\s*' + escapeRe(decl.replace(/\s+/g, ' ')).replace(/ /g, '\\s+') + '\\s*;', 'm');
      const m = txt.match(declRe);
      if (m && m.index !== undefined) {
        const start = m.index;
        const end = start + m[0].length;
        if (!overlaps(deletes, start, end)) {
          deletes.push({ start, end });
          used.add(1);
          continue;
        }
      }
    }
    // inside a list: remove , name or name ,
    const re = new RegExp('(,\\s*)?\\b' + escapeRe(s) + '\\b(\\s*,)?', 'g');
    let m2: RegExpExecArray | null;
    const local = new RegExp(re.source, 'g');
    while ((m2 = local.exec(txt)) !== null) {
      const t = m2[0];
      if (t.startsWith(',')) {
        deletes.push({ start: m2.index, end: m2.index + m2[0].length });
        break;
      } else if (t.endsWith(',')) {
        deletes.push({ start: m2.index, end: m2.index + m2[0].length });
        break;
      }
    }
  }
  deletes.sort((a, b) => b.start - a.start);
  await editor.edit((eb) => {
    for (const d of deletes) {
      eb.delete(new vscode.Range(document.positionAt(d.start), document.positionAt(d.end)));
    }
  });
  vscode.window.showInformationMessage('Removed ' + new Set(deletes.map((d) => d.start)).size + ' declaration(s)');
}

function overlaps(dels: { start: number; end: number }[], start: number, end: number): boolean {
  return dels.some((d) => !(end <= d.start || start >= d.end));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerLint(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.lint',
      logger.command('systemverilog.lint', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          lint(editor.document);
        }
      })
    ),
    vscode.commands.registerCommand(
      'systemverilog.findUnusedSignals',
      logger.command('systemverilog.findUnusedSignals', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          findUnusedInteractive(editor.document);
        }
      })
    )
  );
}
