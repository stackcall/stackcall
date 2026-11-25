import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Small interface to the 0.5 core features that live in Rust (replay buffer, clips, the
 * "who is talking" window). The real contract is docs/api-v05-app.md on feat/v05-nucleo; it was
 * not ready, so these command names are assumed and isolated here (one file to change):
 *
 *   replay_estado            -> { ligado: boolean, segundos: number }
 *   replay_alternar          -> { ligado: boolean, segundos: number }
 *   clipe_salvar             -> Clipe            (saves the last `segundos` of the replay)
 *   clipes_listar            -> { clipes: Clipe[], usados_bytes: number, limite_bytes: number }
 *   clipe_apagar { id }      -> null
 *   clipes_abrir_pasta { id? } -> null           (opens Explorer on the folder / the file)
 *   quem_fala_alternar       -> { visivel: boolean }
 *
 * Outside the app (browser, demo, tests) a fake answers with sample data.
 */
export type Clipe = {
  id: string;
  titulo: string;
  autor: string;
  jogo: string | null;
  /** Unix seconds. */
  criado_em: number;
  duracao_s: number;
  bytes: number;
  /** Local file URL for <video>, when the app can serve it. */
  url: string | null;
};
export type ListaClipes = { clipes: Clipe[]; usados_bytes: number; limite_bytes: number };
export type EstadoReplay = { ligado: boolean; segundos: number };

const agora = () => Math.floor(Date.now() / 1000);
let falsoReplay: EstadoReplay = { ligado: true, segundos: 60 };
let falsoQuemFala = false;
let falsoClipes: Clipe[] = [
  { id: 'c1', titulo: 'Clutch 1v3 no B', autor: 'Rafa', jogo: 'CS2', criado_em: agora() - 1800, duracao_s: 45, bytes: 38e6, url: null },
  { id: 'c2', titulo: 'Sem título', autor: 'você', jogo: 'CS2', criado_em: agora() - 4200, duracao_s: 60, bytes: 52e6, url: null },
  { id: 'c3', titulo: 'A cara do Léo', autor: 'você', jogo: 'Cinema', criado_em: agora() - 90000, duracao_s: 30, bytes: 21e6, url: null },
  { id: 'c4', titulo: 'Ace de deagle', autor: 'você', jogo: 'CS2', criado_em: agora() - 260000, duracao_s: 45, bytes: 35e6, url: null },
];

const real = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const nucleo = {
  replayEstado: (): Promise<EstadoReplay> => (isTauri() ? real('replay_estado') : Promise.resolve({ ...falsoReplay })),
  replayAlternar: (): Promise<EstadoReplay> => {
    if (isTauri()) return real('replay_alternar');
    falsoReplay = { ...falsoReplay, ligado: !falsoReplay.ligado };
    return Promise.resolve({ ...falsoReplay });
  },
  salvarClipe: (): Promise<Clipe> => {
    if (isTauri()) return real('clipe_salvar');
    const c: Clipe = { id: `c${Date.now()}`, titulo: 'Sem título', autor: 'você', jogo: 'CS2', criado_em: agora(), duracao_s: falsoReplay.segundos, bytes: 40e6, url: null };
    falsoClipes = [c, ...falsoClipes];
    return Promise.resolve(c);
  },
  listarClipes: (): Promise<ListaClipes> => (isTauri() ? real('clipes_listar') : Promise.resolve({
    clipes: [...falsoClipes], usados_bytes: falsoClipes.reduce((n, c) => n + c.bytes, 0), limite_bytes: 20e9,
  })),
  apagarClipe: (id: string): Promise<void> => {
    if (isTauri()) return real('clipe_apagar', { id });
    falsoClipes = falsoClipes.filter((c) => c.id !== id);
    return Promise.resolve();
  },
  abrirPastaClipes: (id?: string): Promise<void> => (isTauri() ? real('clipes_abrir_pasta', { id: id ?? null }) : Promise.resolve()),
  alternarQuemFala: (): Promise<{ visivel: boolean }> => {
    if (isTauri()) return real('quem_fala_alternar');
    falsoQuemFala = !falsoQuemFala;
    return Promise.resolve({ visivel: falsoQuemFala });
  },
};

/** LiveKit participant attribute the core sets while the replay buffer records the room. */
export const ATRIBUTO_REPLAY = 'stackcall.replay';
