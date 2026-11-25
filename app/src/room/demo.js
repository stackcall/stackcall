import { useState } from 'react';
import { lerPreferencias, salvarPreferencias } from '../lib/preferencias';
import { horaDe } from './model';
const person = (id, name, p) => ({
    id, name, isLocal: false, speaking: false, muted: false, level: 0, volume: 1, live: false,
    rede: { qualidade: 'boa', ms: 38, perda: 0 }, ...p,
});
/**
 * Fake room shaped like the approved 0.5 prototype (docs/design/v05), for the fake server (dev and
 * tests). `?grade=1` puts Duda and Léo on the air too, to review the screen grid.
 */
export function useDemoRoom(room, me) {
    const grade = new URLSearchParams(location.search).has('grade');
    const [micOn, setMicOn] = useState(true);
    const [deafened, setDeafened] = useState(false);
    const [watching, setWatching] = useState(() => new Set(grade ? ['duda'] : ['rafa']));
    const [todas, setTodas] = useState(false);
    const [redeRuim, setRedeRuimEstado] = useState(() => lerPreferencias().redeRuim);
    const [qualidade, setQualidadeEstado] = useState(grade ? { leo: 'leve' } : {});
    const [somTela, setSomTelaEstado] = useState(null);
    const [volumes, setVolumes] = useState({ rafa: 0.8, duda: 0.72, leo: 0.64, nanda: 0.9 });
    const [chat, setChat] = useState([
        { id: '1', who: 'Léo', hora: '21:38', text: 'alguém viu meu headset no sofá?', mine: false },
        { id: '2', who: 'Rafa', hora: '21:40', text: 'liguei 1080p60, tá liso aí?', mine: false },
        { id: '3', who: 'Nanda', hora: '21:40', text: 'lisinho. dá pra ler o placar', mine: false },
        { id: '4', who: 'Duda', hora: '21:41', text: 'bora mais uma depois dessa?', mine: false },
        { id: '5', who: me.name, hora: '21:41', text: 'bora, entro de awp', mine: true },
    ]);
    const empty = room !== 'cs';
    const people = [
        person(me.id, me.name, { isLocal: true, muted: !micOn, level: micOn ? 0.2 : 0, rede: { qualidade: 'boa', ms: 142, perda: 0 } }),
        ...(empty ? [] : [
            person('rafa', 'Rafa', { live: !grade, level: 0.6, speaking: true, replay: !grade }),
            person('duda', 'Duda', { speaking: true, level: 0.85, replay: true, live: grade }),
            person('leo', 'Léo', { live: grade, rede: { qualidade: 'ruim', ms: 210, perda: 0.03 } }),
            person('nanda', 'Nanda', { muted: true, rede: { qualidade: 'media', ms: 64, perda: 0 } }),
        ]),
    ].map((p) => ({ ...p, volume: volumes[p.id] ?? 1 }));
    const live = people.filter((p) => p.live && !p.isLocal);
    const streams = live.map((p) => {
        const ve = watching.has(p.id) || todas;
        return { owner: p, watching: ve, watchers: ve ? 3 : 2, info: '1080p60 · AV1' };
    });
    return {
        room, state: 'connected', people, chat, micOn, deafened, cameraOn: false, ping: 142,
        stageStats: empty || !streams.some((s) => s.watching) ? null : { height: 1080, fps: 60, codec: 'AV1', mbps: 4.2 },
        streams,
        receptores: empty ? [] : [
            { id: 'rafa', nome: 'Rafa', voz: true, tela: false },
            { id: 'duda', nome: 'Duda', voz: true, tela: false },
            { id: 'leo', nome: 'Léo', voz: true, tela: false },
            { id: 'nanda', nome: 'Nanda', voz: true, tela: false },
        ],
        redeRuim, qualidade, somTela,
        toggleMic: () => setMicOn((v) => !v),
        setMic: (on) => setMicOn(on),
        toggleDeafen: () => setDeafened((v) => !v),
        toggleCamera: () => undefined,
        setVolume: (id, v) => setVolumes((s) => ({ ...s, [id]: v })),
        watch: (id) => setWatching(new Set([id])),
        unwatch: (id) => setWatching((s) => new Set([...s].filter((x) => x !== id))),
        sendChat: (text) => setChat((c) => [...c, { id: String(c.length + 1), who: me.name, hora: horaDe(new Date()), text, mine: true }]),
        goLive: async () => undefined,
        stopLive: () => undefined,
        setRedeRuim: (on) => {
            salvarPreferencias({ redeRuim: on });
            setRedeRuimEstado(on);
        },
        setQualidade: (id, q) => setQualidadeEstado((s) => ({ ...s, [id]: q })),
        assistirTodas: (on) => setTodas(on),
        setSomTela: (id) => setSomTelaEstado(id),
    };
}
