import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Participant, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track,
  type DisconnectReason,
} from 'livekit-client';
import { requestToken } from '../lib/api';
import type { RoomId } from '../lib/config';
import { resolutionOf, type Codec, type Preset } from '../lib/presets';
import { stopTransmission, type StreamEvent } from '../lib/sidecar';
import type { ChatMessage, Person, RoomActions, RoomModel, Stream } from './model';

export type Session = { server: string; name: string; invite: string };

const SCREEN = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const SCREEN_SUFFIX = ':tela';
const screenParticipant = (identity: string) => identity.endsWith(SCREEN_SUFFIX);
const screenOwner = (identity: string) => screenParticipant(identity) ? identity.slice(0, -SCREEN_SUFFIX.length) : identity;
const streamInfo = (preset: Preset, codec: Codec) =>
  `${preset.height === 2160 ? '4K' : `${preset.height}P`}${preset.fps} · ${codec === 'av1' ? 'AV1' : 'H.264'}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_CHAT = 200;
const MIC_ERROR = 'Microfone indisponível. Confira a permissão do Windows e o dispositivo.';

export function useLiveRoom(session: Session, roomId: RoomId): RoomModel & RoomActions {
  const roomRef = useRef<Room | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<RoomModel['state']>('connecting');
  const [error, setError] = useState<string>();
  const [micError, setMicError] = useState<string>();
  const [streamError, setStreamError] = useState<string>();
  const [chat, setChat] = useState<ChatMessage[]>([]);
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
      audioCaptureDefaults: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
    });
    roomRef.current = room;
    let closed = false;
    const audioElements = new Set<HTMLMediaElement>();
    setState('connecting');
    setError(undefined);
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
          setChat((c) => [...c.slice(-MAX_CHAT + 1), { id: crypto.randomUUID(), who, at: new Date(), text, mine: false }]);
        } else if (topic === 'watch') {
          if (typeof msg.target === 'string') watchMap.current.set(participant.identity, msg.target);
          else watchMap.current.delete(participant.identity);
          rerender();
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, rerender)
      .on(RoomEvent.TrackMuted, rerender)
      .on(RoomEvent.TrackUnmuted, rerender)
      .on(RoomEvent.LocalTrackPublished, rerender)
      .on(RoomEvent.LocalTrackUnpublished, rerender)
      .on(RoomEvent.Reconnecting, () => setState('reconnecting'))
      .on(RoomEvent.Reconnected, () => setState('connected'))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (closed) return;
        if (native.current) void stopTransmission(native.current.id).catch(() => undefined);
        setState('error');
        setError(`A conexão com a sala caiu${reason !== undefined ? ` (motivo ${reason})` : ''}. Troque de aba para tentar de novo.`);
      });

    (async () => {
      try {
        const { url, token } = await requestToken(session.server, session.invite, session.name, roomId);
        if (closed) return;
        await room.connect(url, token, { autoSubscribe: false });
        if (closed) return void room.disconnect();
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

    const levels = setInterval(rerender, 150); // audio meters
    return () => {
      closed = true;
      clearInterval(levels);
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
      volume: volumes.current.get(p.identity) ?? 1,
      camera: cam?.videoTrack && !cam.isMuted ? cam.videoTrack : undefined,
      live: screenByOwner.has(p.identity) || (p === lp && native.current !== null),
    };
  });

  const watchersOf = (id: string) => [...watchMap.current.values()].filter((t) => t === id).length;

  const streams: Stream[] = [...screenByOwner].map(([id, p]) => {
    const owner = people.find((p) => p.id === id) ?? {
      id, name: id, isLocal: false, speaking: false, muted: true, level: 0, volume: volumes.current.get(id) ?? 1, live: true,
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
      const text = raw.trim().slice(0, 2000);
      if (!text || !lp) return;
      void lp.publishData(encoder.encode(JSON.stringify({ text })), { reliable: true, topic: 'chat' });
      const who = lp.name || lp.identity;
      setChat((c) => [...c.slice(-MAX_CHAT + 1), { id: crypto.randomUUID(), who, at: new Date(), text, mine: true }]);
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
        screenShareEncoding: { maxBitrate: preset.mbps[codec] * 1e6, maxFramerate: preset.fps },
        backupCodec: codec === 'av1' ? { codec: 'h264' } : false,
        degradationPreference: 'maintain-framerate',
      });
      live.current = { track, info: streamInfo(preset, codec) };
      track.addEventListener('ended', () => actions.stopLive(), { once: true });
      rerender();
    },
    goLiveNative: async (source, preset, codec, audio) => {
      if (!room || !lp || !preset.trial) throw new Error('Sem conexão com a sala ou preset indisponível.');
      const id = crypto.randomUUID();
      const { url, token } = await requestToken(session.server, session.invite, session.name + SCREEN_SUFFIX, roomId);
      if (roomRef.current !== room) throw new Error('A sala mudou. Escolha a fonte novamente.');
      native.current = { id, info: streamInfo(preset, codec) };
      setStreamError(undefined);
      try {
        await invoke('iniciar_transmissao', { args: {
          id, source: source.id, resolution: resolutionOf(preset), fps: preset.fps, codec,
          encoder: preset.trial.encoder.split('_')[1], kbps: Math.round(preset.mbps[codec] * 1000),
          audio_pid: audio ? source.pid : null, url, token,
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
    room: roomId, state, error, people, streams, chat, deafened, micError, streamError,
    micOn: !!lp?.isMicrophoneEnabled,
    cameraOn: !!lp?.isCameraEnabled,
    ...actions,
  };
}
