import * as vscode from 'vscode';
import { TypeInfo, getAllTypeInfo, getTypeInfo } from './parser';
import { INDEX, getWordAt } from './indexer';
import { cleanDocument, documentModuleInfo } from './documentCache';
import { findDeclarationLine, findDriver, isAssignmentTarget, memberDeclaration, typeInfo } from './lookup';
import { enclosingModuleName } from './instances';
import { getConfig } from './config';
import { serverProvidesHover } from './languageServer';
import * as logger from './logger';

let statusBar: vscode.StatusBarItem;

export function registerNavigation(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.showType',
      logger.command('systemverilog.showType', () => showType())
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoDeclaration',
      logger.command('systemverilog.gotoDeclaration', () => gotoDeclaration())
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoDriver',
      logger.command('systemverilog.gotoDriver', () => gotoDriver())
    ),
    vscode.commands.registerCommand(
      'systemverilog.showHierarchy',
      logger.command('systemverilog.showHierarchy', () => showHierarchy())
    ),
    vscode.commands.registerCommand(
      'systemverilog.findInstance',
      logger.command('systemverilog.findInstance', () => findInstance())
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoInstantiator',
      logger.command('systemverilog.gotoInstantiator', (arg?: unknown) => gotoInstantiator(arg))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoBlockBoundary',
      logger.command('systemverilog.gotoBlockBoundary', () => blockBoundary('move'))
    ),
    vscode.commands.registerCommand(
      'systemverilog.selectBlockBoundary',
      logger.command('systemverilog.selectBlockBoundary', () => blockBoundary('select'))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoModule',
      logger.command('systemverilog.gotoModule', (arg?: unknown) => gotoModule(arg))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoClass',
      logger.command('systemverilog.gotoClass', (arg?: unknown) => gotoClass(arg))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoMember',
      logger.command('systemverilog.gotoMember', (arg?: unknown) => gotoMember(arg))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoPortReference',
      logger.command('systemverilog.gotoPortReference', (arg?: unknown) => gotoPortSignal(arg, 'reference'))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoPortDriver',
      logger.command('systemverilog.gotoPortDriver', (arg?: unknown) => gotoPortSignal(arg, 'driver'))
    ),
    vscode.commands.registerCommand(
      'systemverilog.gotoSignalUsers',
      logger.command('systemverilog.gotoSignalUsers', (arg?: unknown) => gotoSignalUsers(arg))
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider([{ language: 'systemverilog' }, { language: 'verilog' }], {
      async provideHover(document, position) {
        const cfg = getConfig();
        if (cfg.languageServerEnabled && serverProvidesHover()) {
          // The language server owns hover when it advertises the capability;
          // returning undefined lets its hover provider answer instead.
          return undefined;
        }
        if (cfg.hoverMaxSize === 0) {
          return undefined;
        }
        if (cfg.hoverMaxSize > 0 && Buffer.byteLength(document.getText(), 'utf8') > cfg.hoverMaxSize) {
          return undefined;
        }
        const binding = findPortBindingAt(document, position);
        if (binding) {
          const bindingMd = await buildPortHover(binding);
          if (bindingMd) {
            return new vscode.Hover(bindingMd, document.getWordRangeAtPosition(position));
          }
        }
        const word = currentWord(document, position);
        if (!word) {
          return undefined;
        }
        const md = await buildHover(document, word, position);
        if (!md) {
          return undefined;
        }
        // Hovering the net wired into an input port also offers the fan-out below
        // the instance, without replacing the hover for the net itself.
        const conn = findPortConnectionAt(document, position);
        if (conn) {
          const dir = await portDirection(conn.moduleType, conn.port);
          if (dir === 'input' || dir === 'inout') {
            md.appendMarkdown(
              '\n\n' +
                commandLink(`Go to modules using \`${conn.port}\``, 'systemverilog.gotoSignalUsers', conn)
            );
          }
        }
        return new vscode.Hover(md, document.getWordRangeAtPosition(position));
      },
    })
  );
}

