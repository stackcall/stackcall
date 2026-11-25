import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { FaixaCutucada } from '../components/FaixaCutucada';
import { Topo } from '../components/Topo';
import { esperaCutucar, marcarCutucada, somSilenciado } from '../lib/cutucadas';
import { abrir } from '../lib/paleta';
import { useDemoRoom } from '../room/demo';
import { useLiveRoom } from '../room/useLiveRoom';
import { useReconexao } from '../room/reconexao';
import { RoomView } from './sala/Sala';
/** Top bar (shared with the lobby), the poke strip when there is one, then the live room. */
export function RoomScreen(props) {
    const ativa = props.salas.find((s) => s.id === props.sala);
    const { cutucada, onFecharCutucada } = props;
    const deVolta = async (para) => {
        if (esperaCutucar(para) > 0)
            return onFecharCutucada?.();
        await props.servidor.cutucar(para, '').then(() => {
            marcarCutucada(para);
            onFecharCutucada?.();
        }, () => undefined);
    };
    return (_jsxs("div", { className: `grid h-full gap-4 overflow-hidden px-5 pt-4 pb-5 ${cutucada ? 'grid-rows-[auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'}`, children: [_jsx(Topo, { nomeServidor: props.nomeServidor, salas: props.salas, sala: props.sala, pessoas: props.pessoas, eu: props.eu, onSala: props.onSala, onConfig: props.onConfig, onPerfil: props.onPerfil, onBusca: () => abrir('paleta'), onClipes: () => abrir('clipes') }), cutucada && onFecharCutucada && (_jsx(FaixaCutucada, { cutucada: cutucada, silenciado: somSilenciado(), onFechar: onFecharCutucada, onEntrar: cutucada.salaId && cutucada.salaId !== props.sala ? () => { props.onSala(cutucada.salaId); onFecharCutucada(); } : undefined, onCutucarDeVolta: cutucada.deId ? () => void deVolta(cutucada.deId) : undefined })), ativa && (props.demo ? _jsx(DemoRoom, { ...props, sala: ativa }, ativa.id) : _jsx(LiveRoom, { ...props, sala: ativa }, ativa.id))] }));
}
function LiveRoom(props) {
    const [tentativa, setTentativa] = useState(0);
    const session = useMemo(() => ({ servidor: props.servidor }), [props.servidor, tentativa]);
    const model = useLiveRoom(session, props.sala.id, props.onPresenceChange);
    const rec = useReconexao(model.state, model.autoRetry !== false, () => setTentativa((n) => n + 1));
    return _jsx(RoomView, { ...props, model: model, reconexao: rec, onRetry: rec.reconectar });
}
function DemoRoom(props) {
    const model = useDemoRoom(props.sala.id, { id: props.eu.id, name: props.eu.nome });
    return _jsx(RoomView, { ...props, model: model, reconexao: { falhas: 0, esgotou: true }, onRetry: () => undefined });
}
