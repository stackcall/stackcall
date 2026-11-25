import { invoke, isTauri } from '@tauri-apps/api/core';
import bundled from '../changelog.json';
/** Format written by scripts/changelog-json.mjs (docs/VERSIONAMENTO.md, section 2). */
export const CATEGORIES = ['Novidades', 'Melhorias', 'Correções', 'Ajustes'];
const isString = (v) => typeof v === 'string';
/** Validates untrusted changelog JSON; drops anything malformed. */
export function parseChangelog(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.flatMap((v) => {
        if (!isString(v?.version) || !isString(v?.date) || !Array.isArray(v?.categories))
            return [];
        const categories = v.categories.flatMap((c) => {
            if (!CATEGORIES.includes(c?.name) || !Array.isArray(c.items))
                return [];
            const items = c.items
                .filter((i) => isString(i?.message))
                .map((i) => ({ message: i.message, breaking: i.breaking === true }));
            return items.length ? [{ name: c.name, items }] : [];
        });
        return [{ version: v.version, date: v.date, categories }];
    });
}
const parts = (v) => v.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
export function compareVersions(a, b) {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0))
            return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
}
/** Remote entries win over bundled ones; newest first. */
export function mergeChangelogs(local, remote) {
    const map = new Map(local.map((v) => [v.version, v]));
    for (const v of remote)
        map.set(v.version, v);
    return [...map.values()].sort((a, b) => compareVersions(b.version, a.version));
}
export const bundledChangelog = () => parseChangelog(bundled);
/** The changelog.json attached to the latest release; the bundled copy when offline. */
export async function loadChangelog() {
    const local = bundledChangelog();
    if (!isTauri())
        return local;
    try {
        return mergeChangelogs(local, parseChangelog(JSON.parse(await invoke('remote_changelog'))));
    }
    catch {
        return local;
    }
}
export const countOf = (v, name) => v.categories.find((c) => c.name === name)?.items.length ?? 0;
export const formatDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
};
export const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
