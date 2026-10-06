const assert = require('assert');
const { findInstantiationSites, enclosingModuleName } = require('../out/instances.js');

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

const aText = [
  'module top;',
  '  child u_a ();',
  '  child u_b ();',
  '  generate',
  '    for (genvar i = 0; i < 2; i++) begin : g',
  '      child u_g ();',
  '    end',
  '  endgenerate',
  'endmodule',
].join('\n');

const bText = [
  'module mid;',
  '  child #(',
  '    .P(1)',
  '  ) u_p (',
  '    .clk(clk)',
  '  );',
  '  // child u_comment ();',
  '  string s = "child u_str (";',
  '  other u_o ();',
  'endmodule',
].join('\n');

const cText = ['module other;', '  child u_arr [3:0] ();', 'endmodule', ''].join('\n');

const dText = ['module child;', '  // the definition, not an instance', 'endmodule', ''].join('\n');

const files = [
  { path: 'a.sv', text: aText },
  { path: 'b.sv', text: bText },
  { path: 'c.sv', text: cText },
  { path: 'd.sv', text: dText },
];

check('findInstantiationSites', findInstantiationSites(files, 'child'), [
  { parent: 'top', instance: 'u_a', file: 'a.sv', line: 1 },
  { parent: 'top', instance: 'u_b', file: 'a.sv', line: 2 },
  { parent: 'top', instance: 'u_g', file: 'a.sv', line: 5 },
  { parent: 'mid', instance: 'u_p', file: 'b.sv', line: 1 },
  { parent: 'other', instance: 'u_arr', file: 'c.sv', line: 1 },
]);

check('findInstantiationSites empty target', findInstantiationSites(files, ''), []);

check('findInstantiationSites unknown target', findInstantiationSites(files, 'nope'), []);

check('enclosingModuleName body', enclosingModuleName(aText, aText.indexOf('u_b')), 'top');

check('enclosingModuleName declaration', enclosingModuleName(aText, aText.indexOf('top')), 'top');

check('enclosingModuleName outside', enclosingModuleName('`include "x.svh"\nmodule m;\nendmodule\n', 0), '');

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
