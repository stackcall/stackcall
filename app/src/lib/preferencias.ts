/**
 * 0.5 preferences shared by the room and the Settings pages (another thread builds those pages).
 * Keys, per PC, in localStorage (also listed in docs/design/v05-interface.md, section 10):
 *
 *   stackcall.sons       { entrada: boolean (true), volume: 0..1 (0.5) }
 *                        short sound when someone joins or leaves the room
 *   stackcall.cutucadas  { receberDe: 'todos' | 'amigos' | 'ninguem' ('todos'), voz: boolean (true),
 *                          volume: 0..1 (0.8), mesmoSilenciado: boolean (true), avisoWindows: boolean (true) }
 *   stackcall.rede       { ruim: boolean (false) }   bad internet mode
 */
export type Sons = { entrada: boolean; volume: number };
export type Cutucadas = { receberDe: 'todos' | 'amigos' | 'ninguem'; voz: boolean; volume: number; mesmoSilenciado: boolean; avisoWindows: boolean };
export type Rede = { ruim: boolean };

const vol = (v: unknown, padrao: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : padrao);

function ler<T>(chave: string, ajustar: (v: Record<string, unknown>) => T): T {
  try {
    return ajustar(JSON.parse(localStorage.getItem(chave) ?? '{}') ?? {});
  } catch {
    return ajustar({});
  }
}

const ouvintes = new Map<string, Set<() => void>>();
/** Calls `f` when `chave` changes in this window (the Settings pages save through `salvarPreferencia`). */
export function aoMudarPreferencia(chave: string, f: () => void) {
  const s = ouvintes.get(chave) ?? new Set();
  s.add(f);
  ouvintes.set(chave, s);
  return () => void s.delete(f);
}

export function salvarPreferencia<T extends object>(chave: string, atual: T, mudanca: Partial<T>): T {
  const v = { ...atual, ...mudanca };
  try {
    localStorage.setItem(chave, JSON.stringify(v));
  } catch {
    // Storage blocked: the change lasts until the app closes.
  }
  ouvintes.get(chave)?.forEach((f) => f());
  return v;
}

export const CHAVE_SONS = 'stackcall.sons';
export const CHAVE_CUTUCADAS = 'stackcall.cutucadas';
export const CHAVE_REDE = 'stackcall.rede';

export const lerSons = (): Sons => ler(CHAVE_SONS, (v) => ({ entrada: v.entrada !== false, volume: vol(v.volume, 0.5) }));
export const lerCutucadas = (): Cutucadas => ler(CHAVE_CUTUCADAS, (v) => ({
  receberDe: v.receberDe === 'amigos' || v.receberDe === 'ninguem' ? v.receberDe : 'todos',
  voz: v.voz !== false,
  volume: vol(v.volume, 0.8),
  mesmoSilenciado: v.mesmoSilenciado !== false,
  avisoWindows: v.avisoWindows !== false,
}));
export const lerRede = (): Rede => ler(CHAVE_REDE, (v) => ({ ruim: v.ruim === true }));
export const salvarRede = (ruim: boolean) => salvarPreferencia(CHAVE_REDE, lerRede(), { ruim });
