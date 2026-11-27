/**
 * Watched screen that never shows a frame (codec the device cannot decode, light track the sender
 * never published, network): Original falls back to Leve 720p H.264, Leve ends in a retry message.
 */
export const ORIGINAL_MS = 10_000;
/** The sender's core needs a moment to start the light encoder. */
export const LEVE_MS = 15_000;

export type Passo = 'ok' | 'esperar' | 'leve' | 'falhou';

export function vigiar(desde: number | null, temImagem: boolean, agora: number, leve: boolean): Passo {
  if (temImagem) return 'ok';
  if (desde === null) return 'esperar';
  return agora - desde < (leve ? LEVE_MS : ORIGINAL_MS) ? 'esperar' : leve ? 'falhou' : 'leve';
}

/** False only when the browser says it cannot receive this codec (iPhones without AV1, for example). */
export function decodifica(mimeType?: string): boolean {
  if (!mimeType || typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return true;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs;
  return !codecs || codecs.some((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
}
