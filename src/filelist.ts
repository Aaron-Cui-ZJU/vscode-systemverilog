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
// includes, and pulling the plain file paths listed by `-incfile`) plus the
// `+incdir+` / `-I` search directories it declares. Paths inside the list are
// resolved against `baseDir`. IO is injected so the parser stays testable and
// host-agnostic.
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

  // `-incfile <list>` points at a file that lists source/header paths (one or
  // more per line, with comments and blank lines allowed); every referenced
  // path is added to the compilation set.
  const addIncFile = (listPath: string): void => {
    const absList = path.resolve(baseDir, listPath);
    const text = readText(absList);
    if (text === null) {
      return;
    }
    for (const rawLine of logicalLines(text)) {
      const line = stripComment(rawLine).trim();
      if (!line) {
        continue;
      }
      for (const raw of tokenize(line)) {
        const p = expandEnv(raw, env);
        if (!p || p.startsWith('-') || p.startsWith('+')) {
          continue;
        }
        files.add(path.resolve(baseDir, p));
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
        if (token === '-incfile') {
          const next = tokens[i + 1];
          if (next !== undefined) {
            i++;
            addIncFile(expandEnv(next, env));
          }
          continue;
        }
        if (token.startsWith('-incfile') && token.length > '-incfile'.length) {
          let rest = token.slice('-incfile'.length);
          if (rest.startsWith('=')) {
            rest = rest.slice(1);
          }
          addIncFile(rest);
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

// Remove `//` and `/* ... */` comments so a commented-out `` `include `` is not
// followed (and does not show up as unresolvable). String literals are copied
// verbatim, so a `//` inside them cannot swallow the code that follows it.
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          out += text[i] + text[i + 1];
          i += 2;
        } else {
          out += text[i];
          i++;
        }
      }
      if (i < text.length) {
        out += text[i];
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Extract the quoted / angle-bracketed targets of `\`include` directives. Macro
// includes (`` `include `DIR/file ``) and commented-out directives are dropped.
export function parseIncludes(text: string): string[] {
  const out: string[] = [];
  const re = /`include\s+["<]([^">\r\n]+)[">]/g;
  const code = stripComments(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1].trim();
    if (name && !name.includes('`')) {
      out.push(name);
    }
  }
  return out;
}

// A "link file" is a checked-in stand-in for a source that lives elsewhere (often
// a generated register model): its whole content is the path of the real file,
// absolute or relative to the link's own directory. Return the resolved target, or
// null when the text looks like source code instead of a link.
export function resolveLinkTarget(absPath: string, text: string): string | null {
  // Link files are tiny; the length gate also keeps trim() off large sources.
  if (text.length > 512) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    return null;
  }
  // Any punctuation that appears in Verilog/SystemVerilog is a strong sign that
  // this is real code rather than a bare path.
  if (/[;{}()"'`]|\/\/|\/\*/.test(trimmed)) {
    return null;
  }
  const target = path.resolve(path.dirname(absPath), trimmed);
  return target === absPath ? null : target;
}

// Follow link files (including chains of them) to the file whose text should be
// used. The caller's `read` doubles as the existence check, so a link whose target
// is missing is left as-is.
export function resolveSourcePath(absPath: string, read: ReadText): string {
  let current = absPath;
  for (let depth = 0; depth < 8; depth++) {
    const text = read(current);
    if (text === null) {
      return current;
    }
    const target = resolveLinkTarget(current, text);
    if (!target || read(target) === null) {
      return current;
    }
    current = target;
  }
  return current;
}

function resolveInclude(
  name: string,
  fromDir: string,
  searchDirs: string[],
  read: ReadText
): string | null {
  const candidates = [path.join(fromDir, name), ...searchDirs.map((d) => path.join(d, name))];
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (read(abs) !== null) {
      return resolveSourcePath(abs, read);
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
    const file = resolveSourcePath(queue.shift() as string, read);
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
