import { isTauri } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { modoFalso } from './falso';
import { replay } from './nucleo';

/**
 * Clips saved on this PC. The core writes the MP4 in Vídeos\Stackcall and tells only in the
 * `saved` event; it has no command to list or delete files, so this list is kept here.
 * shortcut: a clip deleted in the Explorer stays listed until "Tirar da lista"; upgrade when the core lists the folder.
 */
export type Clipe = { caminho: string; duracao: number; tamanho: number; em: number };

const CHAVE = 'stackcall.clipes';
const MAXIMO = 200;
export const titulo = (c: Clipe) => c.caminho.split(/[\\/]/).pop()!.replace(/\.mp4$/i, '');

const agora = Date.now();
const EXEMPLOS: Clipe[] = [
  { caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Clutch 1v3 no B.mp4', duracao: 45, tamanho: 38e6, em: agora - 1_800_000 },
  { caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Stackcall 2026-11-25 08-41.mp4', duracao: 60, tamanho: 52e6, em: agora - 4_200_000 },
  { caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Ace de deagle.mp4', duracao: 30, tamanho: 21e6, em: agora - 90_000_000 },
];

export function lerClipes(): Clipe[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Clipe[] | null;
    if (Array.isArray(v)) return v.filter((c) => typeof c?.caminho === 'string');
  } catch {
    // corrupt: start over below
  }
  return !isTauri() && modoFalso() ? EXEMPLOS : [];
}

const gravar = (lista: Clipe[]) => {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAXIMO)));
  } catch {
    // Storage blocked: the list lasts until the app closes.
  }
};
export const guardarClipe = (c: Clipe) => gravar([c, ...lerClipes().filter((x) => x.caminho !== c.caminho)]);
export const tirarClipe = (caminho: string) => gravar(lerClipes().filter((c) => c.caminho !== caminho));

/** Opens the Explorer with the file selected (the folder is Vídeos\Stackcall). */
export const mostrarNaPasta = (caminho: string) => (isTauri() ? revealItemInDir(caminho) : Promise.resolve());

/** Main window, once: every clip the core saves goes to the list. */
export const iniciarClipes = () => replay.aoEvento((e) => {
  if (e.event === 'saved') guardarClipe({ caminho: e.caminho, duracao: e.duracao, tamanho: e.tamanho, em: Date.now() });
});
