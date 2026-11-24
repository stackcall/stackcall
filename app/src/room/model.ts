import type { Codec, Preset } from '../lib/presets';
import type { RoomId } from '../lib/config';

/** Anything that can render into a media element (a LiveKit Track). */
export type Attachable = {
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element: HTMLMediaElement): HTMLMediaElement;
};

export type Person = {
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

export type ChatMessage = { id: string; who: string; at: Date; text: string; mine: boolean };

export type RoomModel = {
  room: RoomId;
  state: 'connecting' | 'connected' | 'reconnecting' | 'error';
  error?: string;
  people: Person[];
  streams: Stream[];
  chat: ChatMessage[];
  micOn: boolean;
  deafened: boolean;
  cameraOn: boolean;
  micError?: string;
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
  stopLive(): void;
};

/** Stable pastel per name, from the prototype palette. */
const COLORS = ['#c9bcff', '#b9e3d4', '#f2d3a8', '#c4d4f5', '#f5c4d6', '#d8e6a8'];
export function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export const initials = (name: string) => name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
