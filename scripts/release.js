#!/usr/bin/env node
// Cut a release: bump the package version, refresh CHANGELOG.md from the git
// log, commit and create an annotated `v<version>` tag. Pushing that tag makes
// the publish workflow build and upload to the Marketplace.
//
// Usage:
//   npm run release -- <patch|minor|major> [--push] [--skip-readme-check]
//   node scripts/release.js <patch|minor|major> [--push] [--skip-readme-check]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const bump = (process.argv[2] || 'patch').toLowerCase();
const shouldPush = process.argv.slice(2).includes('--push');
const skipReadmeCheck = process.argv.slice(2).includes('--skip-readme-check');

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`[release] invalid bump "${bump}" (expected patch, minor or major)`);
  process.exit(1);
}

function git(args, opts) {
  return execFileSync('git', args, { cwd: root, stdio: 'inherit', ...opts });
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

const status = execFileSync('git', ['status', '--porcelain'], { cwd: root })
  .toString()
  .trim();
if (status) {
  console.error('[release] working tree is not clean; commit or stash your changes first:\n' + status);
  process.exit(1);
}

if (!skipReadmeCheck) {
  const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  if (lastTag) {
    const codeChanged = execFileSync('git', ['diff', '--name-only', `${lastTag}..HEAD`, 'package.json', 'src/'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const readmeChanged = execFileSync('git', ['diff', '--name-only', `${lastTag}..HEAD`, 'README.md'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (codeChanged && !readmeChanged) {
      console.error(
        `[release] README.md has not changed since ${lastTag}, but the following source files have:\n` +
          codeChanged
            .split('\n')
            .map((l) => '  ' + l)
            .join('\n') +
          '\n[release] Review README.md (features, commands, settings) and commit any updates, ' +
          'or rerun with --skip-readme-check to bypass.'
      );
      process.exit(1);
    }
    if (!codeChanged) {
      console.log(`[release] no source changes since ${lastTag}`);
    } else {
      console.log(`[release] README.md updated since ${lastTag}; proceeding`);
    }
  } else {
    console.log('[release] no previous release tag found; skipping README check');
  }
}

// Bump package.json and package-lock.json without letting npm create the commit
// and tag, so the changelog is part of the release commit.
execFileSync('npm', ['version', bump, '--no-git-tag-version'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

const version = readVersion();
const tag = `v${version}`;

if (
  execFileSync('git', ['tag', '--list', tag], { cwd: root }).toString().trim()
) {
  console.error(`[release] tag ${tag} already exists`);
  process.exit(1);
}

const changelog = path.join(root, 'scripts', 'update-changelog.js');
execFileSync(process.execPath, [changelog], { cwd: root, stdio: 'inherit' });

git(['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
git(['commit', '-m', `Release ${tag}`]);
git(['tag', '-a', tag, '-m', `Release ${tag}`]);
console.log(`[release] committed and tagged ${tag}`);

if (shouldPush) {
  git(['push', 'origin', 'HEAD', '--follow-tags']);
  console.log(`[release] pushed ${tag}; the publish workflow will run on GitHub Actions`);
} else {
  console.log(`[release] next: git push origin HEAD --follow-tags`);
}
