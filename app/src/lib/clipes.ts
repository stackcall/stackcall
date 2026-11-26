import { invoke, isTauri } from '@tauri-apps/api/core';
import { naWeb } from './ambiente';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

/**
 * Clips in Vídeos\Stackcall, read by the core (docs/api-v05-app.md, "Galeria de clipes").
 * `nome` includes ".mp4"; `em` in ms; `duracao` in seconds or null when Windows has no metadata.
 * Outside the app (demo and tests) a fake list answers.
 */
export type Clipe = { nome: string; caminho: string; em: number; duracao: number | null; tamanho: number };

export const titulo = (c: Clipe) => c.nome.replace(/\.mp4$/i, '');

const agora = Date.now();
let exemplos: Clipe[] = [
  { nome: 'Clutch 1v3 no B.mp4', caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Clutch 1v3 no B.mp4', em: agora - 1_800_000, duracao: 45, tamanho: 38e6 },
  { nome: 'Stackcall 2026-11-25 08-41.mp4', caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Stackcall 2026-11-25 08-41.mp4', em: agora - 4_200_000, duracao: 60, tamanho: 52e6 },
  { nome: 'Ace de deagle.mp4', caminho: 'C:\\Users\\voce\\Videos\\Stackcall\\Ace de deagle.mp4', em: agora - 90_000_000, duracao: null, tamanho: 21e6 },
];

/** Newest first. */
export const listarClipes = (): Promise<Clipe[]> => (isTauri() ? invoke<Clipe[]>('clipes_listar') : naWeb() ? Promise.resolve([]) : Promise.resolve([...exemplos]));

/** Sends the file to the Windows Recycle Bin; on error the clip stays in the folder. */
export async function apagarClipe(c: Clipe) {
  if (isTauri()) return invoke<void>('clipes_apagar', { nome: c.nome });
  exemplos = exemplos.filter((x) => x.nome !== c.nome);
}

/** Opens the Explorer with the file selected. */
export const mostrarNaPasta = (c: Clipe) => (isTauri() ? revealItemInDir(c.caminho) : Promise.resolve());
