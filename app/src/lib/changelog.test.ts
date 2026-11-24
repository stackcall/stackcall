import { bundledChangelog, compareVersions, mergeChangelogs, parseChangelog } from './changelog';
import pkg from '../../package.json';

test('bundled changelog has the app version', () => {
  expect(bundledChangelog()[0].version).toBe(pkg.version);
});

test('parses the scripts/changelog-json.mjs format and drops malformed entries', () => {
  const parsed = parseChangelog([
    {
      version: '0.2.0',
      date: '2026-12-01',
      categories: [
        { name: 'Novidades', items: [{ message: 'push-to-talk', breaking: false }, { nope: 1 }] },
        { name: 'Outra', items: [{ message: 'x', breaking: false }] },
        { name: 'Correções', items: [{ message: 'nova API', breaking: true }] },
      ],
    },
    { version: 2 },
  ]);
  expect(parsed).toEqual([{
    version: '0.2.0',
    date: '2026-12-01',
    categories: [
      { name: 'Novidades', items: [{ message: 'push-to-talk', breaking: false }] },
      { name: 'Correções', items: [{ message: 'nova API', breaking: true }] },
    ],
  }]);
  expect(parseChangelog({ versions: [] })).toEqual([]);
});

test('merge sorts newest first and remote wins', () => {
  const merged = mergeChangelogs(
    [{ version: '0.1.0', date: 'a', categories: [] }],
    [{ version: '0.10.0', date: 'b', categories: [] }, { version: '0.1.0', date: 'c', categories: [] }],
  );
  expect(merged.map((v) => v.version + v.date)).toEqual(['0.10.0b', '0.1.0c']);
  expect(compareVersions('0.9.1', '0.10.0')).toBeLessThan(0);
});
