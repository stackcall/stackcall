const CHAVE = 'stackcall.voz';
export const VOZ_PADRAO = { entrada: '', saida: '', eco: true, ganho: true, ruido: true, forte: false, modo: 'voz', soltura: 200 };
export function lerVoz() {
    try {
        const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
        return {
            entrada: typeof v.entrada === 'string' ? v.entrada : '',
            saida: typeof v.saida === 'string' ? v.saida : '',
            eco: v.eco !== false,
            ganho: v.ganho !== false,
            ruido: v.ruido !== false,
            forte: v.forte === true,
            modo: v.modo === 'ptt' ? 'ptt' : 'voz',
            soltura: Number.isFinite(v.soltura) ? Math.min(1000, Math.max(0, Math.round(v.soltura))) : 200,
        };
    }
    catch {
        return { ...VOZ_PADRAO };
    }
}
const ouvintes = new Set();
export function aoMudarVoz(f) {
    ouvintes.add(f);
    return () => void ouvintes.delete(f);
}
export function salvarVoz(mudanca) {
    const antes = lerVoz();
    const v = { ...antes, ...mudanca };
    try {
        localStorage.setItem(CHAVE, JSON.stringify(v));
    }
    catch {
        // Storage blocked: the change still applies to this session.
    }
    ouvintes.forEach((f) => f(v, antes));
    return v;
}
/** Capture constraints for the microphone (livekit AudioCaptureOptions and getUserMedia). */
export const capturaDe = (v) => ({
    // ideal, not exact: an unplugged device falls back to the Windows default instead of failing.
    deviceId: v.entrada ? { ideal: v.entrada } : undefined,
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: v.eco,
    autoGainControl: v.ganho,
    // With the strong suppression on, the browser's one stays off: suppressing twice clips words.
    noiseSuppression: v.ruido && !v.forte,
});
/**
 * Turns the strong suppression on or off on the live microphone, without leaving the room.
 * On any failure (download, WASM, worklet) the microphone goes back to normal and the result
 * says so; the caller shows the notice and turns the option off.
 */
export async function aplicarForte(mic, ligar, carregar = () => import('./rnnoise')) {
    if (!ligar) {
        await mic.stopProcessor().catch(() => undefined);
        return 'desligado';
    }
    try {
        const { processadorForte } = await carregar();
        await mic.setProcessor(processadorForte());
        return 'ligado';
    }
    catch {
        await mic.stopProcessor().catch(() => undefined);
        return 'falhou';
    }
}
export const AVISO_FORTE = 'A supressão forte não funcionou neste PC. O microfone voltou ao normal.';
