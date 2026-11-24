import type { Codec, Preset, PresetCard } from '../lib/presets';
import type { CaptureSource } from '../lib/sidecar';

/** Anything that can render into a media element (a LiveKit Track). */
export type Attachable = {
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element: HTMLMediaElement): HTMLMediaElement;
};

export type Person = {
  /** LiveKit identity = user id on the porteiro. */
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  muted: boolean;
  /** 0..1 */
  level: number;
  /** 0..2 */
  volume: number;
  camera?: Attachable;
  live: boolean;
};

export type Stream = {
  owner: Person;
  /** Set when the stream is subscribed (or local). */
  track?: Attachable;
  watching: boolean;
  watchers: number;
  info: string;
};

/** Real numbers of the watched screen, from WebRTC stats. */
export type StreamStats = { height: number; fps: number; codec: string; mbps: number | null };

/** `hora` is formatted once when the message arrives, never per render. */
export type ChatMessage = { id: string; who: string; hora: string; text: string; mine: boolean };
export const horaDe = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export type RoomModel = {
  room: string;
  state: 'connecting' | 'connected' | 'reconnecting' | 'error';
  error?: string;
  people: Person[];
  streams: Stream[];
  chat: ChatMessage[];
  micOn: boolean;
  deafened: boolean;
  cameraOn: boolean;
  micError?: string;
  streamError?: string;
  /** Round trip to the media server in ms (ICE candidate pair), null until measured. */
  ping: number | null;
  stageStats: StreamStats | null;
};

export type RoomActions = {
  toggleMic(): void;
  toggleDeafen(): void;
  toggleCamera(): void;
  setVolume(id: string, volume: number): void;
  watch(id: string): void;
  unwatch(id: string): void;
  sendChat(text: string): void;
  goLive(track: MediaStreamTrack, preset: Preset, codec: Codec): Promise<void>;
  goLiveNative?(source: CaptureSource, preset: PresetCard, codec: Codec, audio: boolean): Promise<void>;
  clearStreamError?(): void;
  stopLive(): void;
};
