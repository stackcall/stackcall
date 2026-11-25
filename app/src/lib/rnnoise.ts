import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
// Bundled files (no CDN): Vite emits them as assets, loaded only when this module is imported.
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

/**
 * Strong noise suppression (keyboard, clicks): RNNoise in WASM on an AudioWorklet, as a
 * livekit-client TrackProcessor on the microphone. Loaded with import() only when turned on.
 * Runs on its own 48 kHz AudioContext because RNNoise assumes 48 kHz.
 */
export function processadorForte(): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let ctx: AudioContext | null = null;
  let no: RnnoiseWorkletNode | null = null;

  const desmontar = () => {
    no?.destroy();
    no = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
  };

  const montar = async (track: MediaStreamTrack) => {
    desmontar();
    const contexto = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    ctx = contexto;
    try {
      const [wasmBinary] = await Promise.all([loadRnnoise({ url: wasmUrl, simdUrl }), contexto.audioWorklet.addModule(workletUrl)]);
      // The worklet compiles the WASM on its own and fails silently (the mic would go mute). Compile it
      // here first, under the same CSP: a block or a bad binary throws and the caller falls back.
      await WebAssembly.compile(wasmBinary);
      const origem = contexto.createMediaStreamSource(new MediaStream([track]));
      no = new RnnoiseWorkletNode(contexto, { maxChannels: 1, wasmBinary });
      const destino = contexto.createMediaStreamDestination();
      origem.connect(no).connect(destino);
      proc.processedTrack = destino.stream.getAudioTracks()[0];
    } catch (e) {
      desmontar();
      throw e;
    }
  };

  const proc: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'stackcall-rnnoise',
    init: async ({ track }) => montar(track),
    restart: async ({ track }) => montar(track),
    destroy: async () => {
      desmontar();
      proc.processedTrack = undefined;
    },
  };
  return proc;
}
