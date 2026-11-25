import { useState } from 'react';
import { horaDe, type ChatMessage, type Person, type RoomActions, type RoomModel } from './model';

const person = (id: string, name: string, p: Partial<Person>): Person => ({
  id, name, isLocal: false, speaking: false, muted: false, level: 0, volume: 1, live: false, ...p,
});

/** Fake room shaped like the approved "Console" prototype, for the fake server (dev and tests). */
export function useDemoRoom(room: string, me: { id: string; name: string }): RoomModel & RoomActions {
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [watching, setWatching] = useState(true);
  const [volumes, setVolumes] = useState<Record<string, number>>({ rafa: 0.8, duda: 0.72, leo: 0.64, nanda: 0.9 });
  const [chat, setChat] = useState<ChatMessage[]>([
    { id: '1', who: 'Léo', hora: '21:38', text: 'alguém viu meu headset no sofá?', mine: false },
    { id: '2', who: 'Rafa', hora: '21:40', text: 'liguei 1080p60, tá liso aí?', mine: false },
    { id: '3', who: 'Nanda', hora: '21:40', text: 'lisinho. dá pra ler o placar', mine: false },
    { id: '4', who: 'Duda', hora: '21:41', text: 'bora mais uma depois dessa?', mine: false },
    { id: '5', who: me.name, hora: '21:41', text: 'bora, entro de awp', mine: true },
  ]);
  const empty = room !== 'cs';
  const people = [
    person(me.id, me.name, { isLocal: true, muted: !micOn, level: micOn ? 0.2 : 0 }),
    ...(empty ? [] : [
      person('rafa', 'Rafa', { live: true, level: 0.6, speaking: true }),
      person('duda', 'Duda', { speaking: true, level: 0.85 }),
      person('leo', 'Léo', {}),
      person('nanda', 'Nanda', { muted: true }),
    ]),
  ].map((p) => ({ ...p, volume: volumes[p.id] ?? 1 }));
  return {
    room, state: 'connected', people, chat, micOn, deafened, cameraOn: false, ping: 142,
    stageStats: empty || !watching ? null : { height: 1080, fps: 60, codec: 'AV1', mbps: 4.2 },
    streams: empty ? [] : [{ owner: people[1], watching, watchers: watching ? 3 : 2, info: '1080p60 · AV1' }],
    toggleMic: () => setMicOn((v) => !v),
    setMic: (on) => setMicOn(on),
    toggleDeafen: () => setDeafened((v) => !v),
    toggleCamera: () => undefined,
    setVolume: (id, v) => setVolumes((s) => ({ ...s, [id]: v })),
    watch: () => setWatching(true),
    unwatch: () => setWatching(false),
    sendChat: (text) => setChat((c) => [...c, { id: String(c.length + 1), who: me.name, hora: horaDe(new Date()), text, mine: true }]),
    goLive: async () => undefined,
    stopLive: () => undefined,
  };
}
