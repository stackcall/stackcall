import { invoke, isTauri } from '@tauri-apps/api/core';
import bundled from '../changelog.json';

export const CATEGORIES = ['novidades', 'melhorias', 'correcoes', 'ajustes'] as const;
export type Category = (typeof CATEGORIES)[number];
export type ChangeItem = { category: Category; title: string; text: string };
export type Version = { version: string; date: string; items: ChangeItem[] };

const isString = (v: unknown): v is string => typeof v === 'string';

/** Validates untrusted changelog JSON; drops anything malformed. */
export function parseChangelog(raw: unknown): Version[] {
  const versions = (raw as { versions?: unknown })?.versions;
  if (!Array.isArray(versions)) return [];
  return versions.flatMap((v): Version[] => {
    if (!isString(v?.version) || !isString(v?.date) || !Array.isArray(v?.items)) return [];
    const items = v.items.filter(
      (i: ChangeItem) => CATEGORIES.includes(i?.category) && isString(i.title) && isString(i.text),
    );
    return [{ version: v.version, date: v.date, items }];
  });
}

const parts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
export function compareVersions(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Remote entries win over bundled ones; newest first. */
export function mergeChangelogs(local: Version[], remote: Version[]) {
  const map = new Map(local.map((v) => [v.version, v]));
  for (const v of remote) map.set(v.version, v);
  return [...map.values()].sort((a, b) => compareVersions(b.version, a.version));
}

export const bundledChangelog = () => parseChangelog(bundled);

export async function loadChangelog(): Promise<Version[]> {
  const local = bundledChangelog();
  if (!isTauri()) return local;
  try {
    return mergeChangelogs(local, parseChangelog(JSON.parse(await invoke<string>('remote_changelog'))));
  } catch {
    return local; // offline or release without changelog.json
  }
}

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