function commandLink(label: string, command: string, arg: unknown): string {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify(arg))})`;
}

// True when `position` sits on the name of a `module` / `interface` declaration
// (as opposed to a reference to it elsewhere).
function isModuleDeclarationName(document: vscode.TextDocument, position: vscode.Position): boolean {
  // Probe up to the start of the word, not the (possibly mid-word) hover point.
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w$]*/);
  const start = range ? range.start : position;
  const prefix = document.getText(new vscode.Range(new vscode.Position(start.line, 0), start));
  return /\b(?:module|interface)\s+(?:automatic\s+|static\s+)?$/.test(prefix);
}

// Build the hover markdown, including a clickable link to the module definition
// when hovering an instantiation (its instance name or its module type).
async function buildHover(
  document: vscode.TextDocument,
  word: string,
  position: vscode.Position
): Promise<vscode.MarkdownString | undefined> {
  // 1) The word is a module / interface defined somewhere in the workspace.
  const modSyms = await INDEX.findSymbols(word, ['module', 'interface']);
  if (modSyms.length) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    if (isModuleDeclarationName(document, position)) {
      // On the declaration itself, jumping to the definition would be a no-op,
      // so offer only the jump to the modules that instantiate it instead.
      md.appendMarkdown('**' + modSyms[0].kind + '** `' + word + '`');
      md.appendMarkdown(
        '\n\n' +
          commandLink('Go to instantiating module of `' + word + '`', 'systemverilog.gotoInstantiator', {
            name: word,
          })
      );
    } else {
      md.appendMarkdown(commandLink('Go to module definition of `' + word + '`', 'systemverilog.gotoModule', { name: word }));
      md.appendMarkdown(`\n\n_${vscode.workspace.asRelativePath(modSyms[0].uri)}_`);
    }
    return md;
  }

  // 1b) The word is a class defined somewhere in the workspace (e.g. the base
  // class in `extends Base`).
  const classSyms = await INDEX.findSymbols(word, ['class']);
  if (classSyms.length) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown('**class** `' + word + '`');
    md.appendMarkdown('\n\n' + classDefinitionLink(word, classSyms[0].uri));
    return md;
  }

  // 2) Instance name: resolve the instantiated module from the current file.
  const mi = documentModuleInfo(document);
  let instanceType: string | null = null;
  if (mi) {
    const inst = mi.inst.find((i) => i.name === word);
    if (inst && inst.type) {
      instanceType = inst.type;
    }
  }

  const ti = await typeInfo(document, word);
  if (!instanceType && ti && ti.tag === 'inst' && ti.type) {
    instanceType = ti.type.split(/\s+/)[0];
  }

  if (instanceType) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    if (ti && ti.type) {
      md.appendMarkdown(formatTypeInfo(ti));
    } else {
      md.appendMarkdown('**instance** `' + word + '` of `' + instanceType + '`');
    }
    const targets = await INDEX.findSymbols(instanceType, ['module', 'interface']);
    if (targets.length) {
      md.appendMarkdown(
        '\n\n' +
          commandLink('Go to module definition of `' + instanceType + '`', 'systemverilog.gotoModule', {
            name: instanceType,
          })
      );
      md.appendMarkdown(`\n\n_${vscode.workspace.asRelativePath(targets[0].uri)}_`);
    }
    return md;
  }

  // 3) A class member (variable, function or task), possibly inherited from a
  // base class in another file. For a variable, link to the definition of its
  // type (class / interface); for a function or task, link to its own body.
  const decl = await memberDeclaration(document, position, word);
  if (decl) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(formatTypeInfo(decl.member));
    const memberType = !decl.isFunction && decl.member.type ? decl.member.type.split(/\s+/)[0] : '';
    const typeLink = memberType ? await typeDefinitionLink(memberType) : null;
    if (typeLink) {
      md.appendMarkdown('\n\n' + typeLink);
    } else {
      md.appendMarkdown('\n\n' + memberDefinitionLink(word, decl.ownerUri, decl.line));
    }
    return md;
  }

  // 4) A plain signal whose type is a class / interface: link its definition.
  if (ti && ti.type) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(formatTypeInfo(ti));
    const typeLink = await typeDefinitionLink(ti.type.split(/\s+/)[0]);
    if (typeLink) {
      md.appendMarkdown('\n\n' + typeLink);
    }
    return md;
  }

  return undefined;
}

// Link to the definition of a user defined type: a class, interface or module.
async function typeDefinitionLink(typeName: string): Promise<string | null> {
  if (!typeName) {
    return null;
  }
  const cls = await INDEX.lookupClass(typeName);
  if (cls) {
    return classDefinitionLink(typeName, cls.uri);
  }
  const syms = await INDEX.findSymbols(typeName, ['module', 'interface']);
  if (syms.length) {
    return (
      commandLink('Go to definition of `' + typeName + '`', 'systemverilog.gotoModule', { name: typeName }) +
      `\n\n_${vscode.workspace.asRelativePath(syms[0].uri)}_`
    );
  }
  return null;
}

function memberDefinitionLink(name: string, uri: vscode.Uri, line: number): string {
  return (
    commandLink('Go to definition of `' + name + '`', 'systemverilog.gotoMember', {
      uri: uri.toString(),
      line,
    }) + `\n\n_${vscode.workspace.asRelativePath(uri)}_`
  );
}

function classDefinitionLink(name: string, uri: vscode.Uri): string {
  return (
    commandLink('Go to class definition of `' + name + '`', 'systemverilog.gotoClass', { name }) +
    `\n\n_${vscode.workspace.asRelativePath(uri)}_`
  );
}

async function gotoModule(arg?: unknown): Promise<void> {
  let name: string | undefined;
  if (typeof arg === 'string') {
    name = arg;
  } else if (arg && typeof arg === 'object' && typeof (arg as { name?: string }).name === 'string') {
    name = (arg as { name: string }).name;
  }
  if (!name) {
    return;
  }
  const syms = await INDEX.findSymbols(name, ['module', 'interface']);
  if (!syms.length) {
    logger.debug(`gotoModule "${name}": not found`);
    vscode.window.showInformationMessage('Module not found: ' + name);
    return;
  }
  const target = syms[0];
  logger.info(`gotoModule "${name}" -> ${vscode.workspace.asRelativePath(target.uri)}:${target.line + 1}`);
  const doc = await vscode.workspace.openTextDocument(target.uri);
  const ed = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(target.line, 0);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function gotoClass(arg?: unknown): Promise<void> {
  let name: string | undefined;
  if (typeof arg === 'string') {
    name = arg;
  } else if (arg && typeof arg === 'object' && typeof (arg as { name?: string }).name === 'string') {
    name = (arg as { name: string }).name;
  }
  if (!name) {
    return;
  }
  const syms = await INDEX.findSymbols(name, ['class']);
  if (!syms.length) {
    logger.debug(`gotoClass "${name}": not found`);
    vscode.window.showInformationMessage('Class not found: ' + name);
    return;
  }
  const target = syms[0];
  logger.info(`gotoClass "${name}" -> ${vscode.workspace.asRelativePath(target.uri)}:${target.line + 1}`);
  const doc = await vscode.workspace.openTextDocument(target.uri);
  const ed = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(target.line, 0);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function gotoMember(arg?: unknown): Promise<void> {
  if (!arg || typeof arg !== 'object') {
    return;
  }
  const a = arg as { uri?: unknown; line?: unknown };
  if (typeof a.uri !== 'string' || typeof a.line !== 'number') {
    return;
  }
  const uri = vscode.Uri.parse(a.uri);
  logger.info(`gotoMember -> ${vscode.workspace.asRelativePath(uri)}:${a.line + 1}`);
  const pos = new vscode.Position(Math.max(0, a.line), 0);
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === uri.toString()) {
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      await vscode.window.showTextDocument(editor.document, editor.viewColumn);
      return;
    }
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed = await vscode.window.showTextDocument(doc);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

interface PortBinding {
  moduleType: string;
  port: string;
}

// Detect whether `position` sits on the formal port name of an instantiation
// binding such as `.clk (clk)` (the word before the parenthesis) and return the
// instantiated module type together with the port name.
function findPortBindingAt(document: vscode.TextDocument, position: vscode.Position): PortBinding | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const bindRe = /\.\s*([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = bindRe.exec(text)) !== null) {
    const name = m[1];
    const nameOffset = m.index + m[0].indexOf(name);
    if (nameOffset > offset) {
      break;
    }
    if (offset < nameOffset + name.length) {
      const openParen = enclosingParenOpen(text, nameOffset);
      if (openParen < 0) {
        return null;
      }
      const moduleType = instanceTypeBefore(text, openParen);
      if (moduleType) {
        return { moduleType, port: name };
      }
      return null;
    }
  }
  return null;
}

// Detect whether `position` sits on the net connected to a port binding, e.g. on
// `sig` in `.clk (sig)`, and return the instantiated module and its port.
function findPortConnectionAt(
  document: vscode.TextDocument,
  position: vscode.Position
): PortBinding | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const bindRe = /\.\s*([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = bindRe.exec(text)) !== null) {
    // The last occurrence of the connection name is the one inside the parens,
    // even when the port and the net share a name (`.clk (clk)`).
    const sigStart = m.index + m[0].lastIndexOf(m[2]);
    if (offset < sigStart) {
      break;
    }
    if (offset < sigStart + m[2].length) {
      const openParen = enclosingParenOpen(text, m.index + m[0].indexOf(m[1]));
      if (openParen < 0) {
        return null;
      }
      const moduleType = instanceTypeBefore(text, openParen);
      return moduleType ? { moduleType, port: m[1] } : null;
    }
  }
  return null;
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

// Offset of the innermost `(` enclosing `offset`, or -1.
function enclosingParenOpen(text: string, offset: number): number {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')') {
      depth += 1;
    } else if (c === '(') {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

// Read the module type of the instantiation whose port-list `(` is at `portListOpen`,
// e.g. `foo u_foo (`, `foo #(...) u_foo (` or `foo u_foo [3:0] (`.
function instanceTypeBefore(text: string, portListOpen: number): string | null {
  let i = portListOpen - 1;
  while (i >= 0 && /\s/.test(text[i])) {
    i -= 1;
  }
  // Skip an optional array range after the instance name: `u_foo [3:0] (`.
  if (text[i] === ']') {
    let depth = 1;
    i -= 1;
    while (i >= 0 && depth > 0) {
      if (text[i] === ']') {
        depth += 1;
      } else if (text[i] === '[') {
        depth -= 1;
      }
      i -= 1;
    }
    while (i >= 0 && /\s/.test(text[i])) {
      i -= 1;
    }
  }
  const nameEnd = i + 1;
  while (i >= 0 && isIdentChar(text[i])) {
    i -= 1;
  }
  const instName = text.slice(i + 1, nameEnd);
  if (!/^[A-Za-z_]/.test(instName)) {
    return null;
  }
  while (i >= 0 && /\s/.test(text[i])) {
    i -= 1;
  }
  // Skip an optional parameter override before the instance name: `foo #(...) u_foo (`.
  if (text[i] === ')') {
    let depth = 1;
    i -= 1;
    while (i >= 0 && depth > 0) {
      if (text[i] === ')') {
        depth += 1;
      } else if (text[i] === '(') {
        depth -= 1;
      }
      i -= 1;
    }
    while (i >= 0 && (text[i] === '#' || /\s/.test(text[i]))) {
      i -= 1;
    }
  }
  const typeEnd = i + 1;
  while (i >= 0 && isIdentChar(text[i])) {
    i -= 1;
  }
  const type = text.slice(i + 1, typeEnd);
  if (!/^[A-Za-z_]/.test(type) || ['module', 'interface', 'function', 'task', 'program'].includes(type)) {
    return null;
  }
  return type;
}

// Return the index of the parenthesis matching the `(` at `open`, or -1.
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

// Theme-aware colors used to make the port direction stand out in the hover.
// Defaults live in config (systemverilog.portDirectionColors).
function directionBadge(dir: string, colors: Record<string, string>): string {
  const color = colors[dir];
  if (!color) {
    return dir;
  }
  return `<span style="color:${color};">${dir}</span>`;
}

// Build the hover for a port binding: show the port declaration / direction and
// a link that jumps inside the instantiated module (first use for inputs,
// driver for outputs).
async function buildPortHover(binding: PortBinding): Promise<vscode.MarkdownString | undefined> {
  const found = await INDEX.lookupModule(binding.moduleType);
  if (!found) {
    return undefined;
  }
  const port = found.info.port.find((p) => p.name === binding.port);
  if (!port) {
    return undefined;
  }
  const decl = (port.decl || port.name).trim();
  const dir = (
    (decl.match(/^(input|output|inout|ref)\b/) || [])[1] ||
    ((port.type || '').match(/^(input|output|inout|ref)\b/) || [])[0] ||
    ''
  ).trim();
  const colors = getConfig().portDirectionColors;
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;
  md.appendMarkdown(`**${binding.moduleType}** port \`${decl}\``);
  if (dir) {
    md.appendMarkdown(`\n\ndirection: ${directionBadge(dir, colors)}`);
  }
  if (dir === 'output') {
    md.appendMarkdown(
      '\n\n' +
        commandLink(`Go to driver of \`${binding.port}\``, 'systemverilog.gotoPortDriver', {
          module: binding.moduleType,
          port: binding.port,
        })
    );
  } else if (dir === 'input' || dir === 'inout') {
    md.appendMarkdown(
      '\n\n' +
        commandLink(`Go to modules using \`${binding.port}\``, 'systemverilog.gotoSignalUsers', {
          module: binding.moduleType,
          port: binding.port,
        })
    );
  }
  md.appendMarkdown(`\n\n_${vscode.workspace.asRelativePath(found.uri)}_`);
  return md;
}

interface PortNavArgument {
  module?: string;
  port?: string;
}

function parsePortNavArg(arg: unknown): PortNavArgument | null {
  if (typeof arg === 'string') {
    return { port: arg };
  }
  if (arg && typeof arg === 'object') {
    const a = arg as { module?: unknown; port?: unknown };
    return {
      module: typeof a.module === 'string' ? a.module : undefined,
      port: typeof a.port === 'string' ? a.port : undefined,
    };
  }
  return null;
}

// Jump inside the instantiated module: to the first use of an input/inout port,
// or to the driver of an output port. Returns true when a jump was performed.
async function gotoPortSignal(arg: unknown, kind: 'reference' | 'driver'): Promise<boolean> {
  const a = parsePortNavArg(arg);
  if (!a || !a.port) {
    return false;
  }
  let moduleName = a.module;
  if (!moduleName) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const mi = documentModuleInfo(editor.document);
      moduleName = mi ? mi.name : undefined;
    }
  }
  if (!moduleName) {
    return false;
  }
  if (kind === 'driver') {
    // Follow wrapper levels that only pass the port along, so the jump lands where
    // the signal is actually assigned rather than on the nearest binding.
    const hop = await resolvePortDriver(moduleName, a.port);
    if (hop) {
      logger.info(
        `gotoPort driver "${a.port}" in ${moduleName} -> ${vscode.workspace.asRelativePath(hop.uri)} (${hop.hops} hop(s))`
      );
      await openAt(hop.uri, hop.offset);
      return true;
    }
    logger.debug(`gotoPort driver "${a.port}": no driver found in ${moduleName}`);
    vscode.window.showInformationMessage(`No driver of "${a.port}" found in ${moduleName}`);
    return false;
  }
  const syms = await INDEX.findSymbols(moduleName, ['module', 'interface']);
  for (const s of syms) {
    const text = await INDEX.readFile(s.uri);
    const range = findModuleRange(text, moduleName);
    if (!range) {
      continue;
    }
    const offset = findFirstUseAt(text, a.port, range);
    if (offset !== null) {
      logger.info(
        `gotoPort ${kind} "${a.port}" in ${moduleName} -> ${vscode.workspace.asRelativePath(s.uri)}`
      );
      await openAt(s.uri, offset);
      return true;
    }
  }
  logger.debug(`gotoPort ${kind} "${a.port}": not found in ${moduleName}`);
  vscode.window.showInformationMessage(`No ${kind} of "${a.port}" found in ${moduleName}`);
  return false;
}

interface SubmoduleDriver {
  offset: number;
  moduleType: string;
  port: string;
}

// Find, in the current document, an instance port that drives `signal` (an
// output/inout of a submodule bound to `signal`) and resolve it through the index.
async function resolveSubmoduleDriver(
  document: vscode.TextDocument,
  signal: string
): Promise<SubmoduleDriver | null> {
  const text = document.getText();
  const mi = documentModuleInfo(document);
  if (!mi) {
    return null;
  }
  const range = findModuleRange(text, mi.name);
  if (!range) {
    return null;
  }
  return findSubmoduleDriverAt(text, signal, range);
}

async function openAt(uri: vscode.Uri, offset: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const ed = await vscode.window.showTextDocument(doc);
  const pos = doc.positionAt(offset);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function goToLine(editor: vscode.TextEditor, line: number, character: number): void {
  const pos = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

interface TextSpan {
  start: number;
  end: number;
  bodyStart: number;
}

// Locate the definition of a module/interface inside `text`.
function findModuleRange(text: string, name: string): TextSpan | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('\\b(?:module|interface)\\s+' + esc + '\\b[\\s\\S]*?\\bend(?:module|interface)\\b').exec(text);
  if (!m) {
    return null;
  }
  const start = m.index;
  const end = m.index + m[0].length;
  const semi = text.indexOf(';', start);
  const bodyStart = semi >= 0 && semi < end ? semi + 1 : start;
  return { start, end, bodyStart };
}

type Span = [number, number];

// Compute the offset intervals occupied by comments and string literals.
function commentSpans(text: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'string' = 'code';
  let start = 0;
  while (i < text.length) {
    const c = text[i];
    const n = i + 1 < text.length ? text[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        start = i;
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'block';
        start = i;
        i += 2;
        continue;
      }
      if (c === '"') {
        state = 'string';
        start = i;
        i += 1;
        continue;
      }
    } else if (state === 'line') {
      if (c === '\n') {
        out.push([start, i]);
        state = 'code';
      }
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        out.push([start, i + 2]);
        state = 'code';
        i += 2;
        continue;
      }
    } else if (state === 'string') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        out.push([start, i + 1]);
        state = 'code';
      }
    }
    i += 1;
  }
  if (state !== 'code') {
    out.push([start, text.length]);
  }
  return out;
}

