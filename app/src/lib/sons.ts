/**
 * Short confirmation sounds for global shortcuts, synthesized with Web Audio: no audio file
 * to ship, nothing to download. Quiet on purpose (it plays over the game).
 */
export type Som = 'liga' | 'desliga' | 'silenciou';

/** Tones in Hz, played one after the other (90 ms each). */
export const TONS: Record<Som, number[]> = {
  liga: [660, 990],
  desliga: [660, 440],
  silenciou: [330, 330],
};

let ctx: AudioContext | null = null;

export function tocarSom(som: Som) {
  if (typeof AudioContext === 'undefined') return;
  try {
    ctx ??= new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume().catch(() => undefined);
    const inicio = ctx.currentTime + 0.01;
    TONS[som].forEach((hz, i) => {
      const t = inicio + i * 0.11;
      const osc = ctx!.createOscillator();
      const ganho = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      // Short attack and decay: no click at the start or the end.
      ganho.gain.setValueAtTime(0, t);
      ganho.gain.linearRampToValueAtTime(0.08, t + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(ganho).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    });
  } catch {
    // No audio output: the action still happened, the sound is only a hint.
  }
}
