import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AudioPresets, Participant, RemoteParticipant, RemoteTrackPublication, Room, RoomEvent, Track, VideoQuality,
  type DisconnectReason,
} from 'livekit-client';
import { ATRIBUTO_REPLAY } from '../lib/nucleo';
import { lerPreferencias, salvarPreferencias } from '../lib/preferencias';
import { tocarSom } from '../lib/sons';
import { ATRIBUTO_OUVE, ATRIBUTO_REDE, ouveLista, quemRecebe, redeDe } from './sala05';
import { interfaceAtiva, useInterfaceAtiva } from '../lib/leveza';
import type { Servidor } from '../lib/servidor';
import { resolutionOf, type Codec, type Preset } from '../lib/presets';
import { setTransmissionPaused, stopTransmission, type StreamEvent } from '../lib/sidecar';
import { AVISO_FORTE, aoMudarVoz, aplicarForte, capturaDe, lerVoz, salvarVoz } from '../lib/voz';
import { horaDe, type ChatMessage, type Person, type RoomActions, type RoomModel, type Stream, type StreamStats } from './model';
import {
  ScreenAudience, supportsWatching, WATCH_ATTRIBUTE, WATCH_GRACE_MS, WATCH_HEARTBEAT_MS, WATCH_RESOURCE, WATCH_TOPIC,
} from './screenAudience';

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
type NativeStream = { id: string; info: string; ready: boolean; pauseRequested: boolean; paused: boolean };
/** Hidden this long (game on top, tray, minimized): stop receiving the watched screen. */
export const VIDEO_OCULTO_MS = 10_000;
const MIC_ERROR = 'Microfone indisponível. Confira a permissão do Windows e o dispositivo.';
/** Disconnects that a retry would only repeat: same account elsewhere, removed, room gone. */
const FIM: Partial<Record<number, string>> = {
  2: 'Você entrou nesta sala por outro aparelho.',
  4: 'Você foi tirado da sala.',
  5: 'A sala foi apagada.',
};