function inSpans(spans: Span[], offset: number): boolean {
  for (const [s, e] of spans) {
    if (s > offset) {
      break;
    }
    if (offset >= s && offset < e) {
      return true;
    }
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// First occurrence of `signal` inside the module body (ignoring comments/strings).
function findFirstUseAt(text: string, signal: string, range: TextSpan): number | null {
  const re = new RegExp('\\b' + escapeRe(signal) + '\\b', 'g');
  const spans = commentSpans(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const off = m.index;
    if (off < range.bodyStart) {
      continue;
    }
    if (off >= range.end) {
      break;
    }
    if (inSpans(spans, off)) {
      continue;
    }
    return off;
  }
  return null;
}

// Location where `signal` is driven inside the module body by an assignment.
// The optional `[...]` handles indexed targets used in generate loops.
function findAssignmentDriverAt(text: string, signal: string, range: TextSpan): number | null {
  const esc = escapeRe(signal);
  const body = text.slice(range.bodyStart, range.end);
  const base = range.bodyStart;
  const spans = commentSpans(text);
  // Assignment target, including a signal inside a concatenation lvalue such as
  // `{a, sig, b} = expr;` (possibly split across lines). `isAssignmentTarget`
  // expects offsets into the full `text`.
  const occRe = new RegExp('\\b' + esc + '\\b', 'g');
  let om: RegExpExecArray | null;
  while ((om = occRe.exec(body)) !== null) {
    const off = base + om.index;
    if (inSpans(spans, off)) {
      continue;
    }
    if (isAssignmentTarget(text, off, signal.length)) {
      return off;
    }
  }
  const patterns = [
    '(?:^|[^\\w.])(' + esc + ')\\b(?:\\s*\\[[^\\]]*\\])*\\s*(?:<=|=)(?!=)',
    '\\bassign\\b[^;\\n]*\\b(' + esc + ')\\b(?:\\s*\\[[^\\]]*\\])*\\s*=',
  ];
  for (const source of patterns) {
    const re = new RegExp(source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const off = base + m.index + m[0].indexOf(m[1]);
      if (inSpans(spans, off)) {
        continue;
      }
      return off;
    }
  }
  return null;
}

// Port declaration of `signal` in `text`, either in the module header (ANSI) or in
// the body. Used as the last resort for a port that nothing drives locally: it
// still puts the cursor in the module that owns the port.
function findPortDeclAt(text: string, signal: string): number | null {
  const esc = escapeRe(signal);
  const spans = commentSpans(text);
  const re = new RegExp('^[ \\t]*(?:input|output|inout|ref)\\b[^;\\n]*\\b(' + esc + ')\\b', 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const off = m.index + m[0].indexOf(m[1]);
    if (inSpans(spans, off)) {
      continue;
    }
    return off;
  }
  return null;
}

// Location where `signal` is driven by being connected to an output of a
// submodule instance (including instances inside a generate block).
async function findSubmoduleDriverAt(
  text: string,
  signal: string,
  range: TextSpan
): Promise<SubmoduleDriver | null> {
  const body = text.slice(range.bodyStart, range.end);
  const base = range.bodyStart;
  const spans = commentSpans(text);
  const signalRe = new RegExp('\\b' + escapeRe(signal) + '\\b');
  const dirCache = new Map<string, string | null>();
  const portRe = /\.\s*([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = portRe.exec(body)) !== null) {
    const portName = m[1];
    const nameOffset = m.index + m[0].indexOf(portName);
    const openParen = enclosingParenOpen(body, nameOffset);
    if (openParen < 0) {
      continue;
    }
    const moduleType = instanceTypeBefore(body, openParen);
    if (!moduleType) {
      continue;
    }
    const connOpen = m.index + m[0].length - 1;
    const connClose = matchParen(body, connOpen);
    if (connClose === -1) {
      continue;
    }
    const conn = body.slice(connOpen + 1, connClose);
    if (!signalRe.test(conn)) {
      continue;
    }
    const off = base + connOpen + 1 + conn.search(signalRe);
    if (inSpans(spans, off)) {
      continue;
    }
    const key = moduleType + '::' + portName;
    let dir = dirCache.get(key);
    if (dir === undefined) {
      dir = await portDirection(moduleType, portName);
      dirCache.set(key, dir);
    }
    if (dir === 'output' || dir === 'inout') {
      return { offset: off, moduleType, port: portName };
    }
  }
  return null;
}

async function portDirection(moduleType: string, portName: string): Promise<string | null> {
  const found = await INDEX.lookupModule(moduleType);
  if (!found) {
    return null;
  }
  const port = found.info.port.find((p) => p.name === portName);
  if (!port) {
    return null;
  }
  const decl = (port.decl || port.name).trim();
  return (
    (decl.match(/^(input|output|inout|ref)\b/) || [])[1] ||
    ((port.type || '').match(/^(input|output|inout|ref)\b/) || [])[0] ||
    null
  );
}

interface DriverHop {
  uri: vscode.Uri;
  offset: number;
  module: string;
  port: string;
  hops: number;
}

// Follow one port down the hierarchy while a module only connects it onward (its
// port is bound to the output of a deeper instance), so a chain of wrapper levels
// does not stop the jump. The deepest module that actually assigns the signal
// wins; the last resolvable connection is used when the chain ends without one.
const MAX_DRIVER_HOPS = 16;

async function resolvePortDriver(
  moduleType: string,
  port: string,
  visited: Set<string> = new Set(),
  hops: number = 0
): Promise<DriverHop | null> {
  const key = moduleType + '::' + port;
  if (hops > MAX_DRIVER_HOPS || visited.has(key)) {
    return null;
  }
  visited.add(key);
  const syms = await INDEX.findSymbols(moduleType, ['module', 'interface']);
  for (const s of syms) {
    const text = await INDEX.readFile(s.uri);
    const range = findModuleRange(text, moduleType);
    if (!range) {
      continue;
    }
    const assigned = findAssignmentDriverAt(text, port, range);
    if (assigned !== null) {
      return { uri: s.uri, offset: assigned, module: moduleType, port, hops };
    }
    const sd = await findSubmoduleDriverAt(text, port, range);
    if (sd) {
      const deeper = await resolvePortDriver(sd.moduleType, sd.port, visited, hops + 1);
      if (deeper) {
        return deeper;
      }
      // The deeper module is unknown or has no driver: stop at the binding.
      return { uri: s.uri, offset: sd.offset, module: moduleType, port, hops };
    }
    const decl = findPortDeclAt(text, port);
    if (decl !== null) {
      return { uri: s.uri, offset: decl, module: moduleType, port, hops };
    }
  }
  return null;
}

interface InputDriverCandidate {
  uri: vscode.Uri;
  text: string;
  parent: string;
  instance: string;
  line: number;
  offset: number;
  signal: string | null;
}

function lineStartOffset(text: string, line: number): number {
  let off = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', off);
    if (nl < 0) {
      return off;
    }
    off = nl + 1;
  }
  return off;
}

// Binding of `port` in one instantiation: where the connection expression starts
// and, when it is a plain identifier, the net that feeds the port. `.*` counts as
// an implicit same-name connection.
function findPortBindingIn(
  text: string,
  instance: string,
  line: number,
  port: string
): { offset: number; signal: string | null } | null {
  const lineStart = lineStartOffset(text, line);
  const escPort = escapeRe(port);
  let nameAt = text.indexOf(instance, lineStart);
  while (nameAt >= 0) {
    const open = portListOpenAfter(text, nameAt + instance.length);
    if (open >= 0) {
      const close = matchParen(text, open);
      if (close < 0) {
        return null;
      }
      const body = text.slice(open + 1, close);
      const m = new RegExp('\\.\\s*' + escPort + '\\s*\\(').exec(body);
      if (m) {
        const connOpen = open + 1 + m.index + m[0].length - 1;
        const connClose = matchParen(text, connOpen);
        if (connClose < 0) {
          return null;
        }
        const raw = text.slice(connOpen + 1, connClose);
        const expr = raw.trim();
        const offset = connOpen + 1 + (raw.length - raw.trimStart().length);
        return { offset, signal: /^[A-Za-z_]\w*$/.test(expr) ? expr : null };
      }
      const implicitAt = body.search(/\.\s*\*/);
      if (implicitAt >= 0) {
        return { offset: open + 1 + implicitAt, signal: port };
      }
      return null;
    }
    nameAt = text.indexOf(instance, nameAt + 1);
  }
  return null;
}

// Port-list `(` right after an instance name, or -1 when `from` does not sit on an
// instance name (a `#(` parameter override means the identifier was the module
// type, so the caller keeps looking). Skips an optional array range `[...]`.
function portListOpenAfter(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  if (text[i] === '#') {
    return -1;
  }
  if (text[i] === '[') {
    let depth = 0;
    while (i < text.length) {
      if (text[i] === '[') {
        depth += 1;
      } else if (text[i] === ']') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
    while (i < text.length && /\s/.test(text[i])) {
      i += 1;
    }
  }
  return text[i] === '(' ? i : -1;
}

// Every instantiation of `moduleName` that binds `port`, resolved to the parent
// text and the binding position. At most `maxSignalUsers` are returned for the
// picker.
async function collectInputCandidates(
  moduleName: string,
  port: string
): Promise<InputDriverCandidate[]> {
  const sites = await INDEX.findInstantiations(moduleName);
  const max = getConfig().maxSignalUsers;
  const candidates: InputDriverCandidate[] = [];
  const seen = new Set<string>();
  for (const site of sites.slice(0, max)) {
    const uri = site.uri ? vscode.Uri.parse(site.uri) : vscode.Uri.file(site.file);
    const key = uri.toString() + '|' + site.line + '|' + site.instance;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const text = await INDEX.readFile(uri);
    const binding = findPortBindingIn(text, site.instance, site.line, port);
    if (!binding) {
      continue;
    }
    candidates.push({
      uri,
      text,
      parent: site.parent,
      instance: site.instance,
      line: site.line,
      offset: binding.offset,
      signal: binding.signal,
    });
  }
  return candidates;
}

// Walk up for an input port: find the instantiations of `moduleName`, take the
// binding of `port` in each, and jump to whatever drives it there. A binding fed by
// another input port keeps walking up, so wrapper levels are skipped. With several
// instantiations the user picks one (at most `maxSignalUsers` are listed).
async function gotoInputPortDriver(moduleName: string, port: string): Promise<boolean> {
  const visited = new Set<string>();
  let currentModule = moduleName;
  let currentPort = port;
  let fallback: { uri: vscode.Uri; offset: number } | null = null;
  for (let hops = 0; hops < 8; hops++) {
    const key = currentModule + '::' + currentPort;
    if (visited.has(key)) {
      break;
    }
    visited.add(key);
    const candidates = await collectInputCandidates(currentModule, currentPort);
    if (!candidates.length) {
      break;
    }
    let chosen = candidates[0];
    if (candidates.length > 1) {
      const items = candidates.map((c) => ({
        label: c.parent || '(top level)',
        description: 'instance ' + c.instance,
        detail: vscode.workspace.asRelativePath(c.uri) + ':' + (c.line + 1),
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Modules driving input ${currentModule}.${currentPort}`,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!pick) {
        return true;
      }
      chosen = candidates[items.indexOf(pick)];
    }
    fallback = { uri: chosen.uri, offset: chosen.offset };
    const range = chosen.parent ? findModuleRange(chosen.text, chosen.parent) : null;
    const signal = chosen.signal;
    if (signal && range) {
      const assigned = findAssignmentDriverAt(chosen.text, signal, range);
      if (assigned !== null) {
        logger.info(
          `gotoDriver input "${port}" in ${moduleName} -> assignment in ${chosen.parent} at ${vscode.workspace.asRelativePath(chosen.uri)}`
        );
        await openAt(chosen.uri, assigned);
        return true;
      }
      const sd = await findSubmoduleDriverAt(chosen.text, signal, range);
      if (sd) {
        const hop = await resolvePortDriver(sd.moduleType, sd.port);
        if (hop) {
          logger.info(
            `gotoDriver input "${port}" in ${moduleName} -> ${hop.module}.${hop.port} at ${vscode.workspace.asRelativePath(hop.uri)} (${hop.hops} hop(s))`
          );
          await openAt(hop.uri, hop.offset);
          return true;
        }
      }
      // The net feeding the port is itself an input of the parent: keep walking up.
      if ((await portDirection(chosen.parent, signal)) === 'input') {
        currentModule = chosen.parent;
        currentPort = signal;
        continue;
      }
    }
    logger.info(
      `gotoDriver input "${port}" in ${moduleName} -> binding ${chosen.parent}.${chosen.instance} at ${vscode.workspace.asRelativePath(chosen.uri)}:${chosen.line + 1}`
    );
    await openAt(chosen.uri, chosen.offset);
    return true;
  }
  if (fallback) {
    // The chain ended without a driver; at least show the deepest binding found.
    await openAt(fallback.uri, fallback.offset);
    return true;
  }
  return false;
}

interface SignalPass {
  moduleType: string;
  port: string;
  offset: number;
}

interface SignalScan {
  // First place the module actually uses the signal (not a declaration and not a
  // connection to a submodule).
  use: number | null;
  // Connections that only hand the signal to a submodule input, so the search can
  // continue below this module.
  passes: SignalPass[];
}

// Words that start a declaration. An occurrence whose statement head contains one
// of them is a declaration, not a use.
const DECL_KEYWORDS =
  /\b(?:input|output|inout|ref|wire|tri|wand|wor|reg|logic|bit|byte|shortint|int|longint|integer|time|real|shortreal|string|parameter|localparam|typedef|genvar)\b/;

function isDeclarationOccurrence(text: string, offset: number): boolean {
  let start = offset;
  while (start > 0 && !';{}()\n'.includes(text[start - 1])) {
    start--;
  }
  return DECL_KEYWORDS.test(text.slice(start, offset));
}

// Scan one module body for `signal`: where it is used for real, and where it is
// only wired into a submodule input port.
async function scanSignal(text: string, signal: string, range: TextSpan): Promise<SignalScan> {
  const body = text.slice(range.bodyStart, range.end);
  const base = range.bodyStart;
  const comments = commentSpans(text);
  const signalRe = new RegExp('\\b' + escapeRe(signal) + '\\b');
  const dirCache = new Map<string, string | null>();
  const wiring: [number, number][] = [];
  const passes: SignalPass[] = [];
  const seen = new Set<string>();
  const portRe = /\.\s*([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = portRe.exec(body)) !== null) {
    const portName = m[1];
    const nameOffset = m.index + m[0].indexOf(portName);
    const openParen = enclosingParenOpen(body, nameOffset);
    if (openParen < 0) {
      continue;
    }
    const moduleType = instanceTypeBefore(body, openParen);
    if (!moduleType) {
      continue;
    }
    const connOpen = m.index + m[0].length - 1;
    const connClose = matchParen(body, connOpen);
    if (connClose === -1) {
      continue;
    }
    const conn = body.slice(connOpen + 1, connClose);
    const at = conn.search(signalRe);
    if (at < 0) {
      continue;
    }
    const start = base + connOpen + 1;
    if (inSpans(comments, start + at)) {
      continue;
    }
    // Everything from `.port` to the closing paren is wiring: the port name itself
    // must not count as a use.
    wiring.push([base + m.index, base + connClose]);
    // Only a plain identifier is followed down; an expression is wiring without a
    // single port to continue into.
    if (!/^[A-Za-z_]\w*$/.test(conn.trim())) {
      continue;
    }
    const key = moduleType + '::' + portName;
    let dir = dirCache.get(key);
    if (dir === undefined) {
      dir = await portDirection(moduleType, portName);
      dirCache.set(key, dir);
    }
    if (dir !== 'input' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    passes.push({ moduleType, port: portName, offset: start + at });
  }

  let use: number | null = null;
  const re = new RegExp('\\b' + escapeRe(signal) + '\\b', 'g');
  while ((m = re.exec(body)) !== null) {
    const off = base + m.index;
    if (inSpans(comments, off)) {
      continue;
    }
    if (wiring.some(([s, e]) => off >= s && off <= e)) {
      continue;
    }
    if (isDeclarationOccurrence(text, off)) {
      continue;
    }
    use = off;
    break;
  }
  return { use, passes };
}

interface SignalUser {
  module: string;
  uri: vscode.Uri;
  text: string;
  offset: number;
}

const MAX_SIGNAL_USER_NODES = 200;

// Breadth-first fan-out below `moduleType`: a module that uses the port is a user,
// a module that only forwards it to a submodule input is skipped and searched
// instead.
async function collectSignalUsers(moduleType: string, port: string): Promise<SignalUser[]> {
  const users: SignalUser[] = [];
  const seenUser = new Set<string>();
  const visited = new Set<string>();
  const queue: { moduleType: string; port: string }[] = [{ moduleType, port }];
  while (queue.length && visited.size < MAX_SIGNAL_USER_NODES) {
    const entry = queue.shift() as { moduleType: string; port: string };
    const key = entry.moduleType + '::' + entry.port;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    const syms = await INDEX.findSymbols(entry.moduleType, ['module', 'interface']);
    for (const s of syms) {
      const text = await INDEX.readFile(s.uri);
      const range = findModuleRange(text, entry.moduleType);
      if (!range) {
        continue;
      }
      const scan = await scanSignal(text, entry.port, range);
      if (scan.use !== null) {
        const userKey = s.uri.toString() + '|' + scan.use;
        if (!seenUser.has(userKey)) {
          seenUser.add(userKey);
          users.push({ module: entry.moduleType, uri: s.uri, text, offset: scan.use });
        }
      }
      for (const pass of scan.passes) {
        queue.push({ moduleType: pass.moduleType, port: pass.port });
      }
    }
  }
  return users;
}

// Hover link on an instance input: jump to the module(s) that ultimately use the
// signal, skipping the levels that only forward it. Several users -> pick one, at
// most `systemverilog.maxSignalUsers` are listed.
async function gotoSignalUsers(arg: unknown): Promise<void> {
  const a = parsePortNavArg(arg);
  if (!a || !a.module || !a.port) {
    return;
  }
  const users = await collectSignalUsers(a.module, a.port);
  if (!users.length) {
    logger.info(`gotoSignalUsers "${a.module}.${a.port}": no user found`);
    vscode.window.showInformationMessage(`No module uses input "${a.port}" of ${a.module}`);
    return;
  }
  const max = getConfig().maxSignalUsers;
  const shown = users.slice(0, max);
  let chosen = shown[0];
  if (shown.length > 1) {
    const items = shown.map((u) => {
      const line = u.text.slice(0, u.offset).split('\n').length;
      const snippet = (u.text.split(/\r?\n/)[line - 1] || '').trim();
      return {
        label: u.module,
        description: snippet.length > 80 ? snippet.slice(0, 77) + '...' : snippet,
        detail: vscode.workspace.asRelativePath(u.uri) + ':' + line,
      };
    });
    const extra = users.length > shown.length ? ` (${shown.length} of ${users.length})` : '';
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Modules using input ${a.module}.${a.port}${extra}`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pick) {
      return;
    }
    chosen = shown[items.indexOf(pick)];
  }
  logger.info(
    `gotoSignalUsers "${a.module}.${a.port}" -> ${chosen.module} at ${vscode.workspace.asRelativePath(chosen.uri)}`
  );
  await openAt(chosen.uri, chosen.offset);
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
    logger.debug('showType: no symbol under cursor');
    return;
  }
  const text = editor.document.getText();
  let ti = await typeInfo(editor.document, word);
  // If the word is a member access (X.word), try to resolve through struct/enum too.
  if (!ti || !ti.type) {
    const alt = getTypeInfo(cleanDocument(editor.document), word);
    if (alt && alt.type) {
      ti = alt;
    }
  }
  const cfg = getConfig();
  if (!ti || !ti.type) {
    logger.debug(`showType: no type info for "${word}"`);
    vscode.window.showInformationMessage('No type information found for "' + word + '"');
    return;
  }
  logger.info(`showType "${word}": ${ti.decl || ti.type}`);
  const md = formatTypeInfo(ti);
  if (cfg.tooltip) {
    const editor2 = vscode.window.activeTextEditor!;
    const pos = editor2.selection.active;
    const hoverProvider = vscode.languages.registerHoverProvider(
      [{ language: 'systemverilog' }, { language: 'verilog' }],
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
  // Fast path: a declaration in the active buffer. This runs a synchronous regex
  // over the in-memory text, so it also sees unsaved edits.
  const text = editor.document.getText();
  const local = findDeclarationLine(text, word, true);
  if (local >= 0) {
    logger.info(`gotoDeclaration "${word}" -> line ${local + 1} (current file)`);
    goToLine(editor, local, 0);
    return;
  }
  // Workspace-level definition (resident index, O(1) lookup).
  const syms = await INDEX.findSymbols(word);
  if (syms.length) {
    const target = syms[0];
    logger.info(`gotoDeclaration "${word}" -> ${target.kind} at ${vscode.workspace.asRelativePath(target.uri)}:${target.line + 1}`);
    const doc = await vscode.workspace.openTextDocument(target.uri);
    const ed = await vscode.window.showTextDocument(doc);
    goToLine(ed, target.line, 0);
    return;
  }
  // Fallback: first occurrence of the name in the current file.
  const line = findDeclarationLine(text, word);
  if (line >= 0) {
    logger.info(`gotoDeclaration "${word}" -> line ${line + 1} (current file, weak)`);
    goToLine(editor, line, 0);
    return;
  }
  logger.debug(`gotoDeclaration "${word}": not found`);
  vscode.window.showInformationMessage('Declaration not found for "' + word + '"');
}

async function gotoDriver(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const word = selectedOrWord(editor);
  if (!word) {
    return;
  }
  // An input port is driven from above: jump to the parent binding and follow
  // whatever drives the net there (an assignment, a submodule output, or another
  // input one level up). Several instantiations -> pick one.
  const moduleName = enclosingModuleName(
    editor.document.getText(),
    editor.document.offsetAt(editor.selection.active)
  );
  if (moduleName && (await portDirection(moduleName, word)) === 'input') {
    const jumped = await gotoInputPortDriver(moduleName, word);
    if (jumped) {
      return;
    }
  }
  const res = findDriver(editor.document.getText(), word);
  // A local assignment (continuous or procedural) is the real driver: stay here.
  if (res && res.detail === 'assignment') {
    logger.info(`gotoDriver "${word}" -> ${res.detail} at line ${res.line + 1}`);
    goToLine(editor, res.line, Math.max(0, res.character));
    return;
  }
  // An output port or a net bound to a submodule output: descend through the
  // levels that only pass the signal along and land where it is really driven.
  const sd = await resolveSubmoduleDriver(editor.document, word);
  if (sd) {
    const hop = await resolvePortDriver(sd.moduleType, sd.port);
    if (hop) {
      logger.info(
        `gotoDriver "${word}" -> ${hop.module}.${hop.port} at ${vscode.workspace.asRelativePath(hop.uri)} (${hop.hops} hop(s))`
      );
      await openAt(hop.uri, hop.offset);
      return;
    }
  }
  if (res) {
    logger.info(`gotoDriver "${word}" -> ${res.detail} at line ${res.line + 1}`);
    goToLine(editor, res.line, Math.max(0, res.character));
    return;
  }
  logger.debug(`gotoDriver "${word}": no driver found`);
  vscode.window.showInformationMessage('Driver not found for "' + word + '"');
}

async function showHierarchy(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const mi = documentModuleInfo(editor.document);
  if (!mi) {
    logger.warn('showHierarchy: no module found in current file');
    vscode.window.showWarningMessage('No module found in current file');
    return;
  }
  logger.info(`showHierarchy from module "${mi.name}"`);
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
  logger.info(`showHierarchy: ${lines.length} node(s)`);
  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'systemverilog' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function findInstance(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  let name = selectedOrWord(editor);
  const mi = documentModuleInfo(editor.document);
  if (!name && mi) {
    name = mi.name;
  }
  if (!name) {
    return;
  }
  const sites = await INDEX.findInstantiations(name);
  if (!sites.length) {
    logger.info(`findInstance "${name}": no instance found`);
    vscode.window.showInformationMessage('No instance of "' + name + '" found');
    return;
  }
  const results = sites.map((site) => {
    const uri = site.uri ? vscode.Uri.parse(site.uri) : vscode.Uri.file(site.file);
    return `${vscode.workspace.asRelativePath(uri)}:${site.line + 1}  ${site.instance}`;
  });
  logger.info(`findInstance "${name}": ${results.length} instance(s)`);
  const doc = await vscode.workspace.openTextDocument({
    content: 'Instances of ' + name + ':\n\n' + results.join('\n'),
    language: 'systemverilog',
  });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

// Right-click inside a module: jump to the module(s) that instantiate it. When
// several modules (or the same module several times) instantiate the current one,
// list up to five parent-module / instance-name entries to choose from.
async function gotoInstantiator(arg?: unknown): Promise<void> {
  let target: string | undefined;
  if (typeof arg === 'string') {
    target = arg;
  } else if (arg && typeof arg === 'object' && typeof (arg as { name?: string }).name === 'string') {
    target = (arg as { name: string }).name;
  }
  if (!target) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    target = enclosingModuleName(
      editor.document.getText(),
      editor.document.offsetAt(editor.selection.active)
    );
  }
  if (!target) {
    logger.debug('gotoInstantiator: cursor is not inside a module');
    vscode.window.showInformationMessage('Cursor is not inside a module');
    return;
  }
  const sites = await INDEX.findInstantiations(target);
  if (!sites.length) {
    logger.info(`gotoInstantiator "${target}": no instantiation found`);
    vscode.window.showInformationMessage('No module instantiates "' + target + '"');
    return;
  }
  const top = sites.slice(0, 5);
  let chosen = top[0];
  if (top.length > 1) {
    const items = top.map((s) => ({
      label: s.parent || '(top level)',
      description: 'instance ' + s.instance,
      detail:
        vscode.workspace.asRelativePath(s.uri ? vscode.Uri.parse(s.uri) : vscode.Uri.file(s.file)) +
        ':' +
        (s.line + 1),
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Modules instantiating ${target}`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pick) {
      return;
    }
    chosen = top[items.indexOf(pick)];
  }
  const uri = chosen.uri ? vscode.Uri.parse(chosen.uri) : vscode.Uri.file(chosen.file);
  logger.info(
    `gotoInstantiator "${target}" -> ${vscode.workspace.asRelativePath(uri)}:${chosen.line + 1} (${chosen.parent}.${chosen.instance})`
  );
  await gotoMember({ uri: uri.toString(), line: chosen.line });
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
    logger.debug('blockBoundary: no enclosing block at cursor');
    vscode.window.showInformationMessage('No block found at cursor');
    return;
  }
  logger.debug(`blockBoundary ${cmd}: ${match.start}..${match.end}`);
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
