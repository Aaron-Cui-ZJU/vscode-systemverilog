'use strict';
// Headless `vscode` stub + fake TextDocument for provider-level tests.
//
// The extension is compiled with `tsc` to `out/` and its modules do a plain
// `require('vscode')`. Under plain Node that specifier does not resolve, so this
// helper installs a `Module._load` hook that answers it with a real object. The
// hook also rejects every other bare npm specifier, mirroring the published
// environment (`vsce publish --no-dependencies`).
//
// Unlike the permissive Proxy in `test/activation.test.js`, the stub below
// provides constructible classes: `src/completion.ts` instantiates `Position`,
// `Range`, `CompletionItem` and `SnippetString`, and reads fields back off them,
// so a callable Proxy cannot stand in for them.

const Module = require('module');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'out') + path.sep;

// ---------------------------------------------------------------------------
// vscode value types
// ---------------------------------------------------------------------------

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }

  translate(lineDelta = 0, charDelta = 0) {
    return new Position(this.line + lineDelta, this.character + charDelta);
  }

  isEqual(other) {
    return !!other && other.line === this.line && other.character === this.character;
  }

  isBefore(other) {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }

  isBeforeOrEqual(other) {
    return this.isEqual(other) || this.isBefore(other);
  }

  with(line, character) {
    return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character);
  }
}

class Range {
  // Two `Position`s, as used throughout src/. The four-number form is accepted
  // too so an unexpected call site fails on assertions, not on `undefined.start`.
  constructor(start, end, endLine, endCharacter) {
    if (typeof start === 'number') {
      this.start = new Position(start, end);
      this.end = new Position(endLine, endCharacter);
    } else {
      this.start = start;
      this.end = end;
    }
  }

  get isEmpty() {
    return this.start.isEqual(this.end);
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
    this.detail = undefined;
    this.insertText = undefined;
    this.range = undefined;
    this.sortText = undefined;
    this.filterText = undefined;
    this.preselect = undefined;
    this.additionalTextEdits = undefined;
    this.documentation = undefined;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value;
  }
}

class TextEdit {
  constructor(range, newText) {
    this.range = range;
    this.newText = newText;
  }

  static insert(position, newText) {
    return new TextEdit(new Range(position, position), newText);
  }

