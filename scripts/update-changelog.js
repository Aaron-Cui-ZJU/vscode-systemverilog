#!/usr/bin/env node
// Prepend a CHANGELOG.md section for the current package version, generated from
// the git commits since the previous release tag. The release script runs this
// when tagging, and the publish workflow runs it as a safety net so the packaged
// extension always ships an up-to-date changelog. Existing sections are never
// rewritten, so a hand-written entry for the same version is preserved.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '-v') {
      out.version = argv[++i];
    } else if (a === '--base' || a === '-b') {
      out.base = argv[++i];
    } else if (a === '--date') {
      out.date = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = args.version || process.env.CHANGELOG_VERSION || pkg.version;
if (!version) {
  console.error('[changelog] no version found; nothing to do');
  process.exit(0);
}

let content = fs.readFileSync(changelogPath, 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (new RegExp('^##\\s+' + escaped + '\\b', 'm').test(content)) {
  console.log(`[changelog] ${version} already present; leaving it as is`);
  process.exit(0);
}

let base = args.base || process.env.CHANGELOG_BASE || '';
if (!base) {
  // Previous release tag reachable from the commit before HEAD (HEAD itself may
  // already be tagged when running in CI).
  base = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD^']);
}
if (base && !git(['rev-parse', '--verify', '--quiet', base])) {
  base = '';
}
const range = base ? `${base}..HEAD` : 'HEAD';

const subjects = git(['log', range, '--no-merges', '--pretty=format:%s'])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((s) => !/^release\s+v?\d/i.test(s) && !/^v?\d+\.\d+\.\d+$/.test(s))
  .reverse();

const date = args.date || new Date().toISOString().slice(0, 10);
const bullets = subjects.length
  ? subjects.map((s) => `- ${s}`)
  : ['- Maintenance release.'];
const entry = `## ${version} (${date})\n\n${bullets.join('\n')}\n`;

if (/^#\s+Change Log\b/m.test(content)) {
  content = content.replace(/^(#\s+Change Log[^\n]*\n)/, `$1\n${entry}\n`);
} else {
  content = `# Change Log\n\n${entry}\n${content}`;
}
fs.writeFileSync(changelogPath, content);
console.log(
  `[changelog] added ${version} (${bullets.length} entry/entries)` +
    (base ? ` from commits since ${base}` : ' from full history')
);
