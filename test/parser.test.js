const fs = require('fs');
const path = require('path');
const assert = require('assert');
const sv = require('../out/parser.js');

const dataRoot = path.join(__dirname, 'data');

function deepEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch (e) {
    return e;
  }
}

let pass = 0;
let fail = 0;

function runCleanComment(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sv')) continue;
    const base = f.slice(0, -3);
    const input = fs.readFileSync(path.join(dir, f), 'utf8');
    const expected = fs.readFileSync(path.join(dir, base + '.json'), 'utf8');
    const actual = sv
      .cleanComment(input)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .join('\n');
    const exp = expected.replace(/\r\n/g, '\n');
    if (actual === exp) {
      pass++;
    } else {
      fail++;
      console.log(`FAIL clean_comment ${f}`);
      console.log('--- actual ---\n' + actual + '\n--- expected ---\n' + exp);
    }
  }
}

function runParse(dir, fn, name) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sv')) continue;
    const base = f.slice(0, -3);
    const input = fs.readFileSync(path.join(dir, f), 'utf8');
    const expected = JSON.parse(fs.readFileSync(path.join(dir, base + '.json'), 'utf8'));
    const actual = fn(input);
    const r = deepEqual(actual, expected);
    if (r === true) {
      pass++;
    } else {
      fail++;
      console.log(`FAIL ${name} ${f}`);
      console.log(r.message);
    }
  }
}

runCleanComment(path.join(dataRoot, 'clean_comment_data'));
runParse(path.join(dataRoot, 'parse_module_data'), (t) => sv.parseModule(t), 'parse_module');
runParse(path.join(dataRoot, 'parse_package'), (t) => sv.parsePackage(t), 'parse_package');

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
