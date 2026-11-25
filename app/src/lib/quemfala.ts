import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

/**
 * What the "quem fala" window shows. The room (main window) publishes; the window listens.
 * Tauri events between windows in the app; a BroadcastChannel in the browser (demo).
 * The window asks for the last state when it opens, so it never starts empty.
 */
export type PessoaQuemFala = { id: string; nome: string; cor: string | null; falando: boolean; mudo: boolean };
export type EstadoQuemFala = { sala: string; ping: number | null; replay: boolean; pessoas: PessoaQuemFala[] };

export const EVENTO_ESTADO = 'quem-fala:estado';
export const EVENTO_PEDIR = 'quem-fala:pedir';
const CANAL = 'stackcall.quem-fala';

/** "todos": everyone in the room, in the room order; "falando": only who speaks now. */
export function linhasQuemFala(estado: EstadoQuemFala | null, conteudo: 'todos' | 'falando') {
  if (!estado) return [];
  return conteudo === 'falando' ? estado.pessoas.filter((p) => p.falando) : estado.pessoas;
}

let ultimo: EstadoQuemFala | null = null;
let ultimoJson = 'null';
let canal: BroadcastChannel | null = null;
let ouvindoPedidos = false;

function enviar(estado: EstadoQuemFala | null) {
  if (isTauri()) void emit(EVENTO_ESTADO, estado).catch(() => undefined);
  else {
    canal ??= typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CANAL);
    canal?.postMessage({ tipo: EVENTO_ESTADO, estado });
  }
}

function ouvirPedidos() {
  if (ouvindoPedidos) return;
  ouvindoPedidos = true;
  if (isTauri()) void listen(EVENTO_PEDIR, () => enviar(ultimo)).catch(() => undefined);
  else {
    canal ??= typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CANAL);
    canal?.addEventListener('message', (e) => e.data?.tipo === EVENTO_PEDIR && enviar(ultimo));
  }
}

/**
 * Main window: send the room state (null = out of voice). Equal states are dropped, so the
 * room may call this on every render; the window repaints only on real changes.
 */
export function publicarQuemFala(estado: EstadoQuemFala | null) {
  ouvirPedidos();
  const json = JSON.stringify(estado);
  if (json === ultimoJson) return;
  ultimoJson = json;
  ultimo = estado;
  enviar(estado);
  locais.forEach((f) => f(estado));
}

/** Main window: the room state changed (the window size follows the number of rows). */
const locais = new Set<(e: EstadoQuemFala | null) => void>();
export function aoPublicarQuemFala(f: (e: EstadoQuemFala | null) => void) {
  locais.add(f);
  return () => void locais.delete(f);
}

/** "Quem fala" window: receives every change and asks for the current state once. */
export function ouvirQuemFala(f: (e: EstadoQuemFala | null) => void) {
  if (isTauri()) {
    let parar: (() => void) | undefined;
    let vivo = true;
    void listen<EstadoQuemFala | null>(EVENTO_ESTADO, ({ payload }) => f(payload))
      .then((u) => {
        if (!vivo) return u();
        parar = u;
        void emit(EVENTO_PEDIR).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
      parar?.();
    };
  }
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const c = new BroadcastChannel(CANAL);
  c.addEventListener('message', (e) => e.data?.tipo === EVENTO_ESTADO && f(e.data.estado));
  c.postMessage({ tipo: EVENTO_PEDIR });
  return () => c.close();
}

/** Sample room for the demo and the Settings preview. */
export const ESTADO_EXEMPLO: EstadoQuemFala = {
  sala: 'CS',
  ping: 142,
  replay: true,
  pessoas: [
    { id: 'duda', nome: 'Duda', cor: null, falando: true, mudo: false },
    { id: 'rafa', nome: 'Rafa', cor: null, falando: true, mudo: false },
    { id: 'leo', nome: 'Léo', cor: null, falando: false, mudo: false },
    { id: 'nanda', nome: 'Nanda', cor: null, falando: false, mudo: true },
  ],
};
