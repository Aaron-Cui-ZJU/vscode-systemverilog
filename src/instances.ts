import { maskComments } from './parser';

export interface InstantiationSite {
  // Name of the module/interface whose body contains the instance ('' when the
  // instance sits outside any module).
  parent: string;
  // Instance name as written in the parent (`u_core`).
  instance: string;
  // Absolute path of the file that holds the instance.
  file: string;
  // Zero-based line of the instance.
  line: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Map every line of `masked` to the name of the module/interface whose body
// encloses it. Generate blocks do not open a module, so instances inside a
// generate map to the enclosing module.
function lineOwners(masked: string): string[] {
  const lines = masked.split(/\r?\n/);
  const owners: string[] = new Array(lines.length).fill('');
  const open = /^[ \t]*(?:module|interface)\s+(\w+)/;
  const close = /^[ \t]*(?:endmodule|endinterface)\b/;
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (close.test(line)) {
      current = '';
    }
    const m = line.match(open);
    if (m && m[1] !== 'class') {
      current = m[1];
    }
    owners[i] = current;
  }
  return owners;
}

export function enclosingModuleName(text: string, offset: number): string {
  const masked = maskComments(text);
  const clamped = Math.max(0, Math.min(offset, masked.length));
  const line = masked.slice(0, clamped).split(/\r?\n/).length - 1;
  return lineOwners(masked)[line] || '';
}

// Find every place `target` is instantiated. Matches are line-anchored so only
// instantiation statements qualify (`target u_x (`, `target #(...) u_x (`,
// `target u_x [3:0] (`), including instances inside generate blocks; the parent
// module and the instance name are reported for each. Comment/string content is
// masked out first so commented or quoted code is ignored.
export function findInstantiationSites(
  files: { path: string; text: string }[],
  target: string
): InstantiationSite[] {
  const out: InstantiationSite[] = [];
  if (!target) {
    return out;
  }
  const re = new RegExp(
    '^[ \\t]*' + escapeRe(target) + '\\b\\s*(?:#\\s*\\([^;]*\\))?\\s*(\\w+)(?:\\s*\\[[^\\]]*\\])?\\s*\\(',
    'gm'
  );
  for (const { path, text } of files) {
    const masked = maskComments(text);
    const owners = lineOwners(masked);
    re.lastIndex = 0;
    let line = 0;
    let scanned = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      for (let i = scanned; i < m.index; i++) {
        if (masked[i] === '\n') {
          line++;
        }
      }
      scanned = m.index;
      out.push({ parent: owners[line] || '', instance: m[1], file: path, line });
    }
  }
  return out;
}
