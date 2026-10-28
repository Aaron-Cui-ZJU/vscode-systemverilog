import * as fs from 'fs';
import * as path from 'path';

// Directory glob expansion for configured include directories, so a setting such
// as `rtl/*/include` or `**/incdir` can describe many search paths at once.
//
// Only `*` (within one path segment), `?` (one character) and `**` (zero or more
// directory levels) are supported. Braces and character classes are treated as
// literal characters, which keeps Windows paths such as `design[old]` working.

const MAX_DEPTH = 64;

export function hasGlob(p: string): boolean {
  return /[*?]/.test(p);
}

// Expand `pattern` into the directories it matches, sorted for a stable index and
// search order. A pattern without wildcards is returned unchanged (even when the
// directory does not exist), so validation can still report the missing path.
export function expandGlobDirs(pattern: string): string[] {
  if (!hasGlob(pattern)) {
    return [pattern];
  }
  const root = path.parse(pattern).root;
  const segments = pattern
    .slice(root.length)
    .split(/[\\/]+/)
    .filter((s) => s.length > 0 && s !== '.');
  const out: string[] = [];
  walk(root || '.', segments, out, 0);
  return [...new Set(out)].sort();
}

function walk(base: string, segments: string[], out: string[], depth: number): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  if (!segments.length) {
    if (isDirectory(base)) {
      out.push(base);
    }
    return;
  }
  const [head, ...tail] = segments;
  if (head === '**') {
    // `**` also matches zero levels, so try the remaining segments at this level
    // before descending.
    walk(base, tail, out, depth + 1);
    for (const dir of subdirectories(base)) {
      walk(dir, segments, out, depth + 1);
    }
    return;
  }
  if (!hasGlob(head)) {
    walk(path.join(base, head), tail, out, depth + 1);
    return;
  }
  const re = segmentRegExp(head);
  for (const dir of subdirectories(base)) {
    if (re.test(path.basename(dir))) {
      walk(dir, tail, out, depth + 1);
    }
  }
}

function subdirectories(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out.sort();
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function segmentRegExp(segment: string): RegExp {
  let source = '';
  for (const ch of segment) {
    if (ch === '*') {
      source += '[^\\\\/]*';
    } else if (ch === '?') {
      source += '[^\\\\/]';
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  // Directory names are case-insensitive on Windows.
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}
