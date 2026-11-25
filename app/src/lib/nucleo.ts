import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { primaryMonitor } from '@tauri-apps/api/window';
import type { PosicaoQuemFala, Preferencias } from './preferencias';

/**
 * Commands and events of the 0.5 core, as in docs/api-v05-app.md. Inside the app every call goes
 * to the core and its error reaches the caller (no silent fallback). Outside the app (the demo
 * `?demo=1` and the tests) the fake answers, so the screens can be reviewed in a browser.
 */
const falso = () => !isTauri();

/** Size the core gives the "falantes" window (logical pixels). */
export const JANELA_FALANTES = { largura: 320, altura: 96 };

export type JogoDetectado = { executavel: string; nome: string };

export const nucleo = {
  /** Display name of the game in front, or null. Called every 30 s only while the presence is on. */
  jogoAtual: async (): Promise<string | null> =>
    falso() ? 'Counter-Strike 2' : (await invoke<JogoDetectado | null>('presenca_jogo_atual', { ativa: true }))?.nome ?? null,
  /** Path where the CS2 GSI file goes, or null when CS2 was not found. */
  gsiLocalizar: (): Promise<string | null> =>
    falso() ? Promise.resolve('C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_stackcall.cfg')
      : invoke<string | null>('gsi_cs2_localizar'),
  /** Writes the GSI file after the person confirmed the path; returns the path written. */
  gsiInstalar: (): Promise<string> => (falso() ? nucleo.gsiLocalizar().then((c) => c!) : invoke<string>('gsi_cs2_instalar', { confirmado: true })),
  falantesAbrir: () => (falso() ? Promise.resolve() : invoke<void>('falantes_abrir')),
  falantesFechar: () => (falso() ? Promise.resolve() : invoke<void>('falantes_fechar')),
  /** Physical pixels on the virtual desktop (may be negative). */
  falantesPosicionar: (x: number, y: number) => (falso() ? Promise.resolve() : invoke<void>('falantes_posicionar', { x, y })),
};

/** `stackcall-gsi`: the team of the CS2 match on this PC. */
export type EventoGsi = { time: 'CT' | 'TR' | null; fase: string | null };
export function aoGsi(f: (e: EventoGsi) => void) {
  if (falso()) return () => undefined;
  const parar = listen<EventoGsi>('stackcall-gsi', ({ payload }) => f(payload));
  return () => void parar.then((u) => u());
}

/** Replay buffer (docs/api-v05-app.md, "Som do jogo e clipes"). */
export type ConfigReplay = {
  segundos: 30 | 60 | 120;
  sempre: boolean;
  fonte?: string;
  resolucao?: '720p' | '1080p' | '1440p' | '4k';
  fps?: 30 | 60;
  kbps?: number;
  encoder?: 'auto' | 'qsv' | 'nvenc' | 'amf';
};
export type EventoReplay =
  | { event: 'state'; ativo: boolean }
  | { event: 'saved'; caminho: string; duracao: number; tamanho: number }
  | { event: 'error'; motivo: string };

let falsoAtivo = false;
const ouvintesFalsos = new Set<(e: EventoReplay) => void>();
const emitirFalso = (e: EventoReplay) => ouvintesFalsos.forEach((f) => f(e));

export const replay = {
  definir: async (config: ConfigReplay | null) => {
    if (!falso()) return invoke<void>('replay_definir', { config });
    falsoAtivo = config !== null;
    emitirFalso({ event: 'state', ativo: falsoAtivo });
  },
  atual: (): Promise<boolean> => (falso() ? Promise.resolve(falsoAtivo) : invoke<boolean>('replay_atual')),
  /** The MP4 arrives later in the `saved` event. */
  salvar: async () => {
    if (!falso()) return invoke<void>('replay_salvar');
    if (!falsoAtivo) throw new Error('O replay está desligado.');
    emitirFalso({ event: 'saved', caminho: `C:\\Users\\voce\\Videos\\Stackcall\\clipe-${Date.now()}.mp4`, duracao: 60, tamanho: 40e6 });
  },
  /** Whether my microphone is really open (mute, deafen, push to talk, leaving the room). */
  microfone: (ativo: boolean) => (falso() ? Promise.resolve() : invoke<void>('replay_microfone', { ativo })),
  aoEvento: (f: (e: EventoReplay) => void) => {
    if (falso()) {
      ouvintesFalsos.add(f);
      return () => void ouvintesFalsos.delete(f);
    }
    const parar = listen<EventoReplay>('stackcall-replay', ({ payload }) => f(payload));
    return () => void parar.then((u) => u());
  },
};

