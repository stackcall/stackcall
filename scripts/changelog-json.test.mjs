import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./changelog-json.mjs', import.meta.url));
const manual = JSON.parse(readFileSync(new URL('../app/src/changelog.json', import.meta.url), 'utf8'));
const release040 = manual.find((release) => release.version === '0.4.0');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'stackcall-changelog-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q');
  git('commit', '--allow-empty', '-qm', 'chore: test release');
  git('tag', 'v0.4.0');
  return {
    git,
    run: (input, tag = 'v0.4.0') => execFileSync(process.execPath, [script, input, tag], { cwd, encoding: 'utf8' }).trim(),
    writeContext: (context) => writeFileSync(join(cwd, 'cliff-context.json'), JSON.stringify(context)),
    output: () => JSON.parse(readFileSync(join(cwd, 'changelog.json'), 'utf8')),
  };
}

test('generates the current 0.4.0 entry without git-cliff when the history is covered', (t) => {
  const release = fixture(t);
  assert.ok(release040);
  assert.equal(release.run('--needs-cliff'), 'false');
  release.run('--manual');
  assert.deepEqual(release.output(), [release040]);
});

test('allows git-cliff to describe a new release before its manual notes exist', (t) => {
  const release = fixture(t);
  const change = { message: 'Corrige a presença', breaking: false };
  release.writeContext([{ version: 'v0.4.1', timestamp: 1720000000, commits: [{ group: 'Correções', ...change }] }]);
  assert.equal(release.run('--needs-cliff', 'v0.4.1'), 'true');
  release.run('cliff-context.json', 'v0.4.1');
  assert.deepEqual(release.output(), [
    { version: '0.4.1', date: '2024-07-03', categories: [{ name: 'Correções', items: [change] }] }, release040,
  ]);
});

test('uses manual notes for 0.4.0 and git-cliff for a version without manual notes', (t) => {
  const release = fixture(t);
  release.git('tag', 'v0.2.0');
  const change = { message: 'Nota do git-cliff', breaking: false };
  const commits = [{ group: 'Correções', ...change }];
  release.writeContext([
    { version: 'v0.4.0', timestamp: 1720000000, commits },
    { version: 'v0.2.0', timestamp: 1710000000, commits },
  ]);
  assert.equal(release.run('--needs-cliff'), 'true');
  release.run('cliff-context.json');
  assert.deepEqual(release.output(), [
    release040, { version: '0.2.0', date: '2024-03-09', categories: [{ name: 'Correções', items: [change] }] },
  ]);
});
