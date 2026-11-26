import { describe, expect, it } from 'vitest';
import { lerAmostra, linhaAssistir } from './qualidadeRecebida';

const relatorio = (stats: Record<string, unknown>[]) => new Map(stats.map((s) => [String(s.id), s])) as unknown as RTCStatsReport;

const video = (o: Record<string, number>) =>
  relatorio([
    { id: 'c', type: 'codec', mimeType: 'video/AV1' },
    { id: 'v', type: 'inbound-rtp', kind: 'video', codecId: 'c', frameHeight: 1080, framesPerSecond: 59.6, ...o },
  ]);
const audio = (o: Record<string, number>) => relatorio([{ id: 'a', type: 'inbound-rtp', kind: 'audio', ...o }]);

describe('qualidade recebida', () => {
  it('resume o minuto: bitrate, travadas, perda, espera e som x imagem', () => {
    const antes = lerAmostra(
      video({ bytesReceived: 0, packetsLost: 0, packetsReceived: 0, freezeCount: 1, totalFreezesDuration: 0.5, jitterBufferDelay: 0, jitterBufferEmittedCount: 0 }),
      audio({ packetsLost: 0, packetsReceived: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0 }),
      0,
    )!;
    const agora = lerAmostra(
      video({
        bytesReceived: 60_000_000, packetsLost: 10, packetsReceived: 990, freezeCount: 3, totalFreezesDuration: 1.7,
        jitterBufferDelay: 360, jitterBufferEmittedCount: 3600, estimatedPlayoutTimestamp: 1_000_000,
      }),
      audio({ packetsLost: 1, packetsReceived: 999, jitterBufferDelay: 3000, jitterBufferEmittedCount: 48_000, estimatedPlayoutTimestamp: 1_000_040 }),
      60_000,
    )!;
    expect(linhaAssistir('TROYA', agora, antes)).toBe(
      'tela de TROYA: 1080p 60 fps 8.0 Mb/s AV1 | travadas 2 (1.2 s) | perda vídeo 1.0% som 0.1% | espera vídeo 100 ms som 63 ms | som adiantado 40 ms',
    );
  });

  it('diz atrasado, junto ou sem dado conforme o horário do que toca', () => {
    const base = lerAmostra(video({}), undefined, 0)!;
    const com = (a: number | undefined, v: number | undefined) => linhaAssistir('x', { ...base, at: 1000, tocandoAudio: a, tocandoVideo: v }, base).split(' | ').at(-1);
    expect(com(1000, 1120)).toBe('som atrasado 120 ms');
    expect(com(1000, 1010)).toBe('som junto com a imagem');
    expect(com(undefined, 1000)).toBe('som x imagem: sem dado');
  });

  it('ignora relatório sem vídeo', () => {
    expect(lerAmostra(audio({}), undefined, 0)).toBeNull();
  });
});
