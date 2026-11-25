import { lerPreferencias } from './preferencias';

/**
 * Receiving a poke (docs/design/v05-interface.md, "Cutucar"). Whoever gets pokes from the wire
 * (the room thread) calls `receberCutucada`; the app shows the strip and this module reads the
 * message aloud with the Windows voice and raises the Windows notice, by the preferences.
 */
/** `de` is the sender's name; `deId` (when known) lets the strip poke back. */
export type Cutucada = { id: string; de: string; deId?: string; recado: string; salaId: string | null; salaNome: string | null };

export const fraseCutucada = (c: Pick<Cutucada, 'de' | 'recado'>) => (c.recado.trim() ? `${c.de} te cutucou: ${c.recado.trim()}` : `${c.de} te cutucou`);

/** Windows voice in Portuguese, if the PC has one (Web Speech API of WebView2). */
export function vozPortugues(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const vozes = speechSynthesis.getVoices();
  return vozes.find((v) => v.lang === 'pt-BR') ?? vozes.find((v) => v.lang.startsWith('pt')) ?? null;
}

/**
 * Reads the text aloud. It plays outside the room audio, so the app's own mute does not stop it
 * (the Windows mute does). Returns false when the PC cannot speak.
 */
export function falar(texto: string, volume: number) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  fala.volume = Math.min(1, Math.max(0, volume / 100));
  const voz = vozPortugues();
  if (voz) fala.voice = voz;
  speechSynthesis.cancel();
  speechSynthesis.speak(fala);
  return true;
}

function avisarWindows(c: Cutucada) {
  if (typeof Notification === 'undefined') return;
  const mostrar = () => new Notification(`${c.de} te cutucou`, { body: [c.recado.trim(), c.salaNome && `Sala ${c.salaNome}`].filter(Boolean).join(' · '), tag: `cutucada-${c.id}` });
  if (Notification.permission === 'granted') mostrar();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => p === 'granted' && mostrar());
}

const ouvintes = new Set<(c: Cutucada) => void>();
export function aoReceberCutucada(f: (c: Cutucada) => void) {
  ouvintes.add(f);
  return () => void ouvintes.delete(f);
}

const vistas = new Set<string>();
/** `silenciado`: the app sound is off right now (the voice only plays if the preference allows). */
export function receberCutucada(c: Cutucada, { silenciado = false } = {}) {
  if (vistas.has(c.id)) return;
  vistas.add(c.id);
  const p = lerPreferencias();
  if (p.cutucarVoz && (!silenciado || p.cutucarMesmoSilenciado)) falar(fraseCutucada(c), p.cutucarVolume);
  if (p.cutucarAvisoWindows) avisarWindows(c);
  ouvintes.forEach((f) => f(c));
}
