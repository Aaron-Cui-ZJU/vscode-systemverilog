// Activation smoke test.
//
// The extension is published with `vsce publish --no-dependencies`, so no
// `node_modules` is shipped. That means activation must not `require` any npm
// package: only `vscode`, Node built-ins and relative files are available. A
// top-level `import` of a runtime dependency (the v1.2.1 regression) makes the
// whole extension fail to activate.
//
// This test loads the compiled entrypoint with a `vscode` stub while making every
// bare npm specifier unresolvable, reproducing the published environment. It
// fails loudly if any such dependency is required while loading the extension.
const assert = require('assert');
const Module = require('module');
const path = require('path');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}`);
    console.log(e.message);
  }
}

// A permissive `vscode` stub: any property access returns a callable.
const noop = () => {};
const vscodeStub = new Proxy(
  {},
  {
    get: () => new Proxy(noop, { get: () => vscodeStub }),
  }
);

const builtins = new Set(Module.builtinModules);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  const isRelative = request.startsWith('.') || path.isAbsolute(request);
  const isBuiltin = builtins.has(request) || request.startsWith('node:');
  if (!isRelative && !isBuiltin) {
    throw new Error(
      `module "${request}" is not shipped (vsce --no-dependencies); ` +
        'do not require runtime npm packages while loading the extension'
    );
  }
  return originalLoad.apply(this, arguments);
};

check('out/extension.js loads without any shipped npm dependency', () => {
  const mod = require('../out/extension.js');
  assert.strictEqual(typeof mod.activate, 'function');
  assert.strictEqual(typeof mod.deactivate, 'function');
});

check('out/languageServer.js loads without vscode-languageclient', () => {
  const entry = require.resolve('../out/languageServer.js');
  delete require.cache[entry];
  require(entry);
});

// Proves the guard above is actually active (the package is installed here, so a
// normal require would succeed; the hook must still reject it).
check('guard rejects a bare npm require', () => {
  assert.throws(() => require('vscode-languageclient/node'), /not shipped/);
});

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
