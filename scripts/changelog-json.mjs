import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const categories = ['Novidades', 'Melhorias', 'Correções', 'Ajustes'];
const tagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const [input, currentTag] = process.argv.slice(2);

try {
  if (!input) throw new Error('Use: node scripts/changelog-json.mjs <contexto.json|--manual|--needs-cliff> [vX.Y.Z].');
  const manual = JSON.parse(readFileSync(new URL('../app/src/changelog.json', import.meta.url), 'utf8'));
  const byVersion = new Map(manual.map((release) => [release.version, release]));
  const context = ['--manual', '--needs-cliff'].includes(input) ? [] : JSON.parse(readFileSync(input, 'utf8'));
  const releases = new Map(context.filter((release) => release.version)
    .map((release) => [release.version, release]));

  // git-cliff omits releases without commits in the selected categories.
  const tags = execFileSync('git', [
    'for-each-ref', '--merged=HEAD', '--format=%(refname:short) %(creatordate:unix)', 'refs/tags',
  ], { encoding: 'utf8' });
  for (const line of tags.trim().split(/\r?\n/)) {
    const [tag, timestamp] = line.split(' ');
    const match = tagPattern.exec(tag);
    if (match && !match[1]?.split('.').some((part) => /^0\d+$/.test(part)) && !releases.has(tag)) {
      releases.set(tag, { version: tag, timestamp: Number(timestamp), commits: [] });
    }
  }
  if (currentTag && !releases.has(currentTag)) {
    const timestamp = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' });
    releases.set(currentTag, { version: currentTag, timestamp: Number(timestamp.trim()), commits: [] });
  }

  const versionOf = (tag) => tag.replace(/^v/, '');
  if (input === '--needs-cliff') {
    console.log([...releases.keys()].some((tag) => !byVersion.has(versionOf(tag))));
  } else {
    const previous = [...releases.values()].filter((release) => release.version !== currentTag)
      .sort((a, b) => b.timestamp - a.timestamp);
    const history = currentTag ? [releases.get(currentTag), ...previous] : previous;
    const changelog = history.map((release) => byVersion.get(versionOf(release.version)) ?? ({
      version: versionOf(release.version),
      date: new Date(release.timestamp * 1000).toISOString().slice(0, 10),
      categories: categories.map((name) => ({
        name,
        items: release.commits.filter((commit) => commit.group === name).map((commit) => ({
          message: commit.message,
          breaking: commit.breaking,
        })),
      })).filter((category) => category.items.length),
    }));

    writeFileSync('changelog.json', `${JSON.stringify(changelog, null, 2)}\n`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
