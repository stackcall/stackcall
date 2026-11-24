import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Lightness rules (docs/PLANO-ABERTO.md): minimized, in the tray or in game mode, the
 * interface stops meters, video and animations. Voice keeps playing.
 * Driven by events from Rust (lib.rs, modo_jogo.rs) and the page visibility; no polling.
 */
let janelaVisivel = true;
let jogo = false;
const ouvintes = new Set<() => void>();

export const interfaceAtiva = () => janelaVisivel && !jogo && !document.hidden;
export const emModoJogo = () => jogo;

function atualizar() {
  document.documentElement.toggleAttribute('data-parado', !interfaceAtiva());
  ouvintes.forEach((f) => f());
}

let iniciado = false;
export function iniciarLeveza() {
  if (iniciado) return;
  iniciado = true;
  document.addEventListener('visibilitychange', atualizar);
  if (!isTauri()) return;
  void listen<boolean>('stackcall-visivel', ({ payload }) => {
    janelaVisivel = payload;
    atualizar();
  });
  void listen<boolean>('stackcall-modo-jogo', ({ payload }) => {
    jogo = payload;
    atualizar();
  });
  void invoke<boolean>('modo_jogo_atual').then((v) => {
    jogo = v;
    atualizar();
  }, () => undefined);
}

const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => void ouvintes.delete(f);
};

/** `false` while nobody can see the interface: skip meters, stats and video. */
export const useInterfaceAtiva = () => useSyncExternalStore(assinar, interfaceAtiva);
export const useModoJogo = () => useSyncExternalStore(assinar, emModoJogo);