  static replace(range, newText) {
    return new TextEdit(range, newText);
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
};

function makeUri(fileUri) {
  const fsPath = fileUri.replace(/^file:\/\//, '');
  return {
    scheme: 'file',
    path: fsPath,
    fsPath,
    toString() {
      return fileUri;
    },
    with() {
      return this;
    },
  };
}

const Uri = {
  parse(value) {
    return makeUri(String(value));
  },
  file(fsPath) {
    return makeUri('file://' + (String(fsPath).startsWith('/') ? fsPath : '/' + fsPath));
  },
  joinPath(base, ...parts) {
    return makeUri(base.toString().replace(/\/$/, '') + '/' + parts.map(String).join('/'));
  },
};

// ---------------------------------------------------------------------------
// vscode namespaces
// ---------------------------------------------------------------------------

// Values returned for keys the extension asks `getConfiguration()` about. Only
// `src/config.ts` reads settings, and it always passes a default, so an empty
// override table means "behave exactly like a fresh install".
let configOverrides = {};

function makeConfigurationSection() {
  return {
    get(key, defaultValue) {
      return Object.prototype.hasOwnProperty.call(configOverrides, key) ? configOverrides[key] : defaultValue;
    },
    has() {
      return false;
    },
    inspect() {
      return undefined;
    },
    async update() {
      return undefined;
    },
  };
}

const disposable = () => ({ dispose() {} });

const workspace = {
  // Explicitly undefined: `src/config.ts` reads `workspaceFolders?.[0]` and
  // `src/indexer.ts` reads `window.activeTextEditor` on the lookup path.
  workspaceFolders: undefined,
  getConfiguration() {
    return makeConfigurationSection();
  },
  onDidChangeConfiguration() {
    return disposable();
  },
  onDidSaveTextDocument() {
    return disposable();
  },
  onDidChangeTextDocument() {
    return disposable();
  },
  onDidOpenTextDocument() {
    return disposable();
  },
  onDidCreateFiles() {
    return disposable();
  },
  onDidDeleteFiles() {
    return disposable();
  },
  onDidRenameFiles() {
    return disposable();
  },
  createFileSystemWatcher() {
    return { onDidCreate: () => disposable(), onDidChange: () => disposable(), onDidDelete: () => disposable(), dispose() {} };
  },
  async findFiles() {
    return [];
  },
  asRelativePath(p) {
    return String(p);
  },
  // `WorkspaceIndex` reads the filesystem through these; the completion path
  // never touches disk (no `ensureIndex()`), so throwing keeps tests honest.
  fs: {
    async stat() {
      throw new Error('vscode.workspace.fs.stat is not stubbed');
    },
    async readFile() {
      throw new Error('vscode.workspace.fs.readFile is not stubbed');
    },
    async writeFile() {
      throw new Error('vscode.workspace.fs.writeFile is not stubbed');
    },
    async createDirectory() {
      throw new Error('vscode.workspace.fs.createDirectory is not stubbed');
    },
  },
};

const outputChannel = () => ({
  name: 'SystemVerilog',
  append() {},
  appendLine() {},
  clear() {},
  show() {},
  hide() {},
  dispose() {},
});

const window = {
  activeTextEditor: undefined,
  createOutputChannel: outputChannel,
  showInformationMessage() {
    return undefined;
  },
  showWarningMessage() {
    return undefined;
  },
  showErrorMessage() {
    return undefined;
  },
  async showQuickPick() {
    return undefined;
  },
  async showInputBox() {
    return undefined;
  },
  setStatusBarMessage() {
    return disposable();
  },
  createStatusBarItem() {
    return { text: '', tooltip: '', show() {}, hide() {}, dispose() {} };
  },
};

let registeredProvider = null;
let registeredCommands = [];

const languages = {
  registerCompletionItemProvider(selector, provider, ...triggers) {
    registeredProvider = { selector, provider, triggers };
    return disposable();
  },
  createDiagnosticCollection() {
    return { set() {}, delete() {}, clear() {}, dispose() {} };
  },
  registerHoverProvider() {
    return disposable();
  },
  registerDefinitionProvider() {
    return disposable();
  },
  registerDocumentSymbolProvider() {
    return disposable();
  },
};

const commands = {
  registerCommand(name, handler) {
    registeredCommands.push({ name, handler });
    return disposable();
  },
  async executeCommand() {
    return undefined;
  },
};

const vscode = {
  Position,
  Range,
  CompletionItem,
  CompletionItemKind,
  SnippetString,
  TextEdit,
  Uri,
  workspace,
  window,
  languages,
  commands,
  Disposable: class Disposable {
    constructor(fn) {
      this._fn = fn;
    }
    dispose() {
      if (this._fn) {
        this._fn();
      }
    }
    static from() {
      return disposable();
    }
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.event = () => disposable();
    }
    fire() {}
    dispose() {}
  },
  extensions: { getExtension: () => undefined },
  env: { openExternal: async () => true },
};

// ---------------------------------------------------------------------------
// Module hook
// ---------------------------------------------------------------------------

let previousLoad = null;

function installStub() {
  if (previousLoad) {
    return;
  }
  previousLoad = Module._load;
  const builtins = new Set(Module.builtinModules);
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
      return vscode;
    }
    const isRelative = request.startsWith('.') || path.isAbsolute(request);
    const isBuiltin = builtins.has(request) || request.startsWith('node:');
    if (!isRelative && !isBuiltin) {
      throw new Error(
        `module "${request}" is not available in the headless completion tests; ` +
          'the published extension may only require `vscode`, Node built-ins and relative files'
      );
    }
    return previousLoad.apply(this, arguments);
  };
}

function clearOutCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(OUT_DIR)) {
      delete require.cache[key];
    }
  }
}

function resetStub() {
  if (previousLoad) {
    Module._load = previousLoad;
    previousLoad = null;
  }
  clearOutCache();
  configOverrides = {};
  registeredProvider = null;
  registeredCommands = [];
}

// ---------------------------------------------------------------------------
// Fake TextDocument
// ---------------------------------------------------------------------------

