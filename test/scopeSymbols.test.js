const assert = require('assert');
const { maskComments, maskCommentRanges } = require('../out/parser.js');
const {
  buildScopeTable,
  enclosingSpan,
  symbolsAt,
  isCodePosition,
  importedPackages,
  packageImportSource,
} = require('../out/scopeSymbols.js');

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

function names(list) {
  return list.map((s) => s.name);
}

function kindOf(list, name) {
  const found = list.find((s) => s.name === name);
  return found ? found.kind : null;
}

// Offset just after the whole line that equals `lineText`.
function endOfLine(text, lineText) {
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

// ---------------------------------------------------------------- mask ranges

// `maskCommentRanges` must stay byte-identical to `maskComments`, keep the
// length, and report every masked [start, end) region.
const maskInputs = [
  'a // c\nb',
  'a /* c */ b',
  'x = "str // not comment"; y',
  '/* unterminated',
  'a\r\n// crlf\r\nb',
  's = "esc \\" quote";',
  'no comments at all',
];
for (const src of maskInputs) {
  const r = maskCommentRanges(src);
  check(`mask ranges masked equals maskComments: ${JSON.stringify(src)}`, r.masked, maskComments(src));
  check(`mask ranges keeps length: ${JSON.stringify(src)}`, r.masked.length, src.length);
}

const rangeProbe = maskCommentRanges('a // c\nb /* d */ e');
check('mask ranges count', rangeProbe.ranges.length, 2);
check('mask ranges first span', rangeProbe.ranges[0], [2, 6]);
check('mask ranges second span', rangeProbe.ranges[1], [9, 16]);
check('mask ranges spaces kept', rangeProbe.masked.slice(2, 6), '    ');
check('mask ranges newline kept', rangeProbe.masked[6], '\n');
check('mask ranges block comment masked', rangeProbe.masked.slice(9, 16), '       ');
check('mask ranges text untouched', rangeProbe.masked.slice(0, 2) + rangeProbe.masked.slice(7, 9), 'a b ');

// ------------------------------------------------------------------ main file

const sv = [
  'module top #(parameter int W = 8) (input logic clk, output logic [W-1:0] data);',
  '  typedef enum logic [1:0] {IDLE, RUN} state_t;',
  '  state_t st;',
  '  logic [7:0] data_valid;',
  '  child u_child (.a(data));',
  '  import my_pkg::*;',
  '  function automatic int f(int a);',
  '    int tmp;',
  '    return a + tmp;',
  '  endfunction',
  '  // data_valid',
  '  // foo bar ',
  '  initial $display("data_");',
  'endmodule',
  'logic g;',
  'module other;',
  '  logic only_here;',
  'endmodule',
].join('\n');

const table = buildScopeTable(sv);
const inTop = endOfLine(sv, '  logic [7:0] data_valid;');
const topSymbols = symbolsAt(table, inTop);
const topNames = names(topSymbols);

check('table text round-trip', table.text, sv);
check('table masked length', table.masked.length, sv.length);
checkTrue('table has no comment text', !table.masked.includes('data_valid //'));
check('table spans count', table.spans.length, 2);
check('table span kinds', table.spans.map((s) => s.kind), ['module', 'module']);
check('table span names', table.spans.map((s) => s.name), ['top', 'other']);

check('module scope port kind clk', kindOf(topSymbols, 'clk'), 'port');
check('module scope port kind data', kindOf(topSymbols, 'data'), 'port');
check('module scope param kind W', kindOf(topSymbols, 'W'), 'param');
check('module scope typedef kind state_t', kindOf(topSymbols, 'state_t'), 'typedef');
check('module scope enum value IDLE', kindOf(topSymbols, 'IDLE'), 'enumValue');
check('module scope enum value RUN', kindOf(topSymbols, 'RUN'), 'enumValue');
check('module scope signal kind st', kindOf(topSymbols, 'st'), 'signal');
check('module scope signal kind data_valid', kindOf(topSymbols, 'data_valid'), 'signal');
check('module scope instance kind u_child', kindOf(topSymbols, 'u_child'), 'instance');
check('module scope function kind f', kindOf(topSymbols, 'f'), 'function');
checkTrue('module scope detail keeps declaration', topSymbols.find((s) => s.name === 'data_valid').detail.includes('[7:0]'));
check('module scope param detail', topSymbols.find((s) => s.name === 'W').detail, 'int');
checkTrue('module scope instance detail', topSymbols.find((s) => s.name === 'u_child').detail.includes('child'));
checkTrue('module scope every detail non-empty', topSymbols.every((s) => typeof s.detail === 'string' && s.detail.length > 0));

// No scope leak from the sibling module, and no $unit declarations inside a module.
checkTrue('no sibling module leak', !topNames.includes('only_here'));
checkTrue('no $unit leak into module', !topNames.includes('g'));

check('enclosingSpan innermost', enclosingSpan(table, inTop).name, 'top');
check('enclosingSpan outside spans', enclosingSpan(table, sv.indexOf('logic g;') + 3), null);

// $unit declarations are visible at file level, sibling modules are not.
const unitSymbols = symbolsAt(table, sv.indexOf('logic g;') + 3);
checkTrue('$unit contains g', names(unitSymbols).includes('g'));
checkTrue('$unit excludes module body', !names(unitSymbols).includes('only_here'));
checkTrue('$unit excludes module ports', !names(unitSymbols).includes('clk'));

// ------------------------------------------------------ function locals (IS-4)

const inFnBody = endOfLine(sv, '    return a + tmp;');
const fnSymbols = symbolsAt(table, inFnBody);
check('function local arg a', kindOf(fnSymbols, 'a'), 'local');
check('function local body tmp', kindOf(fnSymbols, 'tmp'), 'local');
check('function body keeps function name', kindOf(fnSymbols, 'f'), 'function');
checkTrue('function body keeps module ports', names(fnSymbols).includes('clk'));
const beforeFn = symbolsAt(table, sv.indexOf('  typedef enum') + 4);
checkTrue('locals not visible outside function', !names(beforeFn).includes('tmp'));

// ---------------------------------------------- interface / package / $unit

const ifaceText = ['interface bus;', '  logic v;', 'endinterface'].join('\n');
const ifaceTable = buildScopeTable(ifaceText);
const ifaceSymbols = symbolsAt(ifaceTable, endOfLine(ifaceText, '  logic v;'));
check('interface span kind', ifaceTable.spans[0].kind, 'interface');
check('interface symbol v', kindOf(ifaceSymbols, 'v'), 'signal');

const pkgText = ['package p;', '  typedef enum {A, B} t;', '  parameter int P = 1;', 'endpackage'].join('\n');
const pkgTable = buildScopeTable(pkgText);
const pkgSymbols = symbolsAt(pkgTable, endOfLine(pkgText, '  parameter int P = 1;'));
check('package span kind', pkgTable.spans[0].kind, 'package');
check('package typedef t', kindOf(pkgSymbols, 't'), 'typedef');
check('package enum value A', kindOf(pkgSymbols, 'A'), 'enumValue');
check('package enum value B', kindOf(pkgSymbols, 'B'), 'enumValue');
check('package parameter P', kindOf(pkgSymbols, 'P'), 'signal');

const unitText = ['logic g;', 'module m;', '  logic inside;', 'endmodule'].join('\n');
const unitTable = buildScopeTable(unitText);
check('unitText keeps length', unitTable.unitText.length, unitText.length);
checkTrue('unitText blanks module body', !unitTable.unitText.includes('inside'));
checkTrue('unitText keeps line breaks', unitTable.unitText.split('\n').length === unitText.split('\n').length);
check('unit symbols g', kindOf(symbolsAt(unitTable, 3), 'g'), 'signal');

// ------------------------------------------- comments / strings (IS-6 probes)

check('comment line cursor', symbolsAt(table, endOfLine(sv, '  // data_valid')), []);

// Cursor right after a space that sits INSIDE the comment: a single-character
// comparison against the mask would wrongly report "code" here.
const afterInnerSpace = endOfLine(sv, '  // foo bar ');
check('comment inner space cursor', symbolsAt(table, afterInnerSpace), []);
check('comment inner space isCodePosition', isCodePosition(table, afterInnerSpace), false);
check('comment start isCodePosition', isCodePosition(table, sv.indexOf('// data_valid')), false);
check('code isCodePosition', isCodePosition(table, inTop), true);
check('offset 0 isCodePosition', isCodePosition(table, 0), true);

const stringCursor = sv.indexOf('"data_') + '"data_'.length;
check('string literal cursor', symbolsAt(table, stringCursor), []);
check('string literal isCodePosition', isCodePosition(table, stringCursor), false);

// ------------------------------------------------------- imports / sources

check('importedPackages single', importedPackages('import my_pkg::*;'), ['my_pkg']);
check('importedPackages list', importedPackages('import a::* , b::*;'), ['a', 'b']);
check('importedPackages nested', importedPackages('import a::b::*;'), ['a']);
check('importedPackages non wildcard', importedPackages('import a::b;'), []);
check('importedPackages commented', importedPackages('// import c::*;'), []);
check('importedPackages multiline', importedPackages('module m;\n  import p1::*;\n  import p2::*;\nendmodule'), [
  'p1',
  'p2',
]);
check('importedPackages dedupe', importedPackages('import a::*;\nimport a::*;'), ['a']);
check('importedPackages string literal', importedPackages('s = "import z::*;";'), []);

const leakText = ['module a;', '  import p1::*;', 'endmodule', 'module b;', '  import p2::*;', 'endmodule'].join('\n');
const leakTable = buildScopeTable(leakText);
const sourceA = packageImportSource(leakTable, endOfLine(leakText, '  import p1::*;'));
const sourceB = packageImportSource(leakTable, endOfLine(leakText, '  import p2::*;'));
check('packageImportSource a', importedPackages(sourceA), ['p1']);
check('packageImportSource b', importedPackages(sourceB), ['p2']);
checkTrue('packageImportSource b has no p1', !importedPackages(sourceB).includes('p1'));
const unitOnlyText = ['logic g;', 'module a;', '  import p1::*;', 'endmodule'].join('\n');
check('packageImportSource unit only', importedPackages(packageImportSource(buildScopeTable(unitOnlyText), 0)), []);

// ------------------------------------------------------------ dedupe (rule l)

const dupText = ['module d;', '  logic a;', '  int a;', 'endmodule'].join('\n');
const dupSymbols = symbolsAt(buildScopeTable(dupText), dupText.indexOf('int a') + 3);
check('dedupe keeps one entry', dupSymbols.filter((s) => s.name === 'a').length, 1);
check('dedupe keeps first declaration', dupSymbols.find((s) => s.name === 'a').detail, 'logic a');

// ---------------------------------------------------------- class exclusion

const classText = ['class c;', '  logic inside_class;', 'endclass', 'logic g;'].join('\n');
const classTable = buildScopeTable(classText);
const classUnitSymbols = symbolsAt(classTable, endOfLine(classText, 'logic g;'));
check('class: no span produced', classTable.spans.length, 0);
checkTrue('class: unit keeps g', names(classUnitSymbols).includes('g'));
checkTrue('class: unit excludes members', !names(classUnitSymbols).includes('inside_class'));
checkTrue('class: unit excludes class name', !names(classUnitSymbols).includes('c'));

// ------------------------------------------------- adversarial: malformed

// Unterminated block comment swallows the rest of the file but must not throw.
const openComment = 'module top;\n  logic a;\n  /* not closed\n';
const ocTable = buildScopeTable(openComment);
check('unterminated comment: no throw', Array.isArray(ocTable.spans), true);
check('unterminated comment: masked', ocTable.masked.includes('logic a;'), true);
checkTrue('unterminated comment: comment text gone', !ocTable.masked.includes('not closed'));
check('unterminated comment: cursor inside', symbolsAt(ocTable, openComment.length - 1), []);

// Missing `endmodule`: the span runs to end of file and parsing still degrades
// to the declarations that are visible.
const noEnd = 'module top;\n  logic a;\n';
const neTable = buildScopeTable(noEnd);
check('unbalanced module: span count', neTable.spans.length, 1);
check('unbalanced module: span end', neTable.spans[0].end, noEnd.length);
check('unbalanced module: span name', neTable.spans[0].name, 'top');
check('unbalanced module: symbol a', kindOf(symbolsAt(neTable, noEnd.indexOf('logic a') + 3), 'a'), 'signal');

// `module` inside a string literal must not open a span.
const strText = 'logic [8*3-1:0] t = "module fake; logic x; endmodule";\nlogic real_one;\n';
const strTable = buildScopeTable(strText);
check('module in string: no span', strTable.spans.length, 0);
checkTrue('module in string: not in masked', !strTable.masked.includes('fake'));
checkTrue('module in string: unit decl kept', names(symbolsAt(strTable, strText.indexOf('logic real_one') + 3)).includes('real_one'));

// ------------------------------------------------ adversarial: stale state

const first = buildScopeTable(sv);
const second = buildScopeTable(sv);
check('build twice equal', JSON.stringify(first), JSON.stringify(second));
checkTrue('build twice distinct objects', first !== second && first.spans !== second.spans && first.unit !== second.unit);
const injected = { name: 'injected', detail: 'x', kind: 'signal' };
first.spans[0].symbols.push(injected);
check('build twice independent', second.spans[0].symbols.some((s) => s.name === 'injected'), false);
checkTrue('symbolsAt returns fresh array', symbolsAt(second, inTop) !== second.spans[0].symbols);

// ------------------------------------------------- adversarial: performance

const bigLines = ['module big;'];
for (let i = 0; i < 5000; i++) {
  bigLines.push(`  logic [7:0] sig_${i};`);
}
bigLines.push('endmodule');
const bigText = bigLines.join('\n');
const bigStart = process.hrtime.bigint();
const bigTable = buildScopeTable(bigText);
const bigMs = Number(process.hrtime.bigint() - bigStart) / 1e6;
console.log(`timing: buildScopeTable(5000 lines) = ${bigMs.toFixed(2)} ms`);
check('5000-line build symbol count', bigTable.unit.length, 0);
check('5000-line span symbol count', bigTable.spans[0].symbols.length, 5000);
checkTrue('5000-line build under 50ms', bigMs < 50);

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
