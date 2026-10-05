const fs = require('fs');
const path = require('path');
const sv = require('../out/beautifier.js');

const dir = path.join(__dirname, 'data', 'verilog_beautifier');

function run(name, input, expected, cfg) {
  const b = new sv.VerilogBeautifier({ nbSpace: 4, ...cfg });
  const txt = fs.readFileSync(path.join(dir, input), 'utf8').replace(/\r\n/g, '\n');
  const exp = fs.readFileSync(path.join(dir, expected), 'utf8').replace(/\r\n/g, '\n');
  const actual = b.beautifyText(txt);
  if (actual === exp) {
    return true;
  }
  console.log(`FAIL ${name} (${input})`);
  const al = actual.split('\n');
  const el = exp.split('\n');
  for (let i = 0; i < Math.max(al.length, el.length); i++) {
    if (al[i] !== el[i]) {
      console.log(`  line ${i + 1}:`);
      console.log(`   actual  : ${JSON.stringify(al[i])}`);
      console.log(`   expected: ${JSON.stringify(el[i])}`);
      break;
    }
  }
  return false;
}

const cases = [
  ['test0', 'test0.sv', 'test0_expected.sv', {}],
  ['test0Tab', 'test0.sv', 'test0_tab_expected.sv', { useTab: true }],
  ['test2', 'test2.sv', 'test2_expected.sv', {}],
  ['test3', 'test3.sv', 'test3_expected.sv', { nbSpace: 3 }],
  ['test3Indent', 'test3.sv', 'test3_indent_expected.sv', { nbSpace: 2, reindentOnly: true, stripEmptyLine: false }],
  ['typedef', 'typedef.sv', 'typedef_exp.sv', { nbSpace: 2 }],
  ['param', 'param.sv', 'param_exp.sv', {}],
  ['test6', 'test6.sv', 'test6_expected.sv', {}],
  ['test7', 'test7.sv', 'test7_expected.sv', { oneDeclPerLine: true, paramOneLine: false }],
  ['moduleDecl', 'module_decl.sv', 'module_decl_expected.sv', {}],
  ['moduleImport', 'module_import.sv', 'module_import_exp.sv', { nbSpace: 3 }],
  ['test9', 'test9.sv', 'test9_expected.sv', {}],
  // test10 is a known failure of the reference implementation (skipped by the
  // original Python test driver as well) and is intentionally not checked here.
  // ['test10', 'test10.sv', 'test10_expected.sv', {}],
  ['test11', 'test11.sv', 'test11_expected.sv', { stripEmptyLine: false }],
  ['test11Strip', 'test11.sv', 'test11_strip_expected.sv', { stripEmptyLine: true }],
  ['test12', 'test12.sv', 'test12_expected.sv', {}],
  ['test13', 'test13.sv', 'test13_expected.sv', {}],
  ['test13ign', 'test13.sv', 'test13_ignore_expected.sv', { ignoreTick: true }],
  ['portArray', 'port_array.sv', 'port_array_exp.sv', {}],
  ['instNoAlign', 'instance.sv', 'instance_no_align.sv', { instAlignPort: false }],
  ['inst', 'instance_no_align.sv', 'instance.sv', {}],
  ['cstyle', 'cstyle_array.sv', 'cstyle_array_exp.sv', {}],
  ['assertion', 'assertion.sv', 'assertion_exp.sv', {}],
  ['macro', 'macro.sv', 'macro_exp.sv', {}],
  ['extern', 'extern.sv', 'extern.sv', {}],
  ['always_nobegin', 'always_nobegin.sv', 'always_nobegin_exp.sv', { nbSpace: 3 }],
  ['generate', 'generate.sv', 'generate_exp.sv', { nbSpace: 3 }],
  ['moduleParam', 'module_param.sv', 'module_param_exp.sv', { nbSpace: 4 }],
];

let pass = 0;
let fail = 0;
for (const [name, input, expected, cfg] of cases) {
  if (run(name, input, expected, cfg)) {
    pass++;
  } else {
    fail++;
  }
}
console.log(`\nBEAUTIFIER PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