const DEFAULT_FILE = '/tmp/x.sv';

function splitLines(text) {
  return text.split('\n');
}

function makeDocument(text, options = {}) {
  const doc = {
    // Mutable so a test can simulate an edit. Bump `version` at the same time:
    // `src/documentCache.ts` rebuilds its entry when the version changes.
    version: options.version === undefined ? 1 : options.version,
    fileName: options.fileName || DEFAULT_FILE,
    languageId: options.languageId || 'systemverilog',
  };
  doc.uri = Uri.file(doc.fileName);
  Object.defineProperty(doc, 'text', { value: text, writable: true, enumerable: true });

  doc.setText = (next) => {
    doc.text = next;
  };
  doc.getText = (range) => {
    if (!range) {
      return doc.text;
    }
    return doc.text.slice(doc.offsetAt(range.start), doc.offsetAt(range.end));
  };
  doc.lineAt = (line) => {
    const lines = splitLines(doc.text);
    const t = line >= 0 && line < lines.length ? lines[line] : '';
    return {
      lineNumber: line,
      text: t,
      range: new Range(new Position(line, 0), new Position(line, t.length)),
      rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line, t.length + 1)),
      firstNonWhitespaceCharacterIndex: t.length - t.replace(/^\s+/, '').length,
      isEmptyOrWhitespace: t.trim().length === 0,
    };
  };
  doc.lineCount = () => splitLines(doc.text).length;
  doc.offsetAt = (position) => {
    const lines = splitLines(doc.text);
    const line = Math.max(0, Math.min(position.line, lines.length - 1));
    let off = 0;
    for (let i = 0; i < line; i++) {
      off += lines[i].length + 1;
    }
    return Math.max(0, Math.min(off + Math.max(0, position.character), doc.text.length));
  };
  doc.positionAt = (offset) => {
    const target = Math.max(0, Math.min(offset, doc.text.length));
    const before = doc.text.slice(0, target);
    const line = (before.match(/\n/g) || []).length;
    const lastBreak = before.lastIndexOf('\n');
    return new Position(line, target - (lastBreak + 1));
  };
  doc.getWordRangeAtPosition = (position, regex) => {
    const line = doc.lineAt(position.line).text;
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (start <= position.character && position.character <= end) {
        return new Range(new Position(position.line, start), new Position(position.line, end));
      }
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
    return undefined;
  };
  doc.validateRange = (range) => range;
  doc.save = async () => true;

  return doc;
}

// ---------------------------------------------------------------------------
// Extension modules
// ---------------------------------------------------------------------------

// `INDEX` is an `export let` assigned only inside `initIndex()` (src/indexer.ts),
// and production code reaches it through `activate()`. Every test that touches a
// `INDEX.*` member must call this first.
function loadModules() {
  installStub();
  const outFile = (name) => path.join(__dirname, '..', '..', 'out', name);
  const indexer = require(outFile('indexer.js'));
  indexer.initIndex();
  return {
    completion: require(outFile('completion.js')),
    indexer,
    config: require(outFile('config.js')),
  };
}

// `getConfig()` memoises into a module-level `cachedConfig` (src/config.ts), so a
// settings change is invisible until the cache is dropped.
function setConfig(patch) {
  installStub();
  configOverrides = Object.assign({}, configOverrides, patch);
  const outFile = (name) => path.join(__dirname, '..', '..', 'out', name);
  require(outFile('config.js')).invalidateConfigCache();
}

function getProvider() {
  installStub();
  const mods = loadModules();
  registeredProvider = null;
  mods.completion.registerCompletion({ subscriptions: [], extension: { packageJSON: {} } });
  if (!registeredProvider) {
    throw new Error('completion provider was not registered');
  }
  return registeredProvider.provider;
}

function getRegistration() {
  return registeredProvider;
}

function getStub() {
  return vscode;
}

function getConfigOverrides() {
  return Object.assign({}, configOverrides);
}

module.exports = {
  makeDocument,
  loadModules,
  setConfig,
  getProvider,
  resetStub,
  installStub,
  // Extra introspection surface used by tests and diagnostics.
  getStub,
  getRegistration,
  getConfigOverrides,
  DEFAULT_FILE,
};
