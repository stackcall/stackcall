import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Participant, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track,
  type DisconnectReason,
} from 'livekit-client';
import { requestToken } from '../lib/api';
import type { RoomId } from '../lib/config';
import type { Codec, Preset } from '../lib/presets';
import type { ChatMessage, Person, RoomActions, RoomModel, Stream } from './model';

export type Session = { server: string; name: string; invite: string };

const SCREEN = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
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
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [deafened, setDeafened] = useState(false);
  const deafRef = useRef(false);
  const micBeforeDeafen = useRef(true);
  const volumes = useRef(new Map<string, number>());
  /** viewer identity -> streamer identity, from "watch" data messages plus our own entry. */
  const watchMap = useRef(new Map<string, string>());
  const watchingRef = useRef<string | null>(null);
  const live = useRef<{ track: MediaStreamTrack; info: string } | null>(null);

  const applyVolume = (p: RemoteParticipant) => {
    const v = deafRef.current ? 0 : volumes.current.get(p.identity) ?? 1;
    p.setVolume(v, Track.Source.Microphone);
    p.setVolume(v, Track.Source.ScreenShareAudio);
  };

  const sendWatch = (room: Room, target: string | null, to?: string[]) =>
    room.localParticipant
      .publishData(encoder.encode(JSON.stringify({ target })), { reliable: true, topic: 'watch', destinationIdentities: to })
      .catch(() => undefined);

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
    setChat([]);
    watchMap.current.clear();
    watchingRef.current = null;

    // Voice and cameras subscribe at once; a screen only after "Assistir", to save bandwidth.
    const subscribeDefault = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (!SCREEN.includes(pub.source) || watchingRef.current === p.identity) pub.setSubscribed(true);
    };

    room
      .on(RoomEvent.TrackPublished, (pub, p) => {
        subscribeDefault(pub, p);
        rerender();
      })
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare && watchingRef.current === p.identity) {
          watchingRef.current = null;
          watchMap.current.delete(room.localParticipant.identity);
          void sendWatch(room, null);
        }
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
        if (mine) void sendWatch(room, mine, [p.identity]);
        rerender();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        watchMap.current.delete(p.identity);
        if (watchingRef.current === p.identity) watchingRef.current = null;
        rerender();
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (!participant) return;
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
      void room.disconnect();
      audioElements.forEach((el) => el.remove());
      roomRef.current = null;
    };
  }, [session, roomId, rerender]);

  const room = roomRef.current;
  const lp = room?.localParticipant;
  const participants: Participant[] = room && lp ? [lp, ...room.remoteParticipants.values()] : [];

  const people: Person[] = participants.map((p) => {
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
      live: !!p.getTrackPublication(Track.Source.ScreenShare),
    };
  });

  const watchersOf = (id: string) => [...watchMap.current.values()].filter((t) => t === id).length;

  const streams: Stream[] = people.filter((p) => p.live).map((owner) => {
    const pub = participants.find((p) => p.identity === owner.id)!.getTrackPublication(Track.Source.ScreenShare)!;
    const dims = pub.dimensions;
    return {
      owner,
      track: owner.isLocal || pub.isSubscribed ? pub.videoTrack : undefined,
      watching: owner.isLocal || watchingRef.current === owner.id,
      watchers: watchersOf(owner.id),
      info: owner.isLocal && live.current ? live.current.info : dims ? `${dims.height}P` : '',
    };
  });

  const setScreenSubscribed = (id: string, on: boolean) => {
    room?.remoteParticipants.get(id)?.trackPublications.forEach((pub) => {
      if (SCREEN.includes(pub.source)) pub.setSubscribed(on);
    });
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
      const res = preset.height === 2160 ? '4K' : `${preset.height}P`;
      live.current = { track, info: `${res}${preset.fps} · ${codec === 'av1' ? 'AV1' : 'H.264'}` };
      track.addEventListener('ended', () => actions.stopLive(), { once: true });
      rerender();
    },
    stopLive: () => {
      const current = live.current;
      live.current = null;
      if (current && lp) void lp.unpublishTrack(current.track, true).finally(rerender);
      current?.track.stop();
    },
  };

  return {
    room: roomId, state, error, people, streams, chat, deafened, micError,
    micOn: !!lp?.isMicrophoneEnabled,
    cameraOn: !!lp?.isCameraEnabled,
    ...actions,
  };
}
