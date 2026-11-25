import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AudioPresets, Participant, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track,
  type DisconnectReason,
} from 'livekit-client';
import { interfaceAtiva, useInterfaceAtiva } from '../lib/leveza';
import type { Servidor } from '../lib/servidor';
import { resolutionOf, type Codec, type Preset } from '../lib/presets';
import { stopTransmission, type StreamEvent } from '../lib/sidecar';
import { aoMudarVoz, capturaDe, lerVoz } from '../lib/voz';
import { horaDe, type ChatMessage, type Person, type RoomActions, type RoomModel, type Stream, type StreamStats } from './model';

export type Session = { servidor: Servidor };

const SCREEN = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const SCREEN_SUFFIX = ':tela';
const screenParticipant = (identity: string) => identity.endsWith(SCREEN_SUFFIX);
const screenOwner = (identity: string) => screenParticipant(identity) ? identity.slice(0, -SCREEN_SUFFIX.length) : identity;
const streamInfo = (preset: Preset, codec: Codec) =>
  `${preset.height === 2160 ? '4K' : `${preset.height}P`}${preset.fps} · ${codec === 'av1' ? 'AV1' : 'H.264'}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_CHAT = 200;
/** Hidden this long (game on top, tray, minimized): stop receiving the watched screen. */
export const VIDEO_OCULTO_MS = 10_000;
const MIC_ERROR = 'Microfone indisponível. Confira a permissão do Windows e o dispositivo.';
/** Disconnects that a retry would only repeat: same account elsewhere, removed, room gone. */
const FIM: Partial<Record<number, string>> = {
  2: 'Você entrou nesta sala por outro aparelho.',
  4: 'Você foi tirado da sala.',
  5: 'A sala foi apagada.',
};

export function useLiveRoom(session: Session, roomId: string): RoomModel & RoomActions {
  const roomRef = useRef<Room | null>(null);
  const screenAccess = useRef<{ url: string; token: string; expires: number } | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<RoomModel['state']>('connecting');
  const [error, setError] = useState<string>();
  const [autoRetry, setAutoRetry] = useState(true);
  const [micError, setMicError] = useState<string>();
  const [streamError, setStreamError] = useState<string>();
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const ativa = useInterfaceAtiva();
  const [ping, setPing] = useState<number | null>(null);
  const [stageStats, setStageStats] = useState<StreamStats | null>(null);
  const [deafened, setDeafened] = useState(false);
  const deafRef = useRef(false);
  const micBeforeDeafen = useRef(true);
  const volumes = useRef(new Map<string, number>());
  /** viewer identity -> streamer identity, from "watch" data messages plus our own entry. */
  const watchMap = useRef(new Map<string, string>());
  const watchingRef = useRef<string | null>(null);
  const live = useRef<{ track: MediaStreamTrack; info: string } | null>(null);
  const native = useRef<{ id: string; info: string } | null>(null);

  const applyVolume = (p: RemoteParticipant) => {
    const v = deafRef.current ? 0 : volumes.current.get(screenOwner(p.identity)) ?? 1;
    p.setVolume(v, Track.Source.Microphone);
    p.setVolume(v, Track.Source.ScreenShareAudio);
  };

  const sendWatch = (room: Room, target: string | null, to?: string[]) =>
    room.localParticipant
      .publishData(encoder.encode(JSON.stringify({ target })), { reliable: true, topic: 'watch', destinationIdentities: to })
      .catch(() => undefined);

  useEffect(() => {
    if (!isTauri()) return;
    const unsubscribe = listen<StreamEvent>('stackcall-stream', ({ payload }) => {
      if (native.current?.id !== payload.id) return;
      if (payload.event === 'error' || payload.event === 'stopped') {
        native.current = null;
        if (payload.event === 'error') setStreamError(payload.reason ?? 'O núcleo de transmissão foi encerrado.');
        rerender();
      }
    });
    return () => { void unsubscribe.then((unlisten) => unlisten()); };
  }, [rerender]);

  useEffect(() => {
    const room = new Room({
      webAudioMix: true, // lets per-person gain go above 100%
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: capturaDe(lerVoz()),
      audioOutput: lerVoz().saida ? { deviceId: lerVoz().saida } : undefined,
      // Opus 48 kbps with DTX (silence costs nothing) and RED (redundancy against packet loss).
      publishDefaults: { audioPreset: AudioPresets.music, dtx: true, red: true },
    });
    roomRef.current = room;
    let closed = false;
    let falando = '';
    const audioElements = new Set<HTMLMediaElement>();
    setState('connecting');
    setError(undefined);
    setAutoRetry(true);
    setStreamError(undefined);
    setChat([]);
    watchMap.current.clear();
    watchingRef.current = null;

    // Voice and cameras subscribe at once; a screen only after "Assistir", to save bandwidth.
    const subscribeDefault = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      const owner = screenOwner(p.identity);
      const ownScreen = screenParticipant(p.identity) && owner === room.localParticipant.identity;
      if (ownScreen) {
        if (pub.source === Track.Source.ScreenShare) pub.setSubscribed(true);
      } else if (!SCREEN.includes(pub.source) || watchingRef.current === owner) {
        pub.setSubscribed(true);
      }
    };

    const clearWatch = (owner: string) => {
      if (watchingRef.current !== owner) return;
      watchingRef.current = null;
      watchMap.current.delete(room.localParticipant.identity);
      void sendWatch(room, null);
    };

    room
      .on(RoomEvent.TrackPublished, (pub, p) => {
        subscribeDefault(pub, p);
        rerender();
      })
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare) clearWatch(screenOwner(p.identity));
        rerender();
      })
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          audioElements.add(el);
          document.body.appendChild(el);
        }
        rerender();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) {
          audioElements.delete(el);
          el.remove();
        }
        rerender();
      })
      .on(RoomEvent.ParticipantConnected, (p) => {
        applyVolume(p);
        const mine = watchMap.current.get(room.localParticipant.identity);
        if (mine && !screenParticipant(p.identity)) void sendWatch(room, mine, [p.identity]);
        rerender();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        watchMap.current.delete(p.identity);
        if (screenParticipant(p.identity) || !room.remoteParticipants.has(p.identity + SCREEN_SUFFIX)) {
          clearWatch(screenOwner(p.identity));
        }
        rerender();
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (!participant || screenParticipant(participant.identity)) return;
        let msg: { text?: unknown; target?: unknown };
        try {
          msg = JSON.parse(decoder.decode(payload));
        } catch {
          return;
        }
        if (topic === 'chat' && typeof msg.text === 'string' && msg.text.trim()) {
          const text = msg.text.slice(0, 2000);
          const who = participant.name || participant.identity;
          setChat((c) => [...c.slice(-MAX_CHAT + 1), { id: crypto.randomUUID(), who, hora: horaDe(new Date()), text, mine: false }]);
        } else if (topic === 'watch') {
          if (typeof msg.target === 'string') watchMap.current.set(participant.identity, msg.target);
          else watchMap.current.delete(participant.identity);
          rerender();
        }
      })
      // Re-render only when who is speaking changes; the meters read the level themselves.
      // Nothing to draw while hidden; showing the window re-renders once (useInterfaceAtiva).
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const ids = speakers.map((p) => p.identity).sort().join(' ');
        if (ids === falando || !interfaceAtiva()) return;
        falando = ids;
        rerender();
      })
      .on(RoomEvent.TrackMuted, rerender)
      .on(RoomEvent.TrackUnmuted, rerender)
      .on(RoomEvent.LocalTrackPublished, rerender)
      .on(RoomEvent.LocalTrackUnpublished, rerender)
      .on(RoomEvent.Reconnecting, () => setState('reconnecting'))
      .on(RoomEvent.Reconnected, () => setState('connected'))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (closed) return;
        screenAccess.current = null;
        if (native.current) void stopTransmission(native.current.id).catch(() => undefined);
        const fim = reason !== undefined ? FIM[reason] : undefined;
        setAutoRetry(!fim);
        setState('error');
        setError(fim ?? 'A conexão com a sala caiu.');
      });

    (async () => {
      try {
        const requestedAt = Date.now();
        const { url, token, screen_token } = await session.servidor.token(roomId);
        if (closed) return;
        await room.connect(url, token, { autoSubscribe: false });
        if (closed) return void room.disconnect();
        screenAccess.current = { url, token: screen_token, expires: requestedAt + 3600_000 };
        room.remoteParticipants.forEach((p) => {
          applyVolume(p);
          p.trackPublications.forEach((pub) => subscribeDefault(pub, p));
        });
        setState('connected');
        await room.startAudio().catch(() => undefined);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setMicError(undefined);
        } catch {
          setMicError(MIC_ERROR);
        }
        rerender();
      } catch (e) {
        if (closed) return;
        setState('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    // Settings > Voz: devices and processing change without leaving the room.
    const pararVoz = aoMudarVoz((v, antes) => {
      room.options.audioCaptureDefaults = capturaDe(v);
      if (v.saida !== antes.saida) void room.switchActiveDevice('audiooutput', v.saida || 'default').catch(() => undefined);
      const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!mic) return;
      if (v.entrada !== antes.entrada || v.eco !== antes.eco || v.ganho !== antes.ganho || v.ruido !== antes.ruido) {
        void mic.restartTrack(capturaDe(v)).then(() => setMicError(undefined), () => setMicError(MIC_ERROR));
      }
    });

    // Real ping and stage numbers from WebRTC stats every 2 s, only while someone can see them.
    let lastVideo: { bytes: number; at: number } | null = null;
    const stats = setInterval(async () => {
      if (!interfaceAtiva() || room.state !== 'connected') return;
      const tracks = [
        room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track,
        ...[...room.remoteParticipants.values()].flatMap((p) => [...p.audioTrackPublications.values()].map((pub) => pub.track)),
      ].filter((t) => !!t);
      const audio = await tracks[0]?.getRTCStatsReport().catch(() => undefined);
      setPing(audio ? rttOf(audio) : null);
      if (!watchingRef.current && !lastVideo) return; // nothing watched: skip the stats object
      const owner = watchingRef.current;
      const screen = owner
        ? [room.remoteParticipants.get(owner + SCREEN_SUFFIX), room.remoteParticipants.get(owner)]
          .map((p) => p?.getTrackPublication(Track.Source.ScreenShare)?.videoTrack).find((t) => !!t)
        : undefined;
      const report = await screen?.getRTCStatsReport().catch(() => undefined);
      const next = report ? videoOf(report, lastVideo) : null;
      lastVideo = next ? { bytes: next.bytes, at: performance.now() } : null;
      setStageStats(next && { height: next.height, fps: next.fps, codec: next.codec, mbps: next.mbps });
    }, 2000);
    return () => {
      closed = true;
      pararVoz();
      screenAccess.current = null;
      clearInterval(stats);
      live.current?.track.stop();
      live.current = null;
      const publishing = native.current;
      native.current = null;
      if (publishing) void stopTransmission(publishing.id).catch(() => undefined);
      void room.disconnect();
      audioElements.forEach((el) => el.remove());
      roomRef.current = null;
    };
  }, [session, roomId, rerender]);

  // Nobody sees the screen for VIDEO_OCULTO_MS: pause the watched video (no download, no decode).
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const telas = () => [...room.remoteParticipants.values()].flatMap((p) =>
      [...p.trackPublications.values()].filter((pub) => pub.source === Track.Source.ScreenShare && pub.isSubscribed));
    if (ativa) {
      telas().forEach((pub) => pub.setEnabled(true));
      return;
    }
    const t = setTimeout(() => telas().forEach((pub) => pub.setEnabled(false)), VIDEO_OCULTO_MS);
    return () => clearTimeout(t);
  }, [ativa, state]);

  const room = roomRef.current;
  const lp = room?.localParticipant;
  const participants: Participant[] = room && lp ? [lp, ...room.remoteParticipants.values()] : [];
  const screenByOwner = new Map<string, Participant>();
  for (const p of participants) {
    if (p.getTrackPublication(Track.Source.ScreenShare)) {
      const owner = screenOwner(p.identity);
      if (!screenByOwner.has(owner) || screenParticipant(p.identity)) screenByOwner.set(owner, p);
    }
  }

  const people: Person[] = participants.filter((p) => !screenParticipant(p.identity)).map((p) => {
    const cam = p.getTrackPublication(Track.Source.Camera);
    return {
      id: p.identity,
      name: p.name || p.identity,
      isLocal: p === lp,
      speaking: p.isSpeaking,
      muted: !p.isMicrophoneEnabled,
      level: Math.min(1, p.audioLevel * 2),
      nivel: () => Math.min(1, p.audioLevel * 2),
      volume: volumes.current.get(p.identity) ?? 1,
      camera: cam?.videoTrack && !cam.isMuted ? cam.videoTrack : undefined,
      live: screenByOwner.has(p.identity) || (p === lp && native.current !== null),
    };
  });

  const watchersOf = (id: string) => [...watchMap.current.values()].filter((t) => t === id).length;

  const streams: Stream[] = [...screenByOwner].map(([id, p]) => {
    const owner = people.find((p) => p.id === id) ?? {
      id, name: p.name || id, isLocal: false, speaking: false, muted: true, level: 0, volume: volumes.current.get(id) ?? 1, live: true,
    };
    const pub = p.getTrackPublication(Track.Source.ScreenShare)!;
    const dims = pub.dimensions;
    return {
      owner,
      track: owner.isLocal || pub.isSubscribed ? pub.videoTrack : undefined,
      watching: owner.isLocal || watchingRef.current === owner.id,
      watchers: watchersOf(owner.id),
      info: (owner.isLocal ? native.current?.info ?? live.current?.info : undefined) ?? (dims ? `${dims.height}P` : ''),
    };
  });

  const setScreenSubscribed = (id: string, on: boolean) => {
    for (const identity of [id, id + SCREEN_SUFFIX]) {
      room?.remoteParticipants.get(identity)?.trackPublications.forEach((pub) => {
        if (SCREEN.includes(pub.source)) pub.setSubscribed(on);
      });
    }
  };

  const actions: RoomActions = {
    toggleMic: () => {
      if (!lp) return;
      lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
        .then(() => setMicError(undefined), () => setMicError(MIC_ERROR))
        .finally(rerender);
    },
    toggleDeafen: () => {
      if (!room || !lp) return;
      const next = !deafRef.current;
      deafRef.current = next;
      setDeafened(next);
      room.remoteParticipants.forEach(applyVolume);
      // Deafen also mutes the mic; undeafen restores the previous mic state.
      if (next) micBeforeDeafen.current = lp.isMicrophoneEnabled;
      void lp.setMicrophoneEnabled(next ? false : micBeforeDeafen.current).catch(() => undefined).finally(rerender);
    },
    toggleCamera: () => {
      if (lp) void lp.setCameraEnabled(!lp.isCameraEnabled).catch(() => undefined).finally(rerender);
    },
    setVolume: (id, volume) => {
      volumes.current.set(id, volume);
      const p = room?.remoteParticipants.get(id);
      if (p) applyVolume(p);
      const screen = room?.remoteParticipants.get(id + SCREEN_SUFFIX);
      if (screen) applyVolume(screen);
      rerender();
    },
    watch: (id) => {
      if (!room) return;
      if (watchingRef.current && watchingRef.current !== id) setScreenSubscribed(watchingRef.current, false);
      watchingRef.current = id;
      watchMap.current.set(room.localParticipant.identity, id);
      setScreenSubscribed(id, true);
      void sendWatch(room, id);
      rerender();
    },
    unwatch: (id) => {
      if (!room) return;
      setScreenSubscribed(id, false);
      watchingRef.current = null;
      watchMap.current.delete(room.localParticipant.identity);
      void sendWatch(room, null);
      rerender();
    },
    sendChat: (raw) => {
      // Reads the current room: the memoized chat keeps the first sendChat it got.
      const lp = roomRef.current?.localParticipant;
      const text = raw.trim().slice(0, 2000);
      if (!text || !lp) return;
      void lp.publishData(encoder.encode(JSON.stringify({ text })), { reliable: true, topic: 'chat' });
      const who = lp.name || lp.identity;
      setChat((c) => [...c.slice(-MAX_CHAT + 1), { id: crypto.randomUUID(), who, hora: horaDe(new Date()), text, mine: true }]);
    },
    goLive: async (track: MediaStreamTrack, preset: Preset, codec: Codec) => {
      if (!lp) throw new Error('Sem conexão com a sala.');
      track.contentHint = 'motion';
      await track
        .applyConstraints({
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: preset.fps, max: preset.fps },
        })
        .catch(() => undefined);
      await lp.publishTrack(track, {
        source: Track.Source.ScreenShare,
        name: 'tela',
        videoCodec: codec,
        simulcast: true,
        // WebView2 fallback: keep the resolution sharp and give it more bitrate than the native encoder.
        screenShareEncoding: { maxBitrate: preset.mbps[codec] * 1.5e6, maxFramerate: preset.fps },
        backupCodec: codec === 'av1' ? { codec: 'h264' } : false,
        degradationPreference: 'maintain-resolution',
      });
      live.current = { track, info: streamInfo(preset, codec) };
      track.addEventListener('ended', () => actions.stopLive(), { once: true });
      rerender();
    },
    goLiveNative: async (source, preset, codec, audio) => {
      const access = screenAccess.current;
      if (!room || !lp || !access || !preset.trial) throw new Error('Sem conexão com a sala ou preset indisponível.');
      if (Date.now() >= access.expires) throw new Error('O token de transmissão expirou. Entre novamente na sala.');
      const id = crypto.randomUUID();
      native.current = { id, info: streamInfo(preset, codec) };
      setStreamError(undefined);
      try {
        await invoke('iniciar_transmissao', { args: {
          id, source: source.id, resolution: resolutionOf(preset), fps: preset.fps, codec,
          encoder: preset.trial.encoder.split('_')[1], kbps: Math.round(preset.mbps[codec] * 1000),
          audio_pid: audio ? source.pid : null, url: access.url, token: access.token,
        } });
        if (roomRef.current !== room) {
          await stopTransmission(id);
          throw new Error('A sala mudou. Escolha a fonte novamente.');
        }
        rerender();
      } catch (error) {
        if (native.current?.id === id) native.current = null;
        throw error;
      }
    },
    clearStreamError: () => setStreamError(undefined),
    stopLive: () => {
      if (native.current) {
        void stopTransmission(native.current.id).catch(() => setStreamError('Falha ao encerrar a transmissão.'));
      }
      const current = live.current;
      live.current = null;
      if (current && lp) void lp.unpublishTrack(current.track, true).finally(rerender);
      current?.track.stop();
    },
  };

  return {
    room: roomId, state, error, autoRetry, people, streams, chat, deafened, micError, streamError, ping, stageStats,
    micOn: !!lp?.isMicrophoneEnabled,
    cameraOn: !!lp?.isCameraEnabled,
    ...actions,
  };
}

/** Round trip of the selected ICE candidate pair, in ms. */
function rttOf(report: RTCStatsReport) {
  let rtt: number | null = null;
  report.forEach((s) => {
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && typeof s.currentRoundTripTime === 'number') {
      rtt = Math.round(s.currentRoundTripTime * 1000);
    }
  });
  return rtt;
}

/** Resolution, frame rate, codec and bitrate of the watched screen. */
function videoOf(report: RTCStatsReport, last: { bytes: number; at: number } | null): (StreamStats & { bytes: number }) | null {
  let found: (StreamStats & { bytes: number }) | null = null;
  report.forEach((s) => {
    if (s.type !== 'inbound-rtp' || s.kind !== 'video' || !s.frameHeight) return;
    const codec = report.get(s.codecId)?.mimeType?.split('/')[1]?.toUpperCase() ?? '';
    const mbps = last ? ((s.bytesReceived - last.bytes) * 8) / ((performance.now() - last.at) / 1000) / 1e6 : null;
    found = {
      height: s.frameHeight, fps: Math.round(s.framesPerSecond ?? 0),
      codec: codec === 'H264' ? 'H.264' : codec, mbps: mbps !== null && mbps >= 0 ? mbps : null, bytes: s.bytesReceived,
    };
  });
  return found;
}