import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import { servidorFalso } from '../lib/falso';
import type { CaptureSource } from '../lib/sidecar';
import type { PresetCard } from '../lib/presets';
import { WATCH_ATTRIBUTE, WATCH_EXPIRY_MS, WATCH_GRACE_MS, WATCH_HEARTBEAT_MS, WATCH_TOPIC } from './screenAudience';
import { useLiveRoom, type Session } from './useLiveRoom';

type TestParticipant = ReturnType<typeof participant>;
type TestRoom = {
  remoteParticipants: Map<string, TestParticipant>;
  emit: (event: RoomEvent, ...args: unknown[]) => void;
};

const mock = vi.hoisted(() => ({
  room: null as TestRoom | null,
  invoke: vi.fn(async (..._args: unknown[]) => undefined),
  publishData: vi.fn(async (_data: Uint8Array, _options: { reliable: boolean; topic: string }) => undefined),
  setAttributes: vi.fn(async (_attributes: Record<string, string>) => undefined),
}));

vi.mock('livekit-client', async (load) => ({
  ...await load<typeof import('livekit-client')>(),
  Room: class implements TestRoom {
    state = 'connecting';
    options = {};
    remoteParticipants = new Map();
    handlers = new Map<RoomEvent, (...args: unknown[]) => void>();
    localParticipant = {
      identity: 'host', getTrackPublication: () => undefined,
      publishData: mock.publishData, setAttributes: mock.setAttributes, setMicrophoneEnabled: async () => {},
    };
    constructor() { mock.room = this; }
    on(event: RoomEvent, handler: (...args: unknown[]) => void) { this.handlers.set(event, handler); return this; }
    emit(event: RoomEvent, ...args: unknown[]) { this.handlers.get(event)?.(...args); }
    async connect() { this.state = 'connected'; }
    async disconnect() { this.state = 'disconnected'; }
    async startAudio() {}
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mock.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('../lib/leveza', () => ({ interfaceAtiva: () => true, useInterfaceAtiva: () => true }));

const session: Session = {
  servidor: { ...servidorFalso(), token: async () => ({ url: 'ws://localhost', token: 'voice', screen_token: 'screen' }) },
};
const source = { id: 'hmonitor:1' } as CaptureSource;
const preset = { height: 720, fps: 30, trial: { encoder: 'h264_qsv' }, mbps: { h264: 2 } } as PresetCard;

function participant(identity: string, upgraded: boolean, screen = false) {
  const pub = { source: Track.Source.ScreenShare, setSubscribed: vi.fn(), setEnabled: vi.fn() };
  return {
    identity, attributes: upgraded ? { [WATCH_ATTRIBUTE]: 'assistindo' } : {},
    getTrackPublication: (source: Track.Source) => screen && source === Track.Source.ScreenShare ? pub : undefined,
    trackPublications: new Map(screen ? [['screen', pub]] : []),
    audioTrackPublications: new Map(),
    setVolume: vi.fn(), audioLevel: 0,
  };
}

const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const pauseCalls = () => mock.invoke.mock.calls.filter(([name]) => name === 'mudar_pausa_transmissao')
  .map(([, args]) => (args as { paused: boolean }).paused);
const watchPackets = () => mock.publishData.mock.calls.filter(([, opts]) => opts.topic === WATCH_TOPIC)
  .map(([data, opts]) => ({ ...JSON.parse(new TextDecoder().decode(data)), reliable: opts.reliable }));

describe('LiveKit screen watching in the room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('signals presence changes after voice and screen events', async () => {
    const changed = vi.fn();
    const { unmount } = renderHook(() => useLiveRoom(session, 'room', changed));
    await tick(0);
    expect(changed).toHaveBeenCalledTimes(1);
    const room = mock.room!;
    const remote = participant('remote', true);
    const screen = { source: Track.Source.ScreenShare };
    act(() => {
      room.remoteParticipants.set(remote.identity, remote);
      room.emit(RoomEvent.ParticipantConnected, remote);
      room.emit(RoomEvent.TrackPublished, screen, remote);
      room.emit(RoomEvent.TrackUnpublished, screen, remote);
      room.remoteParticipants.delete(remote.identity);
      room.emit(RoomEvent.ParticipantDisconnected, remote);
    });
    expect(changed).toHaveBeenCalledTimes(5);
    unmount();
    await tick(0);
    expect(changed).toHaveBeenCalledTimes(6);
  });

  it('pauses with an idle capable participant, resumes on watch and protects an old app', async () => {
    const { result, unmount } = renderHook(() => useLiveRoom(session, 'room'));
    await tick(0);
    expect(mock.setAttributes).toHaveBeenCalledWith({ [WATCH_ATTRIBUTE]: 'assistindo' });
    const room = mock.room!;
    const viewer = participant('viewer', true);
    const add = (p: TestParticipant) => {
      room.remoteParticipants.set(p.identity, p);
      room.emit(RoomEvent.ParticipantConnected, p);
    };
    act(() => add(viewer));
    await act(() => result.current.goLiveNative!(source, preset, 'h264', false));
    await tick(WATCH_GRACE_MS - 1);
    expect(pauseCalls()).toEqual([]);
    await tick(1);
    expect(pauseCalls()).toEqual([true]);

    await act(async () => room.emit(RoomEvent.DataReceived,
      new TextEncoder().encode(JSON.stringify({ screen: 'host:tela', watching: true })),
      viewer, undefined, WATCH_TOPIC));
    expect(pauseCalls()).toEqual([true, false]);
    await tick(WATCH_EXPIRY_MS + WATCH_GRACE_MS);
    expect(pauseCalls()).toEqual([true, false, true]);

    await act(async () => add(participant('old-app', false)));
    expect(pauseCalls()).toEqual([true, false, true, false]);
    await tick(WATCH_GRACE_MS);
    expect(pauseCalls()).toHaveLength(4);
    unmount();
  });

  it('announces the screen identity, refreshes every 20 seconds and sends stop', async () => {
    const { result, unmount } = renderHook(() => useLiveRoom(session, 'room'));
    await tick(0);
    const room = mock.room!;
    const screen = participant('remote:tela', false, true);
    act(() => {
      room.remoteParticipants.set(screen.identity, screen);
      room.emit(RoomEvent.ParticipantConnected, screen);
    });
    act(() => result.current.watch('remote'));
    const watching = { screen: 'remote:tela', watching: true, reliable: true };
    expect(watchPackets()).toEqual([watching]);
    await tick(WATCH_HEARTBEAT_MS);
    expect(watchPackets()).toEqual([watching, watching]);
    act(() => result.current.unwatch('remote'));
    expect(watchPackets()).toEqual([watching, watching, { ...watching, watching: false }]);
    unmount();
  });
});
