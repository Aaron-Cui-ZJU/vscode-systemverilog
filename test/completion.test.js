'use strict';
// Provider-level baseline for `src/completion.ts`.
//
// This suite pins the behaviour of the completion provider as it is TODAY, using
// the headless `vscode` stub in `test/helpers/vscodeStub.js`. It is the safety
// net for the scope-symbol work: every existing branch (snippets, system tasks,
// directives, port bindings, `end` closing keywords, `disableAutocomplete`) must
// keep working while document declarations are added.
//
// The single assertion marked BASELINE below used to state that document
// declarations were NOT offered. That assertion is rewritten in place (not
// deleted) now that scope symbols are merged into the provider.

const assert = require('assert');
const stub = require('./helpers/vscodeStub');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}`);
    console.log(e.message);
  }
}

function checkTrue(name, value) {
  check(name, !!value, true);
}

function vscode() {
  return stub.getStub();
}

// Cursor at the end of the given line.
function atLine(doc, line) {
  return new (vscode().Position)(line, doc.lineAt(line).text.length);
}

function labels(items) {
  return (items || []).map((i) => i.label);
}

function hasLabel(items, label) {
  return labels(items).includes(label);
}

function requireError(specifier) {
  try {
    require(specifier);
    return '';
  } catch (e) {
    return (e && e.message) || '';
  }
}

async function run() {
  const provider = stub.getProvider();

  // The hook must reject bare npm specifiers, so a new top-level dependency in
  // `out/` cannot be masked by the locally installed `node_modules`.
  checkTrue(
    'stub hook rejects bare npm requires',
    requireError('vscode-languageclient/node').includes('not available in the headless completion tests')
  );

  // ---------------------------------------------------------------- snippets
  const alwaysText = ['module top;', '  al', 'endmodule'].join('\n');
  const docAlways = stub.makeDocument(alwaysText, { fileName: '/tmp/stub_always.sv' });
  const alwaysItems = await provider.provideCompletionItems(docAlways, atLine(docAlways, 1));
  checkTrue("'al' yields an always* snippet", hasLabel(alwaysItems, 'always_ff') || hasLabel(alwaysItems, 'always'));
  const ff = (alwaysItems || []).find((i) => i.label === 'always_ff');
  checkTrue('always_ff is a SnippetString starting with its label', ff && ff.insertText && typeof ff.insertText.value === 'string' && ff.insertText.value.startsWith('always_ff '));
  checkTrue('always_ff carries a detail', !!ff && typeof ff.detail === 'string' && ff.detail.length > 0);

  // ------------------------------------------------------------ system tasks
  const sysText = ['module top;', '  $di', 'endmodule'].join('\n');
  const docSys = stub.makeDocument(sysText, { fileName: '/tmp/stub_systask.sv' });
  const sysItems = await provider.provideCompletionItems(docSys, atLine(docSys, 1));
  const display = (sysItems || []).find((i) => i.detail === '$display()');
  checkTrue("'$di' yields $display()", !!display);
  check('$display() label is display', display && display.label, 'display');

  // -------------------------------------------------------------- directives
  const tickText = ['module top;', '  `inc', 'endmodule'].join('\n');
  const docTick = stub.makeDocument(tickText, { fileName: '/tmp/stub_tick.sv' });
  const tickItems = await provider.provideCompletionItems(docTick, atLine(docTick, 1));
  const include = (tickItems || []).find((i) => i.label === 'include');
  checkTrue("'`inc' yields `include", !!include && typeof include.detail === 'string' && include.detail.startsWith('`include'));

  // ------------------------------------------------------- disabled by config
  stub.setConfig({ disableAutocomplete: true });
  const disabled = await provider.provideCompletionItems(docAlways, atLine(docAlways, 1));
  check('disableAutocomplete=true returns undefined', disabled, undefined);
  stub.setConfig({ disableAutocomplete: false });
  const reenabled = await provider.provideCompletionItems(docAlways, atLine(docAlways, 1));
  checkTrue('re-enabling autocomplete restores suggestions', Array.isArray(reenabled) && reenabled.length > 0);

  // ----------------------------------------------------------- port bindings
  const instText = [
    'module child (',
    '  input logic a,',
    '  input logic b',
    ');',
    'endmodule',
    'module top;',
    '  child u_c (',
    '    .',
    '  );',
    'endmodule',
  ].join('\n');
  const docInst = stub.makeDocument(instText, { fileName: '/tmp/stub_inst.sv' });
  const instItems = await provider.provideCompletionItems(docInst, atLine(docInst, 7));
  checkTrue("'.' in a port list suggests the child's ports", hasLabel(instItems, 'a') && hasLabel(instItems, 'b'));
  checkTrue('port binding items keep a range', (instItems || []).every((i) => !!i.range));

  // `.port(` with a preceding binding is the `TextEdit.insert` path: the provider
  // inserts the missing comma at the binding list offset.
  const bindText = ['module child (', '  input logic a,', '  input logic b', ');', 'endmodule', 'module top;', '  child u_c (.a(a) .'].join('\n');
  const docBind = stub.makeDocument(bindText, { fileName: '/tmp/stub_bind.sv' });
  const bindItems = await provider.provideCompletionItems(docBind, atLine(docBind, 6));
  checkTrue('binding after .a(a) still suggests the unbound port', hasLabel(bindItems, 'b') && !hasLabel(bindItems, 'a'));
  const firstEdit = bindItems && bindItems[0] && bindItems[0].additionalTextEdits && bindItems[0].additionalTextEdits[0];
  checkTrue('TextEdit.insert supplies the separating comma', !!firstEdit && firstEdit.newText === ',');

  // ------------------------------------------------------------ `end` branch
  // The `begin` block keeps `module` on top of the stack, so `end` resolves to
  // `endmodule`. This path calls `document.getText(new Range(...))`.
  const endText = ['module top;', '  initial begin', '  end'].join('\n');
  const docEnd = stub.makeDocument(endText, { fileName: '/tmp/stub_end.sv' });
  const endItems = await provider.provideCompletionItems(docEnd, atLine(docEnd, 2));
  checkTrue("'end' yields the endmodule snippet", hasLabel(endItems, 'endmodule'));

  // ------------------------------------------------------------- BASELINE ----
  // BASELINE: document declarations are merged into the candidate list now.
  // The row still has to be a plain name carrying the declaration text as
  // detail, and it ranks ahead of the fixed snippets via `sortText`.
  const declText = ['module top;', '  logic [7:0] data_valid;', '  data', 'endmodule'].join('\n');
  const docDecl = stub.makeDocument(declText, { fileName: '/tmp/stub_decl.sv' });
  const declItems = await provider.provideCompletionItems(docDecl, atLine(docDecl, 2));
  const dataValid = (declItems || []).find((i) => i.label === 'data_valid');
  checkTrue('BASELINE: document declaration data_valid is offered', !!dataValid);
  checkTrue(
    'BASELINE: data_valid ranks with the 0-prefixed symbol rows',
    !!dataValid && typeof dataValid.sortText === 'string' && dataValid.sortText.startsWith('0')
  );
  checkTrue(
    'BASELINE: data_valid detail carries the declaration text',
    !!dataValid && typeof dataValid.detail === 'string' && dataValid.detail.includes('logic [7:0]')
  );

  // ------------------------------------------------------------ symbol merge
  // (a) `a` used to short-circuit to the always* snippets; symbols must now
  // coexist with that branch instead of being swallowed by it.
  const symAText = ['module top;', '  logic addr;', '  a', 'endmodule'].join('\n');
  const docSymA = stub.makeDocument(symAText, { fileName: '/tmp/stub_sym_a.sv' });
  const symAItems = await provider.provideCompletionItems(docSymA, atLine(docSymA, 2));
  checkTrue("'a' still yields an always* snippet", hasLabel(symAItems, 'always_ff') || hasLabel(symAItems, 'always'));
  checkTrue("'a' also yields the addr declaration", hasLabel(symAItems, 'addr'));

  // (b) `m` used to short-circuit to the modport template.
  const symMText = ['module top;', '  logic m_valid;', '  m', 'endmodule'].join('\n');
  const docSymM = stub.makeDocument(symMText, { fileName: '/tmp/stub_sym_m.sv' });
  const symMItems = await provider.provideCompletionItems(docSymM, atLine(docSymM, 2));
  checkTrue("'m' still yields the modport template", hasLabel(symMItems, 'modport'));
  checkTrue("'m' also yields the m_valid declaration", hasLabel(symMItems, 'm_valid'));

  // (c) `end` used to short-circuit to endItems. The typed `end` closes the
  // `begin` block, so the enclosing module provides the `endmodule` snippet.
  const symEndText = ['module top;', '  logic end_state;', '  initial begin', '  end', 'endmodule'].join('\n');
  const docSymEnd = stub.makeDocument(symEndText, { fileName: '/tmp/stub_sym_end.sv' });
  const symEndItems = await provider.provideCompletionItems(docSymEnd, atLine(docSymEnd, 3));
  checkTrue("'end' still yields the closing keyword", hasLabel(symEndItems, 'endmodule'));
  checkTrue("'end' also yields the end_state declaration", hasLabel(symEndItems, 'end_state'));

  // (d) Empty prefix inside a module body used to return undefined.
  const symEmptyText = ['module top;', '  logic empty_scope_name;', '  ', 'endmodule'].join('\n');
  const docSymEmpty = stub.makeDocument(symEmptyText, { fileName: '/tmp/stub_sym_empty.sv' });
  const symEmptyItems = await provider.provideCompletionItems(docSymEmpty, atLine(docSymEmpty, 2));
  checkTrue(
    'empty prefix inside a module returns the scope declarations',
    Array.isArray(symEmptyItems) && symEmptyItems.length > 0 && hasLabel(symEmptyItems, 'empty_scope_name')
  );

  // (e) Comments and string literals never produce declaration rows.
  const symCommentText = ['module top;', '  logic [7:0] data_valid;', '  // data_', 'endmodule'].join('\n');
  const docSymComment = stub.makeDocument(symCommentText, { fileName: '/tmp/stub_sym_comment.sv' });
  const symCommentItems = await provider.provideCompletionItems(docSymComment, atLine(docSymComment, 2));
  checkTrue('a comment position offers no declaration rows', !hasLabel(symCommentItems, 'data_valid'));

  const symStringText = ['module top;', '  logic [7:0] data_valid;', '  string s = "data_";', 'endmodule'].join('\n');
  const docSymString = stub.makeDocument(symStringText, { fileName: '/tmp/stub_sym_string.sv' });
  const stringLine = docSymString.lineAt(2).text;
  const symStringItems = await provider.provideCompletionItems(
    docSymString,
    new (vscode().Position)(2, stringLine.indexOf('data_') + 'data_'.length)
  );
  checkTrue('a string literal position offers no declaration rows', !hasLabel(symStringItems, 'data_valid'));

  // (f) A `.` inside an instantiation port list stays member completion only.
  const symDotText = [
    'module child (',
    '  input logic a,',
    '  input logic b',
    ');',
    'endmodule',
    'module top;',
    '  logic data_valid;',
    '  child u_c (',
    '    .',
    '  );',
    'endmodule',
  ].join('\n');
  const docSymDot = stub.makeDocument(symDotText, { fileName: '/tmp/stub_sym_dot.sv' });
  const symDotItems = await provider.provideCompletionItems(docSymDot, atLine(docSymDot, 8));
  checkTrue("the '.' port list keeps the child's ports", hasLabel(symDotItems, 'a') && hasLabel(symDotItems, 'b'));
  checkTrue("the '.' port list adds no scope declarations", !hasLabel(symDotItems, 'data_valid'));

  // (g) The case-fill position returns only the case value item, no symbol rows.
  const symCaseText = [
    'module top;',
    '  typedef enum logic [1:0] {IDLE, RUN} state_t;',
    '  state_t st;',
    '  case (st)',
    'endmodule',
  ].join('\n');
  const docSymCase = stub.makeDocument(symCaseText, { fileName: '/tmp/stub_sym_case.sv' });
  const symCaseItems = await provider.provideCompletionItems(docSymCase, atLine(docSymCase, 3));
  check('case fill returns exactly the case value item', labels(symCaseItems), ['case values']);

  // (h) Same-named declarations appear once.
  const symDupText = ['module top;', '  logic dup_name;', '  logic dup_name;', '  d', 'endmodule'].join('\n');
  const docSymDup = stub.makeDocument(symDupText, { fileName: '/tmp/stub_sym_dup.sv' });
  const symDupItems = await provider.provideCompletionItems(docSymDup, atLine(docSymDup, 3));
  check(
    'same-named declarations are deduped',
    labels(symDupItems).filter((l) => l === 'dup_name').length,
    1
  );

  // (i) `u` is the fourth letter branch and only one it did not previously pin:
  // it used to short-circuit to the UVM list. Both the UVM rows and the local
  // declaration have to survive, and the declaration has to rank ahead of them,
  // so restoring the short-circuit cannot pass this suite again.
  const symUText = ['module top;', '  logic u_addr;', '  u', 'endmodule'].join('\n');
  const docSymU = stub.makeDocument(symUText, { fileName: '/tmp/stub_sym_u.sv' });
  const symUItems = await provider.provideCompletionItems(docSymU, atLine(docSymU, 2));
  const uvmRows = (symUItems || []).filter((i) => typeof i.label === 'string' && i.label.startsWith('uvm_'));
  checkTrue(
    "'u' yields both a UVM row and the u_addr declaration",
    uvmRows.length > 0 && hasLabel(symUItems, 'u_addr')
  );
  const uAddrRow = (symUItems || []).find((i) => i.label === 'u_addr');
  const uAddrSort = uAddrRow && (uAddrRow.sortText || uAddrRow.label);
  checkTrue(
    'u_addr sorts strictly before every uvm_* label',
    !!uAddrSort && uvmRows.every((r) => uAddrSort < (r.sortText || r.label))
  );

  // ----------------------------------------------------------- stale state ---
  // Two providers in one process must not cross-contaminate. Today the observable
  // document-derived data on this path is the auto-detected clock name baked into
  // the `always` snippet template, so the probes use that.
  const docA = stub.makeDocument(['module a;', '  always @(posedge clk_a) begin', '  al', 'endmodule'].join('\n'), {
    fileName: '/tmp/stub_a.sv',
  });
  const docB = stub.makeDocument(['module b;', '  always @(posedge clk_b) begin', '  al', 'endmodule'].join('\n'), {
    fileName: '/tmp/stub_b.sv',
  });
  const providerA = stub.getProvider();
  const itemsA = await providerA.provideCompletionItems(docA, atLine(docA, 2));
  const snippetA = ((itemsA || []).find((i) => i.label === 'always_ff') || {}).insertText;
  checkTrue('document A template uses clk_a', !!snippetA && snippetA.value.includes('clk_a') && !snippetA.value.includes('clk_b'));

  // A second getProvider() call in the same process, without a reset.
  const providerB = stub.getProvider();
  const itemsB = await providerB.provideCompletionItems(docB, atLine(docB, 2));
  const snippetB = ((itemsB || []).find((i) => i.label === 'always_ff') || {}).insertText;
  checkTrue('document B template uses clk_b', !!snippetB && snippetB.value.includes('clk_b') && !snippetB.value.includes('clk_a'));
  checkTrue('providers from two getProvider() calls are separate objects', providerA !== providerB);

  // resetStub() drops the stub hook, the out/ module cache and the config cache,
  // so a fresh provider starts from a clean slate.
  stub.resetStub();
  let resetMessage = '';
  try {
    require('vscode');
  } catch (e) {
    resetMessage = (e && e.message) || '';
  }
  checkTrue('resetStub() restores the original module loader', resetMessage.includes('Cannot find module') && !resetMessage.includes('headless completion tests'));
  const providerC = stub.getProvider();
  const docC = stub.makeDocument(['module c;', '  always @(posedge clk_c) begin', '  al', 'endmodule'].join('\n'), {
    fileName: '/tmp/stub_c.sv',
  });
  const itemsC = await providerC.provideCompletionItems(docC, atLine(docC, 2));
  const snippetC = ((itemsC || []).find((i) => i.label === 'always_ff') || {}).insertText;
  checkTrue('after resetStub() a new provider only serves its own document', !!snippetC && snippetC.value.includes('clk_c') && !snippetC.value.includes('clk_a'));

  // ---------------------------------------------- document cache by version --
  const documentCache = require('../out/documentCache.js');
  const docVersion = stub.makeDocument('module x; logic a; endmodule', { fileName: '/tmp/stub_version.sv' });
  check('documentText() returns the current text', documentCache.documentText(docVersion), 'module x; logic a; endmodule');
  check(
    'documentText() reuses the cached text for the same version',
    documentCache.documentText(docVersion) === documentCache.documentText(docVersion),
    true
  );
  docVersion.setText('module x; logic b; endmodule');
  docVersion.version += 1;
  check('documentText() rebuilds when the version changes', documentCache.documentText(docVersion), 'module x; logic b; endmodule');

  // ------------------------------------------ documentScopeTable cache --------
  const scopeSymbols = require('../out/scopeSymbols.js');
  const docScope = stub.makeDocument(
    ['module scope_cache;', '  logic old_only;', 'endmodule'].join('\n'),
    { fileName: '/tmp/stub_scope_cache.sv' }
  );
  const oldTable = documentCache.documentScopeTable(docScope);
  checkTrue(
    'documentScopeTable() returns the same object for one version',
    oldTable === documentCache.documentScopeTable(docScope)
  );

  docScope.setText(['module scope_cache;', '  logic new_only;', 'endmodule'].join('\n'));
  docScope.version += 1;
  const newTable = documentCache.documentScopeTable(docScope);
  checkTrue('documentScopeTable() rebuilds a different object after a version bump', newTable !== oldTable);

  const newNames = scopeSymbols.symbolsAt(newTable, newTable.text.length).map((s) => s.name);
  checkTrue('the rebuilt table exposes a declaration from the new text', newNames.includes('new_only') && !newNames.includes('old_only'));

  const oldNames = scopeSymbols.symbolsAt(oldTable, oldTable.text.length).map((s) => s.name);
  checkTrue('the old table still holds the declaration removed from the document', oldNames.includes('old_only'));

  // ------------------------------------------------ package import members ---
  // `import pkg::*;` members come from the workspace index, which is only read
  // once it reports itself built: the first keystroke must never wait for the
  // background scan.
  const indexer = require('../out/indexer.js');
  const INDEX = indexer.INDEX;
  const kindOf = vscode().CompletionItemKind;
  const hasPackageRow = (items) =>
    (items || []).some((i) => typeof i.sortText === 'string' && i.sortText.startsWith('1'));

  check('the headless index starts unbuilt', INDEX.isBuilt(), false);

  const pkgText = [
    'package my_pkg;',
    '  parameter int PKG_CONST = 1;',
    '  typedef enum logic [1:0] {A1, A2} pkg_state_t;',
    'endpackage',
    'module top;',
    '  import my_pkg::*;',
    '  logic [7:0] data_valid;',
    '  da',
    'endmodule',
  ].join('\n');
  const docPkg = stub.makeDocument(pkgText, { fileName: '/tmp/stub_pkg_unbuilt.sv' });
  const pkgItems = await providerC.provideCompletionItems(docPkg, atLine(docPkg, 7));
  checkTrue('an unbuilt index still returns the local declarations', hasLabel(pkgItems, 'data_valid'));
  check('an unbuilt index adds no package rows', hasPackageRow(pkgItems), false);

  check('peekPackage() answers null while the index is unbuilt', await INDEX.peekPackage('nope'), null);

  let ensureIndexCalls = 0;
  INDEX.ensureIndex = function () {
    ensureIndexCalls++;
    return Promise.resolve();
  };
  let peekUnbuilt = null;
  let probeUnbuilt = null;
  try {
    peekUnbuilt = await INDEX.peekPackage('nope');
    probeUnbuilt = await providerC.provideCompletionItems(docPkg, atLine(docPkg, 7));
  } finally {
    delete INDEX.ensureIndex;
  }
  check('peekPackage() stays null with ensureIndex() stubbed', peekUnbuilt, null);
  check('neither peekPackage() nor the provider starts an index build', ensureIndexCalls, 0);
  checkTrue('the unbuilt probe still returns a candidate array', Array.isArray(probeUnbuilt));

  // A simulated built index: the wildcard-imported package's members are added
  // as `'1'`-prefixed rows, and a package the document never imports adds none.
  const pkgMembers = [
    { name: 'PKG_CONST', tag: 'decl', decl: 'int PKG_CONST' },
    { name: 'pkg_state_t', tag: 'enum', decl: 'typedef enum {A1, A2} pkg_state_t' },
  ];
  const peeked = [];
  INDEX.isBuilt = () => true;
  INDEX.peekPackage = async (name) => {
    peeked.push(name);
    return name === 'my_pkg' ? pkgMembers : null;
  };
  let builtItems = [];
  let otherItems = [];
  try {
    builtItems = await providerC.provideCompletionItems(docPkg, atLine(docPkg, 7));
    const otherDoc = stub.makeDocument(pkgText.replace('my_pkg::*', 'other_pkg::*'), {
      fileName: '/tmp/stub_pkg_other.sv',
    });
    otherItems = await providerC.provideCompletionItems(otherDoc, atLine(otherDoc, 7));
  } finally {
    delete INDEX.isBuilt;
    delete INDEX.peekPackage;
  }

  const constRow = (builtItems || []).find((i) => i.label === 'PKG_CONST');
  checkTrue('a built index offers the imported package constant', !!constRow);
  check('the package constant is a Constant row', constRow && constRow.kind, kindOf.Constant);
  check('the package constant sorts after the local symbols', constRow && constRow.sortText, '1PKG_CONST');
  check('the package constant carries the declaration text', constRow && constRow.detail, 'int PKG_CONST');
  check('the package constant inserts its bare name', constRow && constRow.insertText, 'PKG_CONST');
  checkTrue(
    'the package enum type is offered as a Class row',
    (builtItems || []).some((i) => i.label === 'pkg_state_t' && i.kind === kindOf.Class)
  );
  check(
    'the package enum values are EnumMember rows',
    (builtItems || []).filter((i) => i.kind === kindOf.EnumMember).map((i) => i.label).sort(),
    ['A1', 'A2']
  );
  checkTrue('the wildcard import is resolved to its package', peeked.includes('my_pkg'));
  checkTrue('a built index keeps the local declarations', hasLabel(builtItems, 'data_valid'));
  check('a package the document does not import contributes no rows', hasPackageRow(otherItems), false);
  checkTrue('the other document still returns its local declaration', hasLabel(otherItems, 'data_valid'));
  checkTrue("the other document offers no members of the unimported package", !labels(otherItems).includes('A1'));

  // ------------------------------------- symbol kinds and symbol ranking -----
  // One module declares every kind the engine can produce, so the provider's
  // `ScopeSymbolKind` -> `vscode.CompletionItemKind` map is pinned in one place.
  const kindsText = [
    'module kinds #(parameter int W = 8) (',
    '  input logic clk,',
    '  output logic [W-1:0] data',
    ');',
    '  typedef enum logic [1:0] {IDLE, RUN} state_t;',
    '  typedef struct packed { logic sbit; } pair_t;',
    '  logic addr;',
    '  child u_child (.a(addr));',
    '  function automatic int f(int x);',
    '    int tmp;',
    '    tmp = x;',
    '    return tmp;',
    '  endfunction',
    '  task t();',
    '    int tv;',
    '  endtask',
    'endmodule',
  ].join('\n');
  const docKinds = stub.makeDocument(kindsText, { fileName: '/tmp/stub_kinds.sv' });
  const kindItems = await providerC.provideCompletionItems(docKinds, atLine(docKinds, 6));
  const kindOfLabel = (list, label) => {
    const row = (list || []).find((i) => i.label === label);
    return row && row.kind;
  };

  check('port clk is a Field row', kindOfLabel(kindItems, 'clk'), kindOf.Field);
  check('port data is a Field row', kindOfLabel(kindItems, 'data'), kindOf.Field);
  check('header parameter W is a Constant row', kindOfLabel(kindItems, 'W'), kindOf.Constant);
  const paramRow = (kindItems || []).find((i) => i.label === 'W');
  checkTrue(
    'header parameter W detail keeps the declaration text',
    !!paramRow &&
      typeof paramRow.detail === 'string' &&
      paramRow.detail.includes('W') &&
      paramRow.detail.includes('8')
  );
  check('instance u_child is a Field row', kindOfLabel(kindItems, 'u_child'), kindOf.Field);
  check('signal addr is a Field row', kindOfLabel(kindItems, 'addr'), kindOf.Field);
  check('enum typedef state_t is a Class row', kindOfLabel(kindItems, 'state_t'), kindOf.Class);
  check('struct typedef pair_t is a Class row', kindOfLabel(kindItems, 'pair_t'), kindOf.Class);
  check('enum value IDLE is an EnumMember row', kindOfLabel(kindItems, 'IDLE'), kindOf.EnumMember);
  check('enum value RUN is an EnumMember row', kindOfLabel(kindItems, 'RUN'), kindOf.EnumMember);
  check('function f is a Function row', kindOfLabel(kindItems, 'f'), kindOf.Function);
  check('task t is a Method row', kindOfLabel(kindItems, 't'), kindOf.Method);

  // A function body also lists the enclosing scope plus its own locals/arguments.
  const fnItems = await providerC.provideCompletionItems(docKinds, atLine(docKinds, 11));
  check('function-local tmp is a Variable row', kindOfLabel(fnItems, 'tmp'), kindOf.Variable);
  check('function argument x is a Variable row', kindOfLabel(fnItems, 'x'), kindOf.Variable);
  checkTrue('a function body still sees the enclosing module port', hasLabel(fnItems, 'clk'));

  const taskItems = await providerC.provideCompletionItems(docKinds, atLine(docKinds, 14));
  check('task-local tv is a Variable row', kindOfLabel(taskItems, 'tv'), kindOf.Variable);

  // Ranking: symbol rows carry a `'0'`-prefixed sortText, snippets carry none, so
  // `'0addr'` sorts before the `always_ff` label and symbol rows lead the list.
  const rankText = ['module top;', '  logic addr;', '  a', 'endmodule'].join('\n');
  const docRank = stub.makeDocument(rankText, { fileName: '/tmp/stub_rank.sv' });
  const rankItems = await providerC.provideCompletionItems(docRank, atLine(docRank, 2));
  const addrRow = (rankItems || []).find((i) => i.label === 'addr');
  const ffRow = (rankItems || []).find((i) => i.label === 'always_ff');
  check('a symbol row keeps the 0-prefixed sortText', addrRow && addrRow.sortText, '0addr');
  check('the always_ff snippet keeps no sortText', ffRow && ffRow.sortText, undefined);
  checkTrue(
    'symbol rows sort before the always_ff snippet',
    !!addrRow && typeof addrRow.sortText === 'string' && addrRow.sortText < 'always_ff'
  );

  // ------------------------------------------ regression: untouched paths -----
  // No cross-scope leakage: a sibling module's declarations stay out of the list.
  const crossText = [
    'module one;',
    '  logic one_only;',
    '  one',
    'endmodule',
    'module two;',
    '  logic two_only;',
    '  two',
    'endmodule',
  ].join('\n');
  const docCross = stub.makeDocument(crossText, { fileName: '/tmp/stub_cross.sv' });
  const crossOne = await providerC.provideCompletionItems(docCross, atLine(docCross, 2));
  const crossTwo = await providerC.provideCompletionItems(docCross, atLine(docCross, 6));
  checkTrue('module one sees its own declaration', hasLabel(crossOne, 'one_only'));
  check('module one never sees module two declarations', hasLabel(crossOne, 'two_only'), false);
  checkTrue('module two sees its own declaration', hasLabel(crossTwo, 'two_only'));
  check('module two never sees module one declarations', hasLabel(crossTwo, 'one_only'), false);

  // `$` and `` ` `` contexts keep their own candidate sets and add no symbol rows.
  const ctxDecl = ['module ctx;', '  logic [7:0] data_valid;'];
  const dollarText = ctxDecl.concat(['  $di', 'endmodule']).join('\n');
  const docDollar = stub.makeDocument(dollarText, { fileName: '/tmp/stub_ctx_dollar.sv' });
  const dollarItems = await providerC.provideCompletionItems(docDollar, atLine(docDollar, 2));
  checkTrue("'$di' still yields $display()", (dollarItems || []).some((i) => i.detail === '$display()'));
  check(
    'the $ context adds no symbol rows',
    (dollarItems || []).filter((i) => typeof i.sortText === 'string' && i.sortText.startsWith('0')).length,
    0
  );

  const tickCtxText = ctxDecl.concat(['  `inc', 'endmodule']).join('\n');
  const docTickCtx = stub.makeDocument(tickCtxText, { fileName: '/tmp/stub_ctx_tick.sv' });
  const tickCtxItems = await providerC.provideCompletionItems(docTickCtx, atLine(docTickCtx, 2));
  checkTrue("'`inc' still yields `include", hasLabel(tickCtxItems, 'include'));
  check(
    'the backtick context adds no symbol rows',
    (tickCtxItems || []).filter((i) => typeof i.sortText === 'string' && i.sortText.startsWith('0')).length,
    0
  );

  // `::` keeps resolving the local enum type and nothing from the symbol table.
  const scopeCtxText = [
    'module scope_ctx;',
    '  typedef enum logic [1:0] {IDLE, RUN} state_t;',
    '  logic [7:0] data_valid;',
    '  state_t::',
    'endmodule',
  ].join('\n');
  const docScopeCtx = stub.makeDocument(scopeCtxText, { fileName: '/tmp/stub_ctx_scope.sv' });
  const scopeCtxItems = await providerC.provideCompletionItems(docScopeCtx, atLine(docScopeCtx, 3));
  check("'::' still returns only the enum members", labels(scopeCtxItems).sort(), ['IDLE', 'RUN']);
  check(
    'the :: context adds no symbol rows',
    (scopeCtxItems || []).filter((i) => typeof i.sortText === 'string' && i.sortText.startsWith('0')).length,
    0
  );

  // Malformed input must degrade to a candidate list, never throw.
  async function completionOrError(text, line, fileName) {
    const doc = stub.makeDocument(text, { fileName });
    try {
      const items = await providerC.provideCompletionItems(doc, atLine(doc, line));
      return { error: '', items };
    } catch (e) {
      return { error: (e && e.message) || String(e), items: null };
    }
  }

  const malComment = await completionOrError(
    ['module top;', '  /* unterminated', '  da'].join('\n'),
    2,
    '/tmp/stub_mal_comment.sv'
  );
  check('an unterminated block comment does not throw', malComment.error, '');
  checkTrue('an unterminated block comment still returns candidates', Array.isArray(malComment.items));

  const malNoEnd = await completionOrError(
    ['module top;', '  logic [7:0] data_valid;', '  da'].join('\n'),
    2,
    '/tmp/stub_mal_noend.sv'
  );
  check('a module without endmodule does not throw', malNoEnd.error, '');
  checkTrue('a module without endmodule still offers its declaration', hasLabel(malNoEnd.items, 'data_valid'));

  const malString = await completionOrError(
    ['module top;', '  string s = "module";', '  da', 'endmodule'].join('\n'),
    2,
    '/tmp/stub_mal_string.sv'
  );
  check('a module keyword inside a string literal does not throw', malString.error, '');
  checkTrue('a module keyword inside a string literal still returns candidates', Array.isArray(malString.items));

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.log('FATAL');
  console.log(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