/** LiveKit attribute each client sets on its voice participant while its replay is on (value "1"). */
export const ATRIBUTO_REPLAY = 'stackcall.replay';

/** Data topic of the light track request (docs/api-v05-app.md, "Faixa leve"). */
export const TOPICO_TELA_LEVE = 'stackcall.tela-leve';
export const FAIXA_LEVE = 'screen-low';
export const FAIXA_PRINCIPAL = 'screen';

/**
 * Replay preference -> core, on start and on every change. "Sempre ligado" needs a capture source
 * outside the air: the primary monitor. "720p" is the lighter local file; otherwise the core default.
 */
export function sincronizarReplay(ler: () => Preferencias, ouvir: (f: (p: Preferencias) => void) => () => void,
  fontePrincipal: () => Promise<string | null>) {
  let ultimo = '';
  const aplicar = async (p: Preferencias) => {
    const chave = JSON.stringify([p.replayLigado, p.replaySegundos, p.replayQualidade]);
    if (chave === ultimo) return;
    ultimo = chave;
    const fonte = p.replayLigado ? await fontePrincipal().catch(() => null) : null;
    await replay.definir(p.replayLigado
      ? { segundos: p.replaySegundos, sempre: !!fonte, ...(fonte ? { fonte } : {}), ...(p.replayQualidade === '720p' ? { resolucao: '720p' as const } : {}) }
      : null).catch((e) => console.error('replay_definir', e));
  };
  void aplicar(ler());
  return ouvir((p) => void aplicar(p));
}

type Monitor = { x: number; y: number; largura: number; altura: number; escala: number };
/** Top-left corner, in physical pixels, for the window in that corner of the monitor; null keeps it where it is. */
export function posicaoFalantes(posicao: PosicaoQuemFala, m: Monitor): { x: number; y: number } | null {
  if (posicao === 'livre') return null;
  const w = JANELA_FALANTES.largura * m.escala;
  const h = JANELA_FALANTES.altura * m.escala;
  const margem = Math.round(24 * m.escala);
  const [v, lado] = posicao.split('-') as ['sup' | 'meio' | 'inf', 'esq' | 'dir'];
  const x = lado === 'esq' ? m.x + margem : m.x + m.largura - w - margem;
  const y = v === 'sup' ? m.y + margem : v === 'meio' ? m.y + (m.altura - h) / 2 : m.y + m.altura - h - margem;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Main window: opens, closes and places the "falantes" window from the preferences. */
export function sincronizarJanelaQuemFala(ler: () => Preferencias, ouvir: (f: (p: Preferencias) => void) => () => void) {
  let ultimo = '';
  const aplicar = async (p: Preferencias) => {
    const chave = JSON.stringify([p.quemFalaMostrar, p.quemFalaPosicao]);
    if (chave === ultimo) return;
    ultimo = chave;
    try {
      if (!p.quemFalaMostrar) return await nucleo.falantesFechar();
      await nucleo.falantesAbrir();
      const mon = falso() ? null : await primaryMonitor();
      const pos = mon && posicaoFalantes(p.quemFalaPosicao, { x: mon.position.x, y: mon.position.y, largura: mon.size.width, altura: mon.size.height, escala: mon.scaleFactor });
      if (pos) await nucleo.falantesPosicionar(pos.x, pos.y);
    } catch (e) {
      console.error('janela falantes', e);
    }
  };
  void aplicar(ler());
  return ouvir((p) => void aplicar(p));
}
