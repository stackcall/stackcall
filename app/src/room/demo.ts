import { useState } from 'react';
import type { RoomId } from '../lib/config';
import type { ChatMessage, Person, RoomActions, RoomModel } from './model';

const person = (id: string, p: Partial<Person>): Person => ({
  id, name: id, isLocal: false, speaking: false, muted: false, level: 0, volume: 1, live: false, ...p,
});
const at = (h: number, m: number) => new Date(2026, 10, 24, h, m);

/** Fake room shaped like docs/design/prototipo/Controle.html, for `?demo=1`. */
export function useDemoRoom(room: RoomId, me: string): RoomModel & RoomActions {
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [watching, setWatching] = useState(true);
  const [volumes, setVolumes] = useState<Record<string, number>>({ Duda: 1.2, Nanda: 0.8 });
  const [chat, setChat] = useState<ChatMessage[]>([
    { id: '1', who: 'Leo', at: at(21, 40), text: 'bora mais uma?', mine: false },
    { id: '2', who: 'Duda', at: at(21, 41), text: 'rafa abre a tela aí pra gente ver o clutch', mine: false },
    { id: '3', who: 'Rafa', at: at(21, 41), text: 'abri, tá em 1080p60', mine: false },
    { id: '4', who: 'Nanda', at: at(21, 43), text: 'tô sem mic, só ouvindo', mine: false },
    { id: '5', who: 'Leo', at: at(21, 44), text: 'que round foi esse', mine: false },
  ]);
  const people = [
    person(me, { isLocal: true, muted: !micOn, level: micOn ? 0.2 : 0 }),
    person('Rafa', { live: true, level: 0.6, speaking: true }),
    person('Duda', { speaking: true, level: 0.85 }),
    person('Leo', {}),
    person('Nanda', { muted: true }),
  ].map((p) => ({ ...p, volume: volumes[p.id] ?? 1 }));
  return {
    room, state: 'connected', people, chat, micOn, deafened, cameraOn: false,
    streams: [{ owner: people[1], watching, watchers: watching ? 3 : 2, info: '1080P60 · AV1' }],
    toggleMic: () => setMicOn((v) => !v),
    toggleDeafen: () => setDeafened((v) => !v),
    toggleCamera: () => undefined,
    setVolume: (id, v) => setVolumes((s) => ({ ...s, [id]: v })),
    watch: () => setWatching(true),
    unwatch: () => setWatching(false),
    sendChat: (text) => setChat((c) => [...c, { id: String(c.length + 1), who: me, at: new Date(), text, mine: true }]),
    goLive: async () => undefined,
    stopLive: () => undefined,
  };
}
