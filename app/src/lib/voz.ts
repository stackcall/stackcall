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
};

const CHAVE = 'stackcall.voz';
export const VOZ_PADRAO: Voz = { entrada: '', saida: '', eco: true, ganho: true, ruido: true };

export function lerVoz(): Voz {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
    return {
      entrada: typeof v.entrada === 'string' ? v.entrada : '',
      saida: typeof v.saida === 'string' ? v.saida : '',
      eco: v.eco !== false,
      ganho: v.ganho !== false,
      ruido: v.ruido !== false,
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
  noiseSuppression: v.ruido,
});
