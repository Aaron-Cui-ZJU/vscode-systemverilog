const assert = require('assert');
const { findPortBindingContext, buildBindingSuggestions } = require('../out/portCompletion.js');

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

// Offset just after the whole line that equals `lineText`.
function dotCursor(text, lineText) {
  const lines = text.split('\n');
  const idx = lines.indexOf(lineText);
  if (idx < 0) {
    throw new Error(`line not found: ${lineText}`);
  }
  let off = 0;
  for (let i = 0; i < idx; i++) {
    off += lines[i].length + 1;
  }
  return off + lineText.length;
}

const multiText = [
  'module top;',
  '  child u_c (',
  '    .a(a)',
  '    .',
  '  );',
  'endmodule',
].join('\n');

const multiCtx = findPortBindingContext(multiText, dotCursor(multiText, '    .'));

checkTrue('multiline context found', multiCtx);
check('multiline moduleName', multiCtx.moduleName, 'child');
check('multiline instanceName', multiCtx.instanceName, 'u_c');
check('multiline bound', Array.from(multiCtx.bound), ['a']);
check('multiline hasBinding', multiCtx.hasBinding, false);
check('multiline isLast', multiCtx.isLast, true);
check('multiline multiline', multiCtx.multiline, true);
check('multiline commaOffset', multiCtx.commaOffset, multiText.indexOf(')') + 1);

const commaText = [
  'module top;',
  '  child u_c (',
  '    .a(a),',
  '    .',
  '  );',
  'endmodule',
].join('\n');
const commaCtx = findPortBindingContext(commaText, dotCursor(commaText, '    .'));
check('trailing comma commaOffset', commaCtx.commaOffset, null);

const afterText = [
  'module top;',
  '  child u_c (',
  '    .a(a),',
  '    .',
  '    .b(b)',
  '  );',
  'endmodule',
].join('\n');
const afterCtx = findPortBindingContext(afterText, dotCursor(afterText, '    .'));
check('binding after isLast', afterCtx.isLast, false);
check('binding after bound', Array.from(afterCtx.bound), ['a', 'b']);
const afterSuggestions = buildBindingSuggestions(afterCtx, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
check('binding after labels', afterSuggestions.map((s) => s.label), ['c']);
checkTrue('binding after trailing comma', afterSuggestions[0].insertText.endsWith(','));

const prefixText = [
  'module top;',
  '  child u_c (',
  '    .cl',
  '  );',
  'endmodule',
].join('\n');
const prefixCtx = findPortBindingContext(prefixText, dotCursor(prefixText, '    .cl'));
check('prefix hasBinding', prefixCtx.hasBinding, true);
check('prefix commaOffset', prefixCtx.commaOffset, null);
const prefixSuggestions = buildBindingSuggestions(prefixCtx, [{ name: 'clk' }, { name: 'rst' }]);
check('prefix labels', prefixSuggestions.map((s) => s.label), ['clk', 'rst']);
check('prefix insertText', prefixSuggestions[0].insertText, 'clk');
check('prefix isSnippet', prefixSuggestions[0].isSnippet, false);

const paramText = [
  'module top;',
  '  child #(',
  '    .P(1),',
  '    .Q(2)',
  '  ) u_c [1:0] (',
  '    .a(a)',
  '    .',
  '  );',
  'endmodule',
].join('\n');
const paramCtx = findPortBindingContext(paramText, dotCursor(paramText, '    .'));
checkTrue('parameter list context found', paramCtx);
check('parameter list moduleName', paramCtx.moduleName, 'child');
check('parameter list instanceName', paramCtx.instanceName, 'u_c');

const commentText = [
  'module top;',
  '  child u_c (',
  '    .a(a) // .b(b)',
  '    .',
  '  );',
  'endmodule',
].join('\n');
const commentCtx = findPortBindingContext(commentText, dotCursor(commentText, '    .'));
check('comment bound', Array.from(commentCtx.bound), ['a']);
checkTrue('comment does not bind b', !commentCtx.bound.has('b'));

const wildcardText = [
  'module top;',
  '  child u_c (',
  '    .a(a),',
  '    .*',
  '    .',
  '  );',
  'endmodule',
].join('\n');
const wildcardCtx = findPortBindingContext(wildcardText, dotCursor(wildcardText, '    .'));
check('wildcard flag', wildcardCtx.wildcard, true);
check(
  'wildcard suggestions',
  buildBindingSuggestions(wildcardCtx, [{ name: 'a' }, { name: 'b' }]),
  []
);

const memberText = ['module top;', '  u_dut.', 'endmodule'].join('\n');
check('member completion not a context', findPortBindingContext(memberText, dotCursor(memberText, '  u_dut.')), null);

const assignText = ['module top;', '  assign x = y.', 'endmodule'].join('\n');
check('assignment dot not a context', findPortBindingContext(assignText, dotCursor(assignText, '  assign x = y.')), null);

const declText = 'module child (';
check('module declaration header not a context', findPortBindingContext(declText, declText.length), null);

const declDotText = ['module child (', '  .', ');'].join('\n');
check('module declaration dot not a context', findPortBindingContext(declDotText, dotCursor(declDotText, '  .')), null);

const outsideText = ['module top;', '  .', 'endmodule'].join('\n');
check('dot outside parentheses not a context', findPortBindingContext(outsideText, dotCursor(outsideText, '  .')), null);

const alignText = ['module top;', '  child u_c (', '    .', '  );', 'endmodule'].join('\n');
const alignCtx = findPortBindingContext(alignText, dotCursor(alignText, '    .'));
const alignPorts = [{ name: 'a' }, { name: 'long_name' }, { name: 'clk' }];
const alignSuggestions = buildBindingSuggestions(alignCtx, alignPorts);
check('alignment pad', alignSuggestions[0].insertText, 'a        (${1:a})');
check('alignment last no comma', alignSuggestions[2].insertText, 'clk      (${1:clk})');
checkTrue('alignment isSnippet', alignSuggestions[0].isSnippet);

const oneLineText = '  child u_c (.);';
const oneLineCtx = findPortBindingContext(oneLineText, oneLineText.lastIndexOf('.') + 1);
check('single line multiline', oneLineCtx.multiline, false);
check(
  'single line no padding',
  buildBindingSuggestions(oneLineCtx, [{ name: 'a' }, { name: 'bbb' }]).map((s) => s.insertText),
  ['a(${1:a})', 'bbb(${1:bbb})']
);

const orderPorts = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
const orderSuggestions = buildBindingSuggestions(afterCtx, orderPorts);
check('declaration order labels', orderSuggestions.map((s) => s.label), ['c', 'd']);
check('declaration order order', orderSuggestions.map((s) => s.order), [2, 3]);

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
