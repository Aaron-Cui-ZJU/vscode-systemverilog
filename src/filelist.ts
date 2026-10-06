import * as path from 'path';

export interface FileListSetting {
  file: string;
  base: string;
}

export interface FileListResult {
  files: string[];
  incdirs: string[];
}

export type ReadText = (absPath: string) => string | null;

const OPTIONS_WITH_VALUE = new Set([
  '-v',
  '-y',
  '-D',
  '-U',
  '-P',
  '-o',
  '-l',
  '-s',
  '-timescale',
  '-X',
  '-m',
  '-M',
]);

export function expandEnv(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, b) => {
    const name = a || b;
    const value = env[name];
    return value === undefined ? '' : value;
  });
}

export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

function logicalLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  let pending = '';
  for (const line of raw) {
    if (line.endsWith('\\')) {
      pending += line.slice(0, -1);
      continue;
    }
    out.push(pending + line);
    pending = '';
  }
  if (pending) {
    out.push(pending);
  }
  return out;
}

// Resolve every file referenced by a filelist (recursively following `-f` / `-F`
// includes) plus the `+incdir+` / `-I` search directories it declares. Paths
// inside the list are resolved against `baseDir`. IO is injected so the parser
// stays testable and host-agnostic.
export function resolveFileList(
  entryFile: string,
  baseDir: string,
  readText: ReadText,
  env: NodeJS.ProcessEnv = process.env
): FileListResult {
  const files = new Set<string>();
  const incdirs = new Set<string>();
  const seenLists = new Set<string>();

  const addIncDirs = (raw: string): void => {
    for (const part of raw.split('+')) {
      if (part) {
        incdirs.add(path.resolve(baseDir, part));
      }
    }
  };

  const visit = (listPath: string): void => {
    const absList = path.resolve(baseDir, listPath);
    const norm = path.resolve(absList);
    if (seenLists.has(norm)) {
      return;
    }
    seenLists.add(norm);
    const text = readText(absList);
    if (text === null) {
      return;
    }
    for (const rawLine of logicalLines(text)) {
      const line = stripComment(rawLine).trim();
      if (!line) {
        continue;
      }
      const tokens = tokenize(line);
      for (let i = 0; i < tokens.length; i++) {
        const token = expandEnv(tokens[i], env);
        if (!token) {
          continue;
        }
        if (token === '-f' || token === '-F') {
          const next = tokens[i + 1];
          if (next !== undefined) {
            i++;
            visit(expandEnv(next, env));
          }
          continue;
        }
        if (/^-f.+/.test(token) || /^-F.+/.test(token)) {
          visit(token.slice(2));
          continue;
        }
        if (token === '+incdir+') {
          const next = tokens[i + 1];
          if (next !== undefined) {
            i++;
            addIncDirs(expandEnv(next, env));
          }
          continue;
        }
        if (token.startsWith('+incdir+')) {
          addIncDirs(token.slice('+incdir+'.length));
          continue;
        }
        if (token === '-I') {
          const next = tokens[i + 1];
          if (next !== undefined) {
            i++;
            addIncDirs(expandEnv(next, env));
          }
          continue;
        }
        if (token.startsWith('-I') && token.length > 2) {
          addIncDirs(token.slice(2));
          continue;
        }
        if (token.startsWith('-')) {
          if (OPTIONS_WITH_VALUE.has(token)) {
            i++;
          }
          continue;
        }
        if (token.startsWith('+')) {
          continue;
        }
        files.add(path.resolve(baseDir, token));
      }
    }
  };

  visit(entryFile);
  return { files: [...files], incdirs: [...incdirs] };
}

// Extract the quoted / angle-bracketed targets of `\`include` directives. Macro
// includes (`` `include `DIR/file ``) cannot be resolved statically and are
// dropped.
export function parseIncludes(text: string): string[] {
  const out: string[] = [];
  const re = /`include\s+["<]([^">\r\n]+)[">]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name && !name.includes('`')) {
      out.push(name);
    }
  }
  return out;
}

function resolveInclude(
  name: string,
  fromDir: string,
  searchDirs: string[],
  read: ReadText
): string | null {
  const candidates = [path.join(fromDir, name), ...searchDirs.map((d) => path.join(d, name))];
  for (const candidate of candidates) {
    if (read(candidate) !== null) {
      return path.resolve(candidate);
    }
  }
  return null;
}

// Return the transitive closure of `startFiles` following `` `include ``
// directives. Search order per include: the including file's directory, then
// `searchDirs`. Cycle-safe.
export function followIncludes(
  startFiles: string[],
  searchDirs: string[],
  readText: ReadText,
  onUnresolved?: (include: string, fromFile: string) => void
): string[] {
  const cache = new Map<string, string | null>();
  const read = (p: string): string | null => {
    if (!cache.has(p)) {
      cache.set(p, readText(p));
    }
    return cache.get(p) ?? null;
  };

  const seen = new Set<string>();
  const out: string[] = [];
  const queue = startFiles.map((f) => path.resolve(f));
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    out.push(file);
    const text = read(file);
    if (text === null) {
      continue;
    }
    for (const inc of parseIncludes(text)) {
      const target = resolveInclude(inc, path.dirname(file), searchDirs, read);
      if (target) {
        if (!seen.has(target)) {
          queue.push(target);
        }
      } else if (onUnresolved) {
        onUnresolved(inc, file);
      }
    }
  }
  return out;
}
