const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { expandGlobDirs, hasGlob } = require('../out/glob.js');

// Real directories are used because the expander probes the filesystem; the tree
// lives in a temporary folder and is removed at the end.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-glob-'));

function mkdir(rel) {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
}

function writeFile(rel) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
}

mkdir('rtl/core/inc');
mkdir('rtl/dma/inc');
mkdir('rtl/dma/deep/nested/inc');
mkdir('lib/inc');
mkdir('lib/notinc');
writeFile('rtl/file.txt');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
  } catch {
    fail++;
    console.log(`FAIL ${name}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// Workspace-relative, forward-slash paths keep the expectations readable.
function rel(list) {
  return list.map((p) => path.relative(root, p).split(path.sep).join('/')).sort();
}

function expand(pattern) {
  return rel(expandGlobDirs(path.join(root, pattern)));
}

check('hasGlob wildcard', hasGlob('rtl/*/inc'), true);
check('hasGlob question mark', hasGlob('rt?/inc'), true);
check('hasGlob literal', hasGlob('rtl/core/inc'), false);

check('single star', expand('rtl/*/inc'), ['rtl/core/inc', 'rtl/dma/inc']);
check('double star', expand('**/inc'), [
  'lib/inc',
  'rtl/core/inc',
  'rtl/dma/deep/nested/inc',
  'rtl/dma/inc',
]);
check('double star suffix', expand('lib/**'), ['lib', 'lib/inc', 'lib/notinc']);
check('question mark', expand('rt?/*/inc'), ['rtl/core/inc', 'rtl/dma/inc']);
check('literal passthrough', expand('rtl/core/inc'), ['rtl/core/inc']);
check('no match', expand('nope/*/inc'), []);
check('files are not directories', expand('rtl/*.txt'), []);

fs.rmSync(root, { recursive: true, force: true });

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
