import { invoke, isTauri } from '@tauri-apps/api/core';
import { modoFalso } from './falso';
import type { PosicaoQuemFala, Preferencias, TamanhoQuemFala } from './preferencias';

/**
 * Commands of the 0.5 core used by Settings, the lobby and the "quem fala" window.
 * shortcut: names follow the interface agreed in docs/design/v05-interface.md, because
 * docs/api-v05-app.md (branch feat/v05-nucleo) did not exist yet; rename here when it lands.
 * A missing command answers the fallback, so an older core never breaks the screen.
 */
async function chamar<T>(comando: string, args: Record<string, unknown>, falta: T): Promise<T> {
  if (!isTauri()) return falta;
  try {
    return await invoke<T>(comando, args);
  } catch {
    return falta;
  }
}

const demo = () => !isTauri() && modoFalso();

export type EstadoGsi = { instalado: boolean; caminho: string | null };
export type JanelaQuemFala = { mostrar: boolean; posicao: PosicaoQuemFala; tamanho: TamanhoQuemFala; largura: number };

/** Window width in CSS pixels for each size; the core sizes the window to fit. */
export const LARGURA_QUEM_FALA: Record<TamanhoQuemFala, number> = { p: 170, m: 210, g: 270 };

export const nucleo = {
  /** Display name of the game in front ("Counter-Strike 2"), or null. */
  jogoAtual: () => (demo() ? Promise.resolve('Counter-Strike 2') : chamar<string | null>('jogo_detectado', {}, null)),
  /** CS2 Game State Integration config file: installed or not (null = the core does not know). */
  gsiEstado: () => (demo() ? Promise.resolve<EstadoGsi>({ instalado: false, caminho: null }) : chamar<EstadoGsi | null>('cs2_gsi_estado', {}, null)),
  /** Writes the GSI config into the CS2 folder. Throws with the reason (CS2 not found, no permission). */
  instalarGsi: async (): Promise<EstadoGsi> => {
    if (demo()) return { instalado: true, caminho: 'C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_stackcall.cfg' };
    if (!isTauri()) throw new Error('Abra pelo app do Stackcall.');
    return invoke<EstadoGsi>('cs2_gsi_instalar');
  },
  /** Folder picker of Windows; null when cancelled or unavailable. */
  escolherPasta: () => chamar<string | null>('escolher_pasta', {}, null),
  /** Shows, hides, places and sizes the "quem fala" window. */
  janelaQuemFala: (j: JanelaQuemFala) => chamar<null>('quem_fala_janela', { janela: j }, null),
  /** Drag mode: the window takes clicks until it is turned off again; the core keeps the new place. */
  arrastarQuemFala: (ligado: boolean) => chamar<null>('quem_fala_arrastar', { ligado }, null),
  /** Whether the core has the window at all (older cores do not). */
  temJanelaQuemFala: () => (demo() ? Promise.resolve(true) : chamar<boolean>('quem_fala_disponivel', {}, false)),
};

/** Main window: keeps the "quem fala" window in step with the preferences (show, corner, size). */
export function sincronizarJanelaQuemFala(ler: () => Preferencias, ouvir: (f: (p: Preferencias) => void) => () => void) {
  let ultimo = '';
  const aplicar = (p: Preferencias) => {
    const j: JanelaQuemFala = { mostrar: p.quemFalaMostrar, posicao: p.quemFalaPosicao, tamanho: p.quemFalaTamanho, largura: LARGURA_QUEM_FALA[p.quemFalaTamanho] };
    const json = JSON.stringify(j);
    if (json === ultimo) return;
    ultimo = json;
    void nucleo.janelaQuemFala(j);
  };
  aplicar(ler());
  return ouvir(aplicar);
}
