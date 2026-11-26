import { invoke, isTauri } from '@tauri-apps/api/core';
import { aoGsi, replay, type EventoGsi } from './nucleo';
import { lerPreferencias } from './preferencias';

/**
 * Automatic CS2 clips (light): the replay records only while a match is on (GSI), the best
 * plays come from the game's own state (round kills), and the clip gets a readable name.
 */
export type TipoLance = '3K' | '4K' | 'ACE';
export type Lance = { tipo: TipoLance; mapa: string | null; round: number | null };

export const TIPOS_LANCE: readonly TipoLance[] = ['ACE', '4K', '3K'];
export const tipoDoClipe = (nome: string): TipoLance | null => TIPOS_LANCE.find((t) => nome.startsWith(`${t} `)) ?? null;

/** One clip per round, at the end of the round (or at once on an ace). */
export function criarDetectorLances(aoLance: (l: Lance) => void) {
  let round: number | null | undefined;
  let mapa: string | null = null;
  let max = 0;
  let disparado = false;
  // Right after the round changes, GSI still reports the last round's kills until freeze time.
  let esperandoZerar = false;
  const fechar = () => {
    if (disparado || max < 3) return;
    disparado = true;
    aoLance({ tipo: max >= 5 ? 'ACE' : max === 4 ? '4K' : '3K', mapa, round: round ?? null });
  };
  return (e: EventoGsi) => {
    if (e.round !== undefined && e.round !== round) {
      if (round !== undefined) fechar();
      round = e.round;
      max = 0;
      disparado = false;
      esperandoZerar = true;
    }
    mapa = e.mapa ?? mapa;
    if (esperandoZerar && (e.kills === 0 || e.fase === 'freezetime')) esperandoZerar = false;
    if (!esperandoZerar && typeof e.kills === 'number') max = Math.max(max, e.kills);
    if (e.fase === 'over' || max >= 5) fechar();
  };
}

/** "ACE mirage R8 26-11 21h40.mp4": what the clip gallery shows as the title. */
export function nomeDoLance(l: Lance, quando = new Date()) {
  const mapa = (l.mapa ?? 'cs2').replace(/^(de|cs|ar)_/, '').replace(/[^A-Za-z0-9_-]/g, '');
  const dois = (n: number) => String(n).padStart(2, '0');
  const hora = `${dois(quando.getDate())}-${dois(quando.getMonth() + 1)} ${dois(quando.getHours())}h${dois(quando.getMinutes())}`;
  return `${l.tipo} ${mapa}${l.round !== null ? ` R${l.round + 1}` : ''} ${hora}.mp4`;
}

/** A match is on while GSI reports a map; CS2 sends a heartbeat every 15 s. */
const SEM_PARTIDA_MS = 45_000;

/**
 * Starts the automatic clips in the main window. `emPartida` tells the replay sync whether to
 * record now; the clip is saved 3 s after the play so the reaction is in it.
 */
export function iniciarClipesAutomaticos(aoMudarPartida: (on: boolean) => void) {
  if (!isTauri()) return () => undefined;
  let emPartida = false;
  let fim: ReturnType<typeof setTimeout> | undefined;
  let pendente: Lance | null = null;
  const mudar = (on: boolean) => {
    if (on === emPartida) return;
    emPartida = on;
    aoMudarPartida(on);
  };
  const detectar = criarDetectorLances((l) => {
    if (!lerPreferencias().clipesAuto) return;
    setTimeout(() => {
      pendente = l;
      void replay.salvar().catch(() => (pendente = null));
    }, 3000);
  });
  const pararGsi = aoGsi((e) => {
    clearTimeout(fim);
    const naPartida = !!e.mapa && e.fase !== 'gameover';
    mudar(naPartida);
    if (naPartida) fim = setTimeout(() => mudar(false), SEM_PARTIDA_MS);
    detectar(e);
  });
  const pararReplay = replay.aoEvento((e) => {
    if (e.event !== 'saved' || !pendente) return;
    const nome = e.caminho.split(/[\\/]/).pop() ?? '';
    const novo = nomeDoLance(pendente);
    pendente = null;
    void invoke('clipes_renomear', { nome, novo }).catch(() => undefined);
  });
  return () => {
    clearTimeout(fim);
    pararGsi();
    pararReplay();
  };
}
