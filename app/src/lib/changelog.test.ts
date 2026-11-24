import { bundledChangelog, compareVersions, mergeChangelogs, parseChangelog } from './changelog';
import pkg from '../../package.json';

test('bundled changelog has the app version', () => {
  expect(bundledChangelog()[0].version).toBe(pkg.version);
});

test('parse drops malformed entries', () => {
  const parsed = parseChangelog({
    versions: [
      { version: '0.2.0', date: '2026-12-01', items: [{ category: 'novidades', title: 'a', text: 'b' }, { category: 'x', title: 'c', text: 'd' }] },
      { version: 2 },
    ],
  });
  expect(parsed).toHaveLength(1);
  expect(parsed[0].items).toHaveLength(1);
  expect(parseChangelog('nope')).toEqual([]);
});

test('merge sorts newest first and remote wins', () => {
  const merged = mergeChangelogs(
    [{ version: '0.1.0', date: 'a', items: [] }],
    [{ version: '0.10.0', date: 'b', items: [] }, { version: '0.1.0', date: 'c', items: [] }],
  );
  expect(merged.map((v) => v.version + v.date)).toEqual(['0.10.0b', '0.1.0c']);
  expect(compareVersions('0.9.1', '0.10.0')).toBeLessThan(0);
});
