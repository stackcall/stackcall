/** Tones in Hz, played one after the other (90 ms each). */
export const TONS = {
    liga: [660, 990],
    desliga: [660, 440],
    silenciou: [330, 330],
    // Someone entered or left the room (Settings > Sons e avisos).
    entrou: [523, 784],
    saiu: [784, 523],
    // Poke received on a PC with no Portuguese voice.
    cutucada: [880, 660, 880],
};
let ctx = null;
/** `volume` 0 to 1 scales the quiet default. */
export function tocarSom(som, volume = 1) {
    if (typeof AudioContext === 'undefined')
        return;
    try {
        ctx ??= new AudioContext({ latencyHint: 'interactive' });
        void ctx.resume().catch(() => undefined);
        const inicio = ctx.currentTime + 0.01;
        TONS[som].forEach((hz, i) => {
            const t = inicio + i * 0.11;
            const osc = ctx.createOscillator();
            const ganho = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = hz;
            // Short attack and decay: no click at the start or the end.
            ganho.gain.setValueAtTime(0, t);
            ganho.gain.linearRampToValueAtTime(Math.max(0.0002, 0.08 * volume), t + 0.01);
            ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
            osc.connect(ganho).connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.1);
        });
    }
    catch {
        // No audio output: the action still happened, the sound is only a hint.
    }
}
