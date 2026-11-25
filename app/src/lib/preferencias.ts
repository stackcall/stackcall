import { useEffect, useState } from 'react';

/**
 * Per-PC preferences of version 0.5 (docs/design/v05-interface.md, "Chaves de preferência").
 * One JSON under `stackcall.preferencias`. The room and the "quem fala" window read the same
 * keys: a change made here reaches this window at once and the other windows through the
 * `storage` event. Voice (voz.ts), theme (tema.ts) and shortcuts (atalhos.ts) keep their own keys.
 */
export type PosicaoQuemFala = 'sup-esq' | 'sup-dir' | 'meio-esq' | 'meio-dir' | 'inf-esq' | 'inf-dir' | 'livre';
export type TamanhoQuemFala = 'p' | 'm' | 'g';

export type Preferencias = {
  /** Shows the detected game in the presence ("jogando CS2"). Off = no detection, nothing sent. */
  presencaJogo: boolean;
  /** Replay always on while in a room. */
  replayLigado: boolean;
  replaySegundos: 30 | 60 | 120;
  /** "transmissao" = same quality as the stream; "720p" = lighter file. */
  replayQualidade: 'transmissao' | '720p';
  cutucarVoz: boolean;
  /** 0 to 100. */
  cutucarVolume: number;
  cutucarMesmoSilenciado: boolean;
  cutucarAvisoWindows: boolean;
  somEntradaSaida: boolean;
  /** 0 to 100. */
  somEntradaSaidaVolume: number;
  quemFalaMostrar: boolean;
  quemFalaConteudo: 'todos' | 'falando';
  /** 20 to 100 (%). */
  quemFalaOpacidade: number;
  quemFalaTamanho: TamanhoQuemFala;
  /** A corner, or "livre" after dragging (the core keeps the position). */
  quemFalaPosicao: PosicaoQuemFala;
  /** Moves to the CT/TR sub-room when the CS2 GSI reports a match. */
  cs2SalaMapa: boolean;
  /** Bad internet mode: stop receiving video, voice first (room, palette, shortcut). */
  redeRuim: boolean;
};

export const PREFERENCIAS_PADRAO: Preferencias = {
  presencaJogo: true,
  replayLigado: false,
  replaySegundos: 60,
  replayQualidade: 'transmissao',
  cutucarVoz: true,
  cutucarVolume: 70,
  cutucarMesmoSilenciado: true,
  cutucarAvisoWindows: true,
  somEntradaSaida: true,
  somEntradaSaidaVolume: 60,
  quemFalaMostrar: false,
  quemFalaConteudo: 'todos',
  quemFalaOpacidade: 80,
  quemFalaTamanho: 'm',
  quemFalaPosicao: 'meio-esq',
  cs2SalaMapa: false,
  redeRuim: false,
};

export const CHAVE_PREFERENCIAS = 'stackcall.preferencias';

type Validar<T> = (v: unknown, padrao: T) => T;
const bool: Validar<boolean> = (v, p) => (typeof v === 'boolean' ? v : p);
const um = <T,>(...validos: T[]): Validar<T> => (v, p) => (validos.includes(v as T) ? (v as T) : p);
const faixa = (min: number, max: number): Validar<number> => (v, p) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : p;

const REGRAS: { [K in keyof Preferencias]: Validar<Preferencias[K]> } = {
  presencaJogo: bool,
  replayLigado: bool,
  replaySegundos: um(30, 60, 120),
  replayQualidade: um('transmissao', '720p'),
  cutucarVoz: bool,
  cutucarVolume: faixa(0, 100),
  cutucarMesmoSilenciado: bool,
  cutucarAvisoWindows: bool,
  somEntradaSaida: bool,
  somEntradaSaidaVolume: faixa(0, 100),
  quemFalaMostrar: bool,
  quemFalaConteudo: um('todos', 'falando'),
  quemFalaOpacidade: faixa(20, 100),
  quemFalaTamanho: um('p', 'm', 'g'),
  quemFalaPosicao: um('sup-esq', 'sup-dir', 'meio-esq', 'meio-dir', 'inf-esq', 'inf-dir', 'livre'),
  cs2SalaMapa: bool,
  redeRuim: bool,
};

/** Any stored value, cleaned key by key: an invalid field falls back to its default, not the whole object. */
export function validarPreferencias(bruto: unknown): Preferencias {
  const o = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const p = { ...PREFERENCIAS_PADRAO } as Record<keyof Preferencias, unknown>;
  for (const k of Object.keys(REGRAS) as (keyof Preferencias)[]) p[k] = (REGRAS[k] as Validar<unknown>)(o[k], PREFERENCIAS_PADRAO[k]);
  return p as Preferencias;
}

export function lerPreferencias(): Preferencias {
  try {
    return validarPreferencias(JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) ?? '{}'));
  } catch {
    return { ...PREFERENCIAS_PADRAO };
  }
}

const ouvintes = new Set<(p: Preferencias) => void>();

export function salvarPreferencias(mudanca: Partial<Preferencias>): Preferencias {
  const p = validarPreferencias({ ...lerPreferencias(), ...mudanca });
  try {
    localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(p));
  } catch {
    // Storage blocked: the change lasts until the app closes.
  }
  ouvintes.forEach((f) => f(p));
  return p;
}

/** Changes from this window and from the other windows of the app (same origin). */
export function aoMudarPreferencias(f: (p: Preferencias) => void) {
  ouvintes.add(f);
  const outraJanela = (e: StorageEvent) => e.key === CHAVE_PREFERENCIAS && f(lerPreferencias());
  window.addEventListener('storage', outraJanela);
  return () => {
    ouvintes.delete(f);
    window.removeEventListener('storage', outraJanela);
  };
}

export function usePreferencias() {
  const [p, setP] = useState(lerPreferencias);
  useEffect(() => aoMudarPreferencias(setP), []);
  return [p, (m: Partial<Preferencias>) => setP(salvarPreferencias(m))] as const;
}
