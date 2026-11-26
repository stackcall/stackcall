import { invoke, isTauri } from '@tauri-apps/api/core';
import { naWeb } from './ambiente';
import { listen } from '@tauri-apps/api/event';
import type { PosicaoQuemFala, Preferencias, TamanhoQuemFala } from './preferencias';
import { aoPublicarQuemFala, linhasQuemFala, type EstadoQuemFala } from './quemfala';

/**
 * Commands and events of the 0.5 core, as in docs/api-v05-app.md. Inside the app every call goes
 * to the core and its error reaches the caller (no silent fallback). Outside the app (the demo
 * `?demo=1` and the tests) the fake answers, so the screens can be reviewed in a browser.
 */
const falso = () => !isTauri() && !naWeb();
/** Web app: no core. Every call answers "nothing here" instead of the demo's fake data. */
const web = naWeb;

/** Width of the "falantes" window per size (logical pixels); the core adds 26 + rows × 26/32/40 of height. */
export const LARGURA_FALANTES: Record<TamanhoQuemFala, number> = { p: 260, m: 320, g: 400 };
/** The core sizes the window for at most this many rows. */
export const MAX_LINHAS_FALANTES = 8;

export type JogoDetectado = { executavel: string; nome: string };

export const nucleo = {
  /** Display name of the game in front, or null. Called every 30 s only while the presence is on. */
  jogoAtual: async (): Promise<string | null> =>
    web() ? null : falso() ? 'Counter-Strike 2' : (await invoke<JogoDetectado | null>('presenca_jogo_atual', { ativa: true }))?.nome ?? null,
  /** Path where the CS2 GSI file goes, or null when CS2 was not found. */
  gsiLocalizar: (): Promise<string | null> =>
    web() ? Promise.resolve(null) : falso() ? Promise.resolve('C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_stackcall.cfg')
      : invoke<string | null>('gsi_cs2_localizar'),
  /** Writes the GSI file after the person confirmed the path; returns the path written. */
  gsiInstalar: (): Promise<string> => (web() ? Promise.reject(new Error('Só no app do Windows.')) : falso() ? nucleo.gsiLocalizar().then((c) => c!) : invoke<string>('gsi_cs2_instalar', { confirmado: true })),
  falantesAbrir: () => (falso() || web() ? Promise.resolve() : invoke<void>('falantes_abrir')),
  falantesFechar: () => (falso() || web() ? Promise.resolve() : invoke<void>('falantes_fechar')),
  /** Resizes the open window and anchors it to a corner of the primary monitor ("livre" keeps it where it is). */
  falantesRedimensionar: (tamanho: TamanhoQuemFala, linhas: number, posicao: PosicaoQuemFala) =>
    (falso() || web() ? Promise.resolve() : invoke<void>('falantes_redimensionar', { tamanho, linhas, posicao })),
  /** Physical pixels on the virtual desktop (may be negative). */
  falantesPosicionar: (x: number, y: number) => (falso() || web() ? Promise.resolve() : invoke<void>('falantes_posicionar', { x, y })),
};

/** `stackcall-gsi`: the team of the CS2 match on this PC. */
export type EventoGsi = { time: 'CT' | 'TR' | null; fase: string | null };
export function aoGsi(f: (e: EventoGsi) => void) {
  if (falso() || web()) return () => undefined;
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
    if (web()) return;
    if (!falso()) return invoke<void>('replay_definir', { config });
    falsoAtivo = config !== null;
    emitirFalso({ event: 'state', ativo: falsoAtivo });
  },
  atual: (): Promise<boolean> => (web() ? Promise.resolve(false) : falso() ? Promise.resolve(falsoAtivo) : invoke<boolean>('replay_atual')),
  /** The MP4 arrives later in the `saved` event. */
  salvar: async () => {
    if (web()) throw new Error('Clipes só no app do Windows.');
    if (!falso()) return invoke<void>('replay_salvar');
    if (!falsoAtivo) throw new Error('O replay está desligado.');
    emitirFalso({ event: 'saved', caminho: `C:\\Users\\voce\\Videos\\Stackcall\\clipe-${Date.now()}.mp4`, duracao: 60, tamanho: 40e6 });
  },
  /** Whether my microphone is really open (mute, deafen, push to talk, leaving the room). */
  microfone: (ativo: boolean) => (falso() || web() ? Promise.resolve() : invoke<void>('replay_microfone', { ativo })),
  aoEvento: (f: (e: EventoReplay) => void) => {
    if (web()) return () => undefined;
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

/** What the window must look like: closed, or open with this size, rows and corner. */
export function pedidoFalantes(p: Preferencias, estado: EstadoQuemFala | null) {
  if (!p.quemFalaMostrar) return null;
  const linhas = Math.min(MAX_LINHAS_FALANTES, linhasQuemFala(estado, p.quemFalaConteudo).length);
  return { tamanho: p.quemFalaTamanho, linhas, posicao: p.quemFalaPosicao };
}

/**
 * Main window: opens, closes and sizes the "falantes" window from the preferences and the rows it
 * shows (everyone in the room, or only who speaks). Calls the core only when that changes.
 */
export function sincronizarJanelaQuemFala(ler: () => Preferencias, ouvir: (f: (p: Preferencias) => void) => () => void) {
  let ultimo = '';
  let aberta = false;
  let estado: EstadoQuemFala | null = null;
  let fila = Promise.resolve();
  const aplicar = () => {
    const pedido = pedidoFalantes(ler(), estado);
    const chave = JSON.stringify(pedido);
    if (chave === ultimo) return;
    ultimo = chave;
    // One call after the other: an open must finish before the resize that follows it.
    fila = fila.then(async () => {
      if (!pedido) {
        aberta = false;
        return nucleo.falantesFechar();
      }
      if (!aberta) await nucleo.falantesAbrir();
      aberta = true;
      await nucleo.falantesRedimensionar(pedido.tamanho, pedido.linhas, pedido.posicao);
    }).catch((e) => console.error('janela falantes', e));
  };
  aplicar();
  const pararPrefs = ouvir(aplicar);
  const pararEstado = aoPublicarQuemFala((e) => {
    estado = e;
    aplicar();
  });
  return () => {
    pararPrefs();
    pararEstado();
  };
}
