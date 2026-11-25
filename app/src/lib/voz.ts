/**
 * Voice preferences, per PC: devices and the browser's audio processing. The room listens and
 * applies a change without leaving (useLiveRoom). Empty device id = Windows default.
 */
export type Voz = {
  entrada: string;
  saida: string;
  eco: boolean;
  ganho: boolean;
  ruido: boolean;
  /** RNNoise on top (keyboard, clicks). Off by default; its code only downloads when turned on. */
  forte: boolean;
};

const CHAVE = 'stackcall.voz';
export const VOZ_PADRAO: Voz = { entrada: '', saida: '', eco: true, ganho: true, ruido: true, forte: false };

export function lerVoz(): Voz {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
    return {
      entrada: typeof v.entrada === 'string' ? v.entrada : '',
      saida: typeof v.saida === 'string' ? v.saida : '',
      eco: v.eco !== false,
      ganho: v.ganho !== false,
      ruido: v.ruido !== false,
      forte: v.forte === true,
    };
  } catch {
    return { ...VOZ_PADRAO };
  }
}

const ouvintes = new Set<(v: Voz, antes: Voz) => void>();
export function aoMudarVoz(f: (v: Voz, antes: Voz) => void) {
  ouvintes.add(f);
  return () => void ouvintes.delete(f);
}

export function salvarVoz(mudanca: Partial<Voz>) {
  const antes = lerVoz();
  const v = { ...antes, ...mudanca };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(v));
  } catch {
    // Storage blocked: the change still applies to this session.
  }
  ouvintes.forEach((f) => f(v, antes));
  return v;
}

/** Capture constraints for the microphone (livekit AudioCaptureOptions and getUserMedia). */
export const capturaDe = (v: Voz) => ({
  // ideal, not exact: an unplugged device falls back to the Windows default instead of failing.
  deviceId: v.entrada ? { ideal: v.entrada } : undefined,
  channelCount: 1,
  sampleRate: 48000,
  echoCancellation: v.eco,
  autoGainControl: v.ganho,
  // With the strong suppression on, the browser's one stays off: suppressing twice clips words.
  noiseSuppression: v.ruido && !v.forte,
});

/** The microphone track as aplicarForte needs it (a livekit LocalAudioTrack fits). */
export type MicProcessavel = {
  setProcessor(p: Awaited<ReturnType<typeof import('./rnnoise').processadorForte>>): Promise<void>;
  stopProcessor(): Promise<void>;
};

/**
 * Turns the strong suppression on or off on the live microphone, without leaving the room.
 * On any failure (download, WASM, worklet) the microphone goes back to normal and the result
 * says so; the caller shows the notice and turns the option off.
 */
export async function aplicarForte(
  mic: MicProcessavel,
  ligar: boolean,
  carregar = () => import('./rnnoise'),
): Promise<'ligado' | 'desligado' | 'falhou'> {
  if (!ligar) {
    await mic.stopProcessor().catch(() => undefined);
    return 'desligado';
  }
  try {
    const { processadorForte } = await carregar();
    await mic.setProcessor(processadorForte());
    return 'ligado';
  } catch {
    await mic.stopProcessor().catch(() => undefined);
    return 'falhou';
  }
}
export const AVISO_FORTE = 'A supressão forte não funcionou neste PC. O microfone voltou ao normal.';
