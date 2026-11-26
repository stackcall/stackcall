/**
 * What a viewer really received from a screen, from WebRTC stats: one line a minute for
 * logs/assistir.log, so "travou" or "som atrasado" can be checked afterwards.
 */
export type Amostra = {
  at: number;
  altura: number;
  fps: number;
  codec: string;
  bytes: number;
  perdidosVideo: number;
  recebidosVideo: number;
  travadas: number;
  travadasS: number;
  bufferVideoS: number;
  saidosVideo: number;
  perdidosAudio: number;
  recebidosAudio: number;
  bufferAudioS: number;
  saidosAudio: number;
  /** Sender NTP time (ms) of what plays now: audio minus video says which one is ahead. */
  tocandoVideo?: number;
  tocandoAudio?: number;
};

type Stat = Record<string, number | string | undefined>;

function inbound(report: RTCStatsReport | undefined, kind: 'video' | 'audio'): Stat | undefined {
  let found: Stat | undefined;
  report?.forEach((s: Stat) => {
    if (s.type === 'inbound-rtp' && s.kind === kind) found = s;
  });
  return found;
}

const n = (v: number | string | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const talvez = (v: number | string | undefined) => (typeof v === 'number' && v > 0 ? v : undefined);

export function lerAmostra(video: RTCStatsReport, audio: RTCStatsReport | undefined, at: number): Amostra | null {
  const v = inbound(video, 'video');
  if (!v) return null;
  const a = inbound(audio, 'audio');
  const mime = String((video.get(String(v.codecId)) as Stat | undefined)?.mimeType ?? '');
  return {
    at,
    altura: n(v.frameHeight),
    fps: Math.round(n(v.framesPerSecond)),
    codec: mime.split('/')[1]?.toUpperCase() ?? '',
    bytes: n(v.bytesReceived),
    perdidosVideo: n(v.packetsLost),
    recebidosVideo: n(v.packetsReceived),
    travadas: n(v.freezeCount),
    travadasS: n(v.totalFreezesDuration),
    bufferVideoS: n(v.jitterBufferDelay),
    saidosVideo: n(v.jitterBufferEmittedCount),
    perdidosAudio: n(a?.packetsLost),
    recebidosAudio: n(a?.packetsReceived),
    bufferAudioS: n(a?.jitterBufferDelay),
    saidosAudio: n(a?.jitterBufferEmittedCount),
    tocandoVideo: talvez(v.estimatedPlayoutTimestamp),
    tocandoAudio: talvez(a?.estimatedPlayoutTimestamp),
  };
}

const pct = (perdidos: number, recebidos: number) =>
  perdidos + recebidos > 0 ? `${((100 * perdidos) / (perdidos + recebidos)).toFixed(1)}%` : '-';
const ms = (segundos: number, quantos: number) => (quantos > 0 ? `${Math.round((1000 * segundos) / quantos)} ms` : '-');

/** Differences over the minute between two samples of the same screen. */
export function linhaAssistir(quem: string, agora: Amostra, antes: Amostra): string {
  const seg = Math.max(0.001, (agora.at - antes.at) / 1000);
  const mbps = ((agora.bytes - antes.bytes) * 8) / seg / 1e6;
  const d = (k: keyof Amostra) => Math.max(0, n(agora[k]) - n(antes[k]));
  const sync =
    agora.tocandoAudio && agora.tocandoVideo
      ? (() => {
          const dif = Math.round(agora.tocandoAudio - agora.tocandoVideo);
          if (Math.abs(dif) < 15) return 'som junto com a imagem';
          return dif > 0 ? `som adiantado ${dif} ms` : `som atrasado ${-dif} ms`;
        })()
      : 'som x imagem: sem dado';
  return [
    `tela de ${quem}: ${agora.altura}p ${agora.fps} fps ${mbps.toFixed(1)} Mb/s ${agora.codec}`,
    `travadas ${d('travadas')} (${d('travadasS').toFixed(1)} s)`,
    `perda vídeo ${pct(d('perdidosVideo'), d('recebidosVideo'))} som ${pct(d('perdidosAudio'), d('recebidosAudio'))}`,
    `espera vídeo ${ms(d('bufferVideoS'), d('saidosVideo'))} som ${ms(d('bufferAudioS'), d('saidosAudio'))}`,
    sync,
  ].join(' | ');
}
