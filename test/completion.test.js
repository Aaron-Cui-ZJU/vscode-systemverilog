'use strict';
// Provider-level baseline for `src/completion.ts`.
//
// This suite pins the behaviour of the completion provider as it is TODAY, using
// the headless `vscode` stub in `test/helpers/vscodeStub.js`. It is the safety
// net for the scope-symbol work: every existing branch (snippets, system tasks,
// directives, port bindings, `end` closing keywords, `disableAutocomplete`) must
// keep working while document declarations are added.
//
// The single assertion marked BASELINE below states that document declarations
// are NOT offered yet. That assertion is rewritten in place (not deleted) by the
// todo that merges scope symbols into the provider.

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
  // BASELINE: the provider does not offer document declarations yet. `data` only
  // matches the keyword snippets, so `data_valid` must NOT appear. When
  // `src/completion.ts` starts merging scope symbols, rewrite this one
  // assertion to `checkTrue(...)` (expected `true`) - nothing else changes.
  const declText = ['module top;', '  logic [7:0] data_valid;', '  data', 'endmodule'].join('\n');
  const docDecl = stub.makeDocument(declText, { fileName: '/tmp/stub_decl.sv' });
  const declItems = await provider.provideCompletionItems(docDecl, atLine(docDecl, 2));
  check(
    'BASELINE: document declaration data_valid is not offered yet',
    hasLabel(declItems, 'data_valid'),
    false
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

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.log('FATAL');
  console.log(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
