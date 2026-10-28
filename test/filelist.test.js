const path = require('path');
const assert = require('assert');
const {
  resolveFileList,
  followIncludes,
  parseIncludes,
  stripComment,
  tokenize,
  expandEnv,
  resolveLinkTarget,
  resolveSourcePath,
} = require('../out/filelist.js');

const base = path.resolve(__dirname, 'virtual_filelist');

const contents = {
  [path.join(base, 'top.f')]: [
    '// a comment',
    '# another comment',
    '',
    'a.sv',
    'sub/b.v',
    '"my file.sv"',
    '+incdir+inc_a+inc_b',
    '-I inc_c',
    '-Iinc_d',
    '-v lib.v',
    '-f nested.f',
    '-fjoined.f',
    '-incfile inc_list.f',
    '-incfilejoined_list.f',
    '$RTL/c.sv',
    'a.sv \\',
    'dup.sv',
    'split\\',
    'path.sv',
  ].join('\n'),
  [path.join(base, 'nested.f')]: 'nested.sv\n',
  [path.join(base, 'joined.f')]: 'joined.sv\n',
  [path.join(base, 'inc_list.f')]: '// header list\ninc_extra.svh\n\nsub/deep.svh\n',
  [path.join(base, 'joined_list.f')]: 'joined_inc.svh\n',
};

const incBase = path.join(base, 'inc');
contents[path.join(incBase, 'main.svh')] =
  '`include "sub/a.svh"\n`include <b.svh>\n`include `MACRO/ignored.svh\n';
contents[path.join(incBase, 'sub', 'a.svh')] = '`include "../lib/c.svh"\n';
contents[path.join(incBase, 'lib', 'b.svh')] = '// b\n';
contents[path.join(incBase, 'lib', 'c.svh')] = '// c\n';
contents[path.join(incBase, 'd.svh')] = '`include "e.svh"\n';
contents[path.join(incBase, 'e.svh')] = '`include "d.svh"\n';
contents[path.join(incBase, 'unres.svh')] = '`include "missing.svh"\n';

// A "link file" holds nothing but the path of the real source; the target is
// resolved relative to the link's own directory.
contents[path.join(base, 'link', 'alias.svh')] = 'impl.svh\n';
contents[path.join(base, 'link', 'impl.svh')] = '`include "nested.svh"\n';
contents[path.join(base, 'link', 'nested.svh')] = '// nested\n';
contents[path.join(base, 'link', 'broken.svh')] = 'missing_target.svh\n';

const readText = (p) => (Object.prototype.hasOwnProperty.call(contents, p) ? contents[p] : null);

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

check('stripComment', stripComment('a.sv // c').trim(), 'a.sv');
check('stripComment hash', stripComment('a.sv # c').trim(), 'a.sv');
check('stripComment quoted', stripComment('"a//b.sv"').trim(), '"a//b.sv"');
check('tokenize quoted', tokenize('"my file.sv" other.sv'), ['my file.sv', 'other.sv']);
check('expandEnv', expandEnv('$RTL/${TOP}/x', { RTL: 'rtl', TOP: 'top' }), 'rtl/top/x');

const result = resolveFileList(path.join(base, 'top.f'), base, readText, { RTL: 'rtl' });
check(
  'resolveFileList.files',
  result.files.sort(),
  [
    path.join(base, 'a.sv'),
    path.join(base, 'sub', 'b.v'),
    path.join(base, 'my file.sv'),
    path.join(base, 'nested.sv'),
    path.join(base, 'joined.sv'),
    path.join(base, 'inc_extra.svh'),
    path.join(base, 'sub', 'deep.svh'),
    path.join(base, 'joined_inc.svh'),
    path.join(base, 'rtl', 'c.sv'),
    path.join(base, 'dup.sv'),
    path.join(base, 'splitpath.sv'),
  ].sort()
);
check(
  'resolveFileList.incdirs',
  result.incdirs.sort(),
  [
    path.join(base, 'inc_a'),
    path.join(base, 'inc_b'),
    path.join(base, 'inc_c'),
    path.join(base, 'inc_d'),
  ].sort()
);

check('parseIncludes', parseIncludes('`include "x.svh"\n`include <y.svh>'), ['x.svh', 'y.svh']);

check(
  'parseIncludes ignores comments',
  parseIncludes(
    [
      '// `include "gone.svh"',
      '/* `include "also_gone.svh" */',
      '`include "real.svh" // trailing comment',
      '/* multi',
      '   `include "block.svh"',
      '*/',
      '$display("http://host/x"); `include "after_url.svh"',
    ].join('\n')
  ),
  ['real.svh', 'after_url.svh']
);

const closure = followIncludes([path.join(incBase, 'main.svh')], [path.join(incBase, 'lib')], readText);
check(
  'followIncludes',
  closure.sort(),
  [
    path.join(incBase, 'main.svh'),
    path.join(incBase, 'sub', 'a.svh'),
    path.join(incBase, 'lib', 'b.svh'),
    path.join(incBase, 'lib', 'c.svh'),
  ].sort()
);

const cyclic = followIncludes([path.join(incBase, 'd.svh')], [], readText);
check('followIncludes cycle', cyclic.sort(), [path.join(incBase, 'd.svh'), path.join(incBase, 'e.svh')].sort());

const unresolved = [];
followIncludes([path.join(incBase, 'unres.svh')], [], readText, (inc) => unresolved.push(inc));
check('followIncludes unresolved', unresolved, ['missing.svh']);

const alias = path.join(base, 'link', 'alias.svh');
const impl = path.join(base, 'link', 'impl.svh');
check('resolveLinkTarget', resolveLinkTarget(alias, 'impl.svh\n'), impl);
check('resolveLinkTarget ignores source', resolveLinkTarget(alias, '`include "impl.svh"\n'), null);
check('resolveSourcePath link', resolveSourcePath(alias, readText), impl);
check('resolveSourcePath missing target', resolveSourcePath(path.join(base, 'link', 'broken.svh'), readText), path.join(base, 'link', 'broken.svh'));
check('resolveSourcePath source', resolveSourcePath(path.join(incBase, 'main.svh'), readText), path.join(incBase, 'main.svh'));
check(
  'followIncludes through link',
  followIncludes([alias], [], readText).sort(),
  [impl, path.join(base, 'link', 'nested.svh')].sort()
);

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