export function useLiveRoom(session: Session, roomId: string, onPresenceChange?: () => void): RoomModel & RoomActions {
  const roomRef = useRef<Room | null>(null);
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
  const legacyWatchers = useRef(new Map<string, string>());
  const audience = useRef(new ScreenAudience());
  const watchingRef = useRef<string | null>(null);
  const announcedScreen = useRef<string | null>(null);
  const watchedVideoEnabled = useRef(true);
  const checkPauseRef = useRef<(() => void) | null>(null);
  const live = useRef<{ track: MediaStreamTrack; info: string } | null>(null);
  const native = useRef<NativeStream | null>(null);
  const redeRuimRef = useRef(lerPreferencias().redeRuim);
  const qualidadeRef = useRef<Record<string, 'original' | 'leve'>>({});
  const somTelaRef = useRef<string | null>(null);
  const publicarOuveRef = useRef<() => void>(() => undefined);
  /** Video may come in: window visible and bad internet mode off. */
  const videoPermitido = () => watchedVideoEnabled.current && !redeRuimRef.current;

  const applyVolume = (p: RemoteParticipant) => {
    const v = deafRef.current ? 0 : volumes.current.get(screenOwner(p.identity)) ?? 1;
    p.setVolume(v, Track.Source.Microphone);
    // Grid: only the marked screen plays its sound.
    p.setVolume(somTelaRef.current && somTelaRef.current !== screenOwner(p.identity) ? 0 : v, Track.Source.ScreenShareAudio);
  };

  const sendWatch = (room: Room, target: string | null, to?: string[]) =>
    room.localParticipant
      .publishData(encoder.encode(JSON.stringify({ target })), { reliable: true, topic: 'watch', destinationIdentities: to })
      .catch(() => undefined);

  const announceWatch = (room: Room, repeat = false) => {
    if (roomRef.current !== room || room.state !== 'connected') return;
    const owner = videoPermitido() ? watchingRef.current : null;
    const screen = owner
      ? [owner + SCREEN_SUFFIX, owner].find((id) =>
        room.remoteParticipants.get(id)?.getTrackPublication(Track.Source.ScreenShare)) ?? null
      : null;
    const previous = announcedScreen.current;
    const send = (screen: string, watching: boolean) => {
      void room.localParticipant.publishData(encoder.encode(JSON.stringify({ screen, watching })),
        { reliable: true, topic: WATCH_TOPIC }).catch(() => undefined);
    };
    if (previous && previous !== screen) send(previous, false);
    if (screen && (repeat || screen !== previous)) send(screen, true);
    announcedScreen.current = screen;
    if (previous !== screen) rerender();
  };

  useEffect(() => {
    if (!isTauri()) return;
    const unsubscribe = listen<StreamEvent>('stackcall-stream', ({ payload }) => {
      const current = native.current;
      if (current?.id !== payload.id) return;
      if (payload.event === 'error' || payload.event === 'stopped') {
        native.current = null;
        onPresenceChange?.();
        if (payload.event === 'error') setStreamError(payload.reason ?? 'O núcleo de transmissão foi encerrado.');
        rerender();
      } else if (payload.event === 'pause_changed' && typeof payload.paused === 'boolean') {
        current.paused = payload.paused;
        rerender();
      }
    });
    return () => { void unsubscribe.then((unlisten) => unlisten()); };
  }, [rerender, onPresenceChange]);

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
    let conectadoEm = Infinity;
    const audioElements = new Set<HTMLMediaElement>();
    setState('connecting');
    setError(undefined);
    setAutoRetry(true);
    setStreamError(undefined);
    setChat([]);
    legacyWatchers.current.clear();
    const viewers = new ScreenAudience();
    audience.current = viewers;
    watchingRef.current = null;
    announcedScreen.current = null;
    watchedVideoEnabled.current = interfaceAtiva();

    let emptySince: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryControl: ReturnType<typeof setTimeout> | undefined;
    let pendingControl = Promise.resolve();
    // Serialize control so a pause already in transit cannot arrive after its resume.
    const requestPause = (stream: NativeStream, paused: boolean) => {
      if (stream.pauseRequested === paused) return;
      stream.pauseRequested = paused;
      pendingControl = pendingControl.then(async () => {
        if (closed || native.current !== stream || stream.pauseRequested !== paused) return;
        await setTransmissionPaused(stream.id, paused);
      }).catch(() => {
        if (!closed && native.current === stream && stream.pauseRequested === paused) {
          stream.pauseRequested = !paused;
          clearTimeout(retryControl);
          retryControl = setTimeout(checkPause, 1000);
        }
      });
    };
    const checkPause = () => {
      clearTimeout(timer);
      if (closed) return;
      const stream = native.current;
      const now = performance.now();
      if (viewers.expire(now)) rerender();
      let next = viewers.nextExpiry();
      const canPause = stream?.ready && room.state === 'connected' &&
        viewers.canPause(room.localParticipant.identity + SCREEN_SUFFIX, [...room.remoteParticipants.values()].filter((p) =>
          !screenParticipant(p.identity)));
      if (!canPause || !stream) {
        emptySince = null;
        if (stream?.ready) requestPause(stream, false);
      } else {
        emptySince ??= now;
        const pauseAt = emptySince + WATCH_GRACE_MS;
        if (pauseAt > now) next = Math.min(next, pauseAt);
        else requestPause(stream, true);
      }
      if (Number.isFinite(next)) timer = setTimeout(checkPause, next - now);
    };
    checkPauseRef.current = checkPause;
    const heartbeat = setInterval(() => announceWatch(room, true), WATCH_HEARTBEAT_MS);
    const advertise = () => {
      void room.localParticipant.setAttributes({ [WATCH_ATTRIBUTE]: WATCH_RESOURCE }).catch(() => undefined);
    };

    // Voice and cameras subscribe at once; a screen only after "Assistir", to save bandwidth.
    const subscribeDefault = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      const owner = screenOwner(p.identity);
      const ownScreen = screenParticipant(p.identity) && owner === room.localParticipant.identity;
      if (ownScreen) {
        if (pub.source === Track.Source.ScreenShare) pub.setSubscribed(true);
      } else if (!SCREEN.includes(pub.source) || watchingRef.current === owner) {
        pub.setSubscribed(true);
        if (pub.source === Track.Source.ScreenShare && !videoPermitido()) pub.setEnabled(false);
      }
    };

    const clearWatch = (owner: string) => {
      if (closed || watchingRef.current !== owner) return;
      watchingRef.current = null;
      void sendWatch(room, null);
      announceWatch(room);
    };

    room
      .on(RoomEvent.TrackPublished, (pub, p) => {
        subscribeDefault(pub, p);
        if (pub.source === Track.Source.ScreenShare) {
          announceWatch(room);
          if (!closed) onPresenceChange?.();
        }
        rerender();
      })
      .on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (pub.source === Track.Source.ScreenShare) {
          clearWatch(screenOwner(p.identity));
          if (!closed) onPresenceChange?.();
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
        if (closed) return;
        onPresenceChange?.();
        if (!screenParticipant(p.identity)) {
          somEntrada('entrou');
          publicarOuve();
        }
        applyVolume(p);
        const mine = watchingRef.current;
        if (mine && !screenParticipant(p.identity)) void sendWatch(room, mine, [p.identity]);
        checkPause();
        rerender();
      })
      .on(RoomEvent.ParticipantActive, (p) => {
        if (!screenParticipant(p.identity)) announceWatch(room, true);
      })
      .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
        if (closed) return;
        if (supportsWatching(p.attributes) && legacyWatchers.current.delete(p.identity)) rerender();
        else if (ATRIBUTO_OUVE in changed || ATRIBUTO_REPLAY in changed || ATRIBUTO_REDE in changed) rerender();
        checkPause();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        if (closed) return;
        onPresenceChange?.();
        if (!screenParticipant(p.identity)) {
          somEntrada('saiu');
          publicarOuve();
        }
        legacyWatchers.current.delete(p.identity);
        viewers.leave(p.identity);
        if (screenParticipant(p.identity) || !room.remoteParticipants.has(p.identity + SCREEN_SUFFIX)) {
          clearWatch(screenOwner(p.identity));
        }
        checkPause();
        rerender();
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (closed || !participant || screenParticipant(participant.identity) ||
            !room.remoteParticipants.has(participant.identity)) return;
        let msg: { text?: unknown; target?: unknown; screen?: unknown; watching?: unknown } | null;
        try {
          msg = JSON.parse(decoder.decode(payload));
        } catch {
          return;
        }
        if (!msg) return;
        if (topic === 'chat' && typeof msg.text === 'string' && msg.text.trim()) {
          const text = msg.text.slice(0, 2000);
          const who = participant.name || participant.identity;
          setChat((c) => [...c.slice(-MAX_CHAT + 1), { id: crypto.randomUUID(), who, hora: horaDe(new Date()), text, mine: false }]);
        } else if (topic === WATCH_TOPIC && typeof msg.screen === 'string' && typeof msg.watching === 'boolean') {
          if (viewers.announce(participant.identity, msg.screen, msg.watching, performance.now())) rerender();
          checkPause();
        } else if (topic === 'watch' && !supportsWatching(participant.attributes)) {
          if (typeof msg.target === 'string') legacyWatchers.current.set(participant.identity, msg.target);
          else legacyWatchers.current.delete(participant.identity);
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
      // Rare (quality steps), not continuous: fine to re-render.
      .on(RoomEvent.ConnectionQualityChanged, rerender)
      .on(RoomEvent.TrackSubscribed, () => publicarOuve())
      .on(RoomEvent.TrackMuted, rerender)
      .on(RoomEvent.TrackUnmuted, rerender)
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (!closed && pub.source === Track.Source.ScreenShare) onPresenceChange?.();
        rerender();
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (!closed && pub.source === Track.Source.ScreenShare) onPresenceChange?.();
        rerender();
      })
      .on(RoomEvent.ConnectionStateChanged, checkPause)
      .on(RoomEvent.Reconnecting, () => setState('reconnecting'))
      .on(RoomEvent.Reconnected, () => {
        if (closed) return;
        onPresenceChange?.();
        advertise();
        announceWatch(room, true);
        setState('connected');
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (closed) return;
        onPresenceChange?.();
        if (native.current) void stopTransmission(native.current.id).catch(() => undefined);
        const fim = reason !== undefined ? FIM[reason] : undefined;
        setAutoRetry(!fim);
        setState('error');
        setError(fim ?? 'A conexão com a sala caiu.');
      });

    (async () => {
      try {
        const { url, token } = await session.servidor.token(roomId);
        if (closed) return;
        await room.connect(url, token, { autoSubscribe: false });
        if (closed) return void room.disconnect();
        onPresenceChange?.();
        advertise();
        conectadoEm = performance.now();
        publicarOuve();
        room.remoteParticipants.forEach((p) => {
          applyVolume(p);
          p.trackPublications.forEach((pub) => subscribeDefault(pub, p));
        });
        setState('connected');
        await room.startAudio().catch(() => undefined);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          // Push to talk: the track is published (permission asked, fast to open) but starts closed.
          if (lerVoz().modo === 'ptt') await room.localParticipant.setMicrophoneEnabled(false);
          setMicError(undefined);
          if (lerVoz().forte) forte(true);
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

    // Join and leave sound (Settings > Sons e avisos); not for the people already there when I arrive.
    function somEntrada(som: 'entrou' | 'saiu') {
      const p = lerPreferencias();
      if (p.somEntradaSaida && !deafRef.current && performance.now() - conectadoEm > 1500) tocarSom(som, p.somEntradaSaidaVolume / 100);
    }
    // "Quem me ouve": publish whose microphone I receive, grouping changes that come close together.
    let ouveTimer: ReturnType<typeof setTimeout> | undefined;
    let ouvePublicado = '';
    function publicarOuve() {
      clearTimeout(ouveTimer);
      ouveTimer = setTimeout(() => {
        if (closed || room.state !== 'connected') return;
        const vozes = [...room.remoteParticipants.values()].filter((p) => !screenParticipant(p.identity)).map((p) => {
          const mic = p.getTrackPublication(Track.Source.Microphone);
          // No microphone published yet: it will be received as soon as it is (voice subscribes at once).
          return { id: p.identity, assinado: !mic || mic.isSubscribed };
        });
        const valor = JSON.stringify(ouveLista(vozes, deafRef.current));
        if (valor === ouvePublicado) return;
        ouvePublicado = valor;
        void room.localParticipant.setAttributes({ [ATRIBUTO_OUVE]: valor }).catch(() => undefined);
      }, 400);
    }
    publicarOuveRef.current = publicarOuve;

    // My round trip and loss for the others' channels; republished only on a real change, at most every 10 s.
    let redePublicada = { ms: -1, perda: -1, em: -Infinity };
    function publicarRede(ms: number | null, perda: number | null) {
      if (ms === null) return;
      const p = perda ?? 0;
      const mudou = Math.abs(ms - redePublicada.ms) > 25 || Math.abs(p - redePublicada.perda) > 0.01;
      if (!mudou || performance.now() - redePublicada.em < 10_000) return;
      redePublicada = { ms, perda: p, em: performance.now() };
      void room.localParticipant.setAttributes({ [ATRIBUTO_REDE]: JSON.stringify({ ms, perda: Math.round(p * 1000) / 1000 }) }).catch(() => undefined);
    }

    // Strong suppression (RNNoise): on failure the mic is back to normal; say so and turn the option off.
    function forte(ligar: boolean) {
      const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!mic) return;
      void aplicarForte(mic, ligar).then((r) => {
        if (r !== 'falhou' || closed) return;
        setMicError(AVISO_FORTE);
        salvarVoz({ forte: false });
      });
    }

    // Settings > Voz: devices and processing change without leaving the room.
    const pararVoz = aoMudarVoz((v, antes) => {
      room.options.audioCaptureDefaults = capturaDe(v);
      if (v.saida !== antes.saida) void room.switchActiveDevice('audiooutput', v.saida || 'default').catch(() => undefined);
      const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!mic) return;
      if (v.modo !== antes.modo) void room.localParticipant.setMicrophoneEnabled(v.modo === 'voz').catch(() => undefined).finally(rerender);
      const trocouForte = v.forte !== antes.forte;
      if (trocouForte || v.entrada !== antes.entrada || v.eco !== antes.eco || v.ganho !== antes.ganho || v.ruido !== antes.ruido) {
        // The strong toggle also flips the browser's suppression (capturaDe), so the track restarts first.
        void mic.restartTrack(capturaDe(v))
          .then(() => { if (!trocouForte) setMicError(undefined); }, () => setMicError(MIC_ERROR))
          .finally(() => { if (trocouForte) forte(v.forte); });
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
      const rtt = audio ? rttOf(audio) : null;
      setPing(rtt);
      publicarRede(rtt, audio ? perdaDe(audio) : null);
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
      clearTimeout(ouveTimer);
      pararVoz();
      clearInterval(stats);
      clearInterval(heartbeat);
      clearTimeout(timer);
      clearTimeout(retryControl);
      checkPauseRef.current = null;
      live.current?.track.stop();
      live.current = null;
      const publishing = native.current;
      native.current = null;
      if (publishing) void stopTransmission(publishing.id).then(onPresenceChange, () => undefined);
      void room.disconnect().then(onPresenceChange, () => onPresenceChange?.());
      audioElements.forEach((el) => el.remove());
      roomRef.current = null;
    };
  }, [session, roomId, rerender, onPresenceChange]);

  // Nobody sees the screen for VIDEO_OCULTO_MS: pause the watched video (no download, no decode).
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const telas = () => [...room.remoteParticipants.values()].flatMap((p) =>
      [...p.trackPublications.values()].filter((pub) => pub.source === Track.Source.ScreenShare && pub.isSubscribed));
    if (ativa) {
      watchedVideoEnabled.current = true;
      telas().forEach((pub) => pub.setEnabled(videoPermitido()));
      announceWatch(room);
      return;
    }
    const t = setTimeout(() => {
      watchedVideoEnabled.current = false;
      telas().forEach((pub) => pub.setEnabled(false));
      announceWatch(room);
    }, VIDEO_OCULTO_MS);
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
      rede: redeDe(String(p.connectionQuality), p.attributes),
      replay: p.attributes?.[ATRIBUTO_REPLAY] === '1',
    };
  });
  // Who watches my screen, for "Quem recebe você".
  const minhaTela = lp ? screenByOwner.get(lp.identity) : undefined;
  const meVeem = new Set<string>(room && lp && minhaTela ? [...room.remoteParticipants.keys()].filter((id) =>
    audience.current.watching(id, minhaTela.identity) || legacyWatchers.current.get(id) === lp.identity) : []);
  const receptores = room && lp ? quemRecebe([...room.remoteParticipants.values()].filter((p) => !screenParticipant(p.identity)).map((p) => ({
    id: p.identity, nome: p.name || p.identity, attributes: p.attributes, conectado: true,
  })), lp.identity, meVeem) : [];

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
      watchers: audience.current.count(p.identity) + Number(announcedScreen.current === p.identity)
        + [...legacyWatchers.current].filter(([viewer, target]) => target === owner.id && !audience.current.has(viewer)).length,
      info: (owner.isLocal ? native.current?.info ?? live.current?.info : undefined) ?? (dims ? `${dims.height}P` : ''),
    };
  });

  const setScreenSubscribed = (id: string, on: boolean) => {
    for (const identity of [id, id + SCREEN_SUFFIX]) {
      room?.remoteParticipants.get(identity)?.trackPublications.forEach((pub) => {
        if (SCREEN.includes(pub.source)) {
          pub.setSubscribed(on);
          if (on && pub.source === Track.Source.ScreenShare) {
            pub.setEnabled(videoPermitido());
            if (qualidadeRef.current[id] === 'leve') pub.setVideoQuality(VideoQuality.LOW);
          }
        }
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
    setMic: (on) => {
      const p = roomRef.current?.localParticipant;
      if (!p || p.isMicrophoneEnabled === on) return;
      p.setMicrophoneEnabled(on)
        .then(() => setMicError(undefined), () => setMicError(MIC_ERROR))
        .finally(rerender);
    },
    toggleDeafen: () => {
      if (!room || !lp) return;
      const next = !deafRef.current;
      deafRef.current = next;
      setDeafened(next);
      room.remoteParticipants.forEach(applyVolume);
      publicarOuveRef.current();
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
      setScreenSubscribed(id, true);
      void sendWatch(room, id);
      announceWatch(room);
      rerender();
    },
    unwatch: (id) => {
      if (!room) return;
      setScreenSubscribed(id, false);
      if (watchingRef.current !== id) return;
      watchingRef.current = null;
      void sendWatch(room, null);
      announceWatch(room);
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
      if (!room || !lp || !preset.trial) throw new Error('Sem conexão com a sala ou preset indisponível.');
      // The screen token lasts 1 h: ask a new one at every go live (bugs.md 2.5).
      const fresh = await session.servidor.token(roomId);
      if (roomRef.current !== room) throw new Error('A sala mudou. Escolha a fonte novamente.');
      const access = { url: fresh.url, token: fresh.screen_token };
      const id = crypto.randomUUID();
      const stream: NativeStream = { id, info: streamInfo(preset, codec), ready: false, pauseRequested: false, paused: false };
      native.current = stream;
      checkPauseRef.current?.();
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
        stream.ready = true;
        onPresenceChange?.();
        checkPauseRef.current?.();
        rerender();
      } catch (error) {
        if (native.current?.id === id) native.current = null;
        throw error;
      }
    },
    clearStreamError: () => setStreamError(undefined),
    setRedeRuim: (on) => {
      redeRuimRef.current = on;
      salvarPreferencias({ redeRuim: on });
      room?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.isSubscribed) pub.setEnabled(videoPermitido());
      }));
      if (room) announceWatch(room);
      rerender();
    },
    setQualidade: (ownerId, q) => {
      qualidadeRef.current = { ...qualidadeRef.current, [ownerId]: q };
      // "Leve" asks the SFU for the low simulcast layer; it only differs when the sender publishes layers.
      for (const identity of [ownerId, ownerId + SCREEN_SUFFIX]) {
        room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare)
          ?.setVideoQuality(q === 'leve' ? VideoQuality.LOW : VideoQuality.HIGH);
      }
      rerender();
    },
    assistirTodas: (on) => {
      for (const s of streams) if (!s.owner.isLocal && s.owner.id !== watchingRef.current) setScreenSubscribed(s.owner.id, on);
      rerender();
    },
    setSomTela: (ownerId) => {
      somTelaRef.current = ownerId;
      room?.remoteParticipants.forEach(applyVolume);
      rerender();
    },
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
    videoPaused: native.current?.paused,
    receptores, redeRuim: redeRuimRef.current, qualidade: qualidadeRef.current, somTela: somTelaRef.current,
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

/** Loss (0..1) the SFU reports for my outgoing audio (remote-inbound-rtp fractionLost). */
function perdaDe(report: RTCStatsReport) {
  let perda: number | null = null;
  report.forEach((s) => {
    if (s.type === 'remote-inbound-rtp' && s.kind === 'audio' && typeof s.fractionLost === 'number') perda = s.fractionLost;
  });
  return perda;
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
