import { nucleo } from './nucleo';
import { lerPreferencias, aoMudarPreferencias } from './preferencias';
import type { Servidor } from './servidor';

/**
 * Game in the presence (docs/api-v05.md, "Jogo na presença"). Every 30 s, only with the
 * presence preference on, ask the core for the game in front and tell the server. The server
 * forgets a game 120 s after the last renewal, so an unchanged game is renewed every 60 s;
 * a closed game is cleared once with "".
 */
export const DETECTAR_MS = 30_000;
export const RENOVAR_MS = 60_000;

type Envio = { jogo: string; em: number };

/** What to send now: the name, "" to clear, or null for nothing. */
export function envioDoJogo(detectado: string | null, ultimo: Envio | null, agora: number): string | null {
  const jogo = (detectado ?? '').trim().slice(0, 60);
  if (!ultimo) return jogo || null;
  if (jogo !== ultimo.jogo) return jogo;
  return jogo && agora - ultimo.em >= RENOVAR_MS ? jogo : null;
}

export function iniciarDeteccaoJogo(servidor: Pick<Servidor, 'jogo'>, detectar = nucleo.jogoAtual) {
  let ultimo: Envio | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let parado = false;

  async function rodada() {
    if (parado) return;
    if (lerPreferencias().presencaJogo) {
      const agora = Date.now();
      const enviar = envioDoJogo(await detectar().catch(() => null), ultimo, agora);
      if (enviar !== null && !parado) {
        // A failed PUT leaves `ultimo` as it was: the next round tries again.
        await servidor.jogo(enviar).then(() => (ultimo = { jogo: enviar, em: agora }), () => undefined);
      }
    }
    if (!parado) timer = setTimeout(() => void rodada(), DETECTAR_MS);
  }

  // Presence turned off: clear the game on the server right away.
  const pararPref = aoMudarPreferencias((p) => {
    if (!p.presencaJogo && ultimo?.jogo) void servidor.jogo('').then(() => (ultimo = { jogo: '', em: Date.now() }), () => undefined);
  });
  void rodada();
  return () => {
    parado = true;
    clearTimeout(timer);
    pararPref();
  };
}

/** First time each person's current game was seen on this PC, for "jogando CS2 · 1 h 12". */
const vistos = new Map<string, { jogo: string; desde: number }>();
export function desdeQuando(id: string, jogo: string, agora = Date.now()) {
  const v = vistos.get(id);
  if (v?.jogo === jogo) return v.desde;
  vistos.set(id, { jogo, desde: agora });
  return agora;
}

export function duracaoJogo(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${String(resto).padStart(2, '0')}` : `${h} h`;
}
