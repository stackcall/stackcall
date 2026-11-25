import { isTauri } from '@tauri-apps/api/core';
import { lerCutucadas, type Cutucadas } from './preferencias';
import type { Pessoa } from './servidor';
import { tocarSom } from './sons';

/**
 * Poke ("Cutucar", idea of the TeamSpeak poke). The person who receives hears a voice reading
 * "<name> te cutucou: <message>", even with the Stackcall sound off, through the Windows speech
 * synthesis (Web Speech API of WebView2). The message never leaves the PC.
 */
export const LIMITE_RECADO = 80;
export const INTERVALO_MS = 30_000;
export const SUGESTOES = ['a sala tá pronta', 'bora jogar', 'volta pra call'];

/** Exact sentence the other person will hear. */
export const fraseCutucada = (remetente: string, recado: string) =>
  recado.trim() ? `${remetente} te cutucou: ${recado.trim()}` : `${remetente} te cutucou`;

const ultimas = new Map<string, number>();
/** Seconds until I can poke `id` again (0 = now). Client side mirror of the server's 30 s limit. */
export const esperaCutucar = (id: string, agora = Date.now()) =>
  Math.max(0, Math.ceil((INTERVALO_MS - (agora - (ultimas.get(id) ?? -Infinity))) / 1000));
export const marcarCutucada = (id: string, agora = Date.now()) => void ultimas.set(id, agora);
let ultimoCutucado: string | null = null;
export const lembrarUltimo = (id: string) => void (ultimoCutucado = id);
export const ultimoAlvo = () => ultimoCutucado;

export type Recebida = { id: string; de: Pessoa; recado: string; salaId: string | null };

/**
 * New pokes in the presence list, deduplicated by id, filtered by "receber de" (everyone, friends,
 * nobody). `vistas` is mutated: an id is announced once even if the presence keeps it for 120 s.
 */
export function novasCutucadas(pessoas: Pessoa[], vistas: Set<string>, prefs: Cutucadas = lerCutucadas(), agora = Date.now() / 1000): Recebida[] {
  const novas: Recebida[] = [];
  for (const p of pessoas) {
    for (const c of p.cutucadas ?? []) {
      if (vistas.has(c.id) || (c.expiraEm && c.expiraEm < agora)) continue;
      vistas.add(c.id);
      if (prefs.receberDe === 'ninguem' || (prefs.receberDe === 'amigos' && !p.amigo)) continue;
      novas.push({ id: c.id, de: p, recado: c.recado, salaId: c.salaId });
    }
  }
  return novas;
}

/** Portuguese voice installed on the system, if any. */
export function vozPortugues(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const vozes = speechSynthesis.getVoices();
  return vozes.find((v) => v.lang?.toLowerCase() === 'pt-br') ?? vozes.find((v) => v.lang?.toLowerCase().startsWith('pt')) ?? null;
}

/**
 * Reads the poke aloud (or plays a short sound when the PC has no Portuguese voice), and shows the
 * Windows notice. `silenciado` = the Stackcall sound is off: plays anyway unless the person turned
 * "tocar mesmo com o som silenciado" off.
 */
export function anunciarCutucada(r: Recebida, silenciado: boolean, prefs: Cutucadas = lerCutucadas(), onEntrar?: () => void) {
  if (!(silenciado && !prefs.mesmoSilenciado)) {
    const voz = prefs.voz ? vozPortugues() : null;
    if (voz) {
      const fala = new SpeechSynthesisUtterance(fraseCutucada(r.de.nome, r.recado));
      fala.voice = voz;
      fala.lang = voz.lang;
      fala.volume = prefs.volume;
      speechSynthesis.speak(fala);
    } else {
      tocarSom('cutucada', prefs.volume);
    }
  }
  if (prefs.avisoWindows) avisoWindows(r, onEntrar);
}

function avisoWindows(r: Recebida, onEntrar?: () => void) {
  // shortcut: Web Notification of WebView2; the Tauri notification plugin (with an "Entrar na sala"
  // action button) is not installed, so a click on the notice is the "enter" action.
  if (typeof Notification === 'undefined' || (!isTauri() && document.hasFocus())) return;
  const mostrar = () => {
    const n = new Notification(`${r.de.nome} te cutucou`, { body: r.recado || 'Toque para entrar na sala.', tag: `cutucada-${r.id}` });
    n.onclick = () => {
      window.focus();
      onEntrar?.();
    };
  };
  if (Notification.permission === 'granted') mostrar();
  else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => p === 'granted' && mostrar());
}

/** The room tells whether the Stackcall sound is off (deafened), for "tocar mesmo com o som silenciado". */
let silenciado = false;
export const marcarSilenciado = (v: boolean) => void (silenciado = v);
export const somSilenciado = () => silenciado;
