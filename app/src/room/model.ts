import type { Codec, Preset, PresetCard } from '../lib/presets';
import type { CaptureSource } from '../lib/sidecar';
import type { Receptor, Rede } from './sala05';

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
  /** 0..1, at the last render. */
  level: number;
  /** 0..1, read live by the meter (requestAnimationFrame), outside React state. */
  nivel?: () => number;
  /** 0..2 */
  volume: number;
  camera?: Attachable;
  live: boolean;
  /** 0.5: network of that person (LiveKit connectionQuality + published numbers). */
  rede?: Rede;
  /** 0.5: this person's replay buffer records the room (attribute stackcall.replay=1). */
  replay?: boolean;
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
  /** false when retrying would only repeat the disconnect (removed, duplicate login, room deleted). */
  autoRetry?: boolean;
  people: Person[];
  streams: Stream[];
  chat: ChatMessage[];
  micOn: boolean;
  deafened: boolean;
  cameraOn: boolean;
  micError?: string;
  streamError?: string;
  videoPaused?: boolean;
  /** The game window being streamed is minimized: viewers see the last frame until it comes back. */
  gameMinimized?: boolean;
  /** Round trip to the media server in ms (ICE candidate pair), null until measured. */
  ping: number | null;
  stageStats: StreamStats | null;
  /** 0.5 "Quem recebe você" (remote people only). */
  receptores?: Receptor[];
  /** 0.5 bad internet mode: no incoming video, voice first. */
  redeRuim?: boolean;
  /** 0.5 quality asked for each watched screen. */
  qualidade?: Record<string, 'original' | 'leve'>;
  /** 0.5 grid: whose screen audio plays (null = all). */
  somTela?: string | null;
};

export type RoomActions = {
  toggleMic(): void;
  /** Opens or closes the mic (push to talk and global shortcuts). */
  setMic?(on: boolean): void;
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
  setRedeRuim?(on: boolean): void;
  setQualidade?(ownerId: string, q: 'original' | 'leve'): void;
  /** Grid: receive every screen in the room (true) or only the watched one (false). */
  assistirTodas?(on: boolean): void;
  setSomTela?(ownerId: string | null): void;
};
