import { invoke, isTauri } from '@tauri-apps/api/core';
import bundled from '../changelog.json';

/** Format written by scripts/changelog-json.mjs (docs/VERSIONAMENTO.md, section 2). */
export const CATEGORIES = ['Novidades', 'Melhorias', 'Correções', 'Ajustes'] as const;
export type Category = (typeof CATEGORIES)[number];
export type ChangeItem = { message: string; breaking: boolean };
export type Version = { version: string; date: string; categories: { name: Category; items: ChangeItem[] }[] };

const isString = (v: unknown): v is string => typeof v === 'string';

/** Validates untrusted changelog JSON; drops anything malformed. */
export function parseChangelog(raw: unknown): Version[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v): Version[] => {
    if (!isString(v?.version) || !isString(v?.date) || !Array.isArray(v?.categories)) return [];
    const categories = v.categories.flatMap((c: { name?: unknown; items?: unknown }) => {
      if (!CATEGORIES.includes(c?.name as Category) || !Array.isArray(c.items)) return [];
      const items = c.items
        .filter((i: ChangeItem) => isString(i?.message))
        .map((i: ChangeItem) => ({ message: i.message, breaking: i.breaking === true }));
      return items.length ? [{ name: c.name as Category, items }] : [];
    });
    return [{ version: v.version, date: v.date, categories }];
  });
}

const parts = (v: string) => v.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
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

/** The changelog.json attached to the latest release; the bundled copy when offline. */
export async function loadChangelog(): Promise<Version[]> {
  const local = bundledChangelog();
  if (!isTauri()) return local;
  try {
    return mergeChangelogs(local, parseChangelog(JSON.parse(await invoke<string>('remote_changelog'))));
  } catch {
    return local;
  }
}

export const countOf = (v: Version, name: Category) => v.categories.find((c) => c.name === name)?.items.length ?? 0;

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
