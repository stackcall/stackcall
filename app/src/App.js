import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { demoScreen, store } from './lib/config';
import { modoFalso, servidorFalso } from './lib/falso';
import { ApiError, aoPerderSessao, servidorReal } from './lib/servidor';
import { escolherServidor, esquecerServidor, ouvirDeepLinks, salvarServidor, servidorAtual } from './lib/servidores';
import { useUpdater } from './lib/updater';
import { useJanelaVisivel } from './lib/leveza';
import { agendarPresenca } from './lib/presenca';
import { RoomScreen } from './screens/Room';
import { Entrada } from './screens/Entrada';
import { Settings } from './screens/Settings';
import { Novidades } from './screens/Novidades';
import { Perfil } from './screens/Perfil';
import { CartaoPerfil } from './components/CartaoPerfil';
import { UpdateBanner } from './components/UpdateBanner';
import { Faixa } from './components/Faixa';
import { Camada05 } from './components/Camada05';
import { Saguao } from './screens/Saguao';
import { aoReceberCutucada } from './lib/cutucar';
import { iniciarDeteccaoJogo } from './lib/jogo';
export function App() {
    const [falso] = useState(modoFalso);
    const [fake] = useState(() => (falso ? servidorFalso() : null));
    const servidorDe = useCallback((url) => fake ?? servidorReal(url), [fake]);
    const [estado, setEstado] = useState({ fase: 'carregando' });
    const [srv, setSrv] = useState(null);
    const [nomeServidor, setNomeServidor] = useState('');
    const [eu, setEu] = useState(null);
    const [salas, setSalas] = useState([]);
    const [pessoas, setPessoas] = useState([]);
    const [sala, setSala] = useState(() => (modoFalso() && demoScreen() !== 'saguao' ? 'cs' : null));
    const visivel = useJanelaVisivel();
    const visivelRef = useRef(visivel);
    visivelRef.current = visivel;
    const agendaPresenca = useRef(null);
    const avisarPresenca = useCallback(() => agendaPresenca.current?.avisar(), []);
    const escolherSala = useCallback((id) => {
        setSala(id);
        avisarPresenca();
    }, [avisarPresenca]);
    const [link, setLink] = useState(null);
    const [aviso, setAviso] = useState(null);
    const salaRef = useRef(sala);
    salaRef.current = sala;
    const tela = falso ? demoScreen() : null;
    const [overlay, setOverlay] = useState(tela === 'config' ? 'settings' : tela === 'novidades' ? { novidades: null } : tela === 'perfil' ? 'perfil' : null);
    const updater = useUpdater(!!sala, falso);
    const [paginaConfig, setPaginaConfig] = useState();
    // Demo lobby shows a poke received, as in the prototype; real ones come from aoReceberCutucada.
    const [cutucada, setCutucada] = useState(() => (falso && tela === 'saguao' && new URLSearchParams(location.search).get('grupo') !== 'pequeno'
        ? { id: 'demo', de: 'Rafa', recado: 'a sala tá pronta', salaId: 'cs', salaNome: 'CS' } : null));
    useEffect(() => aoReceberCutucada(setCutucada), []);
    const carregar = useCallback(async (s) => {
        try {
            // Presence comes from LiveKit; if it is down the rest of the app still opens.
            const [u, ss, ps, info] = await Promise.all([s.eu(), s.salas(), s.pessoas().catch(() => []), s.info().catch(() => null)]);
            setSrv(s);
            setEu(u);
            setSalas(ss);
            setPessoas(ps);
            const nome = info?.nome ?? new URL(s.url).host;
            setNomeServidor(nome);
            if (!fake)
                salvarServidor({ url: s.url, nome });
            setEstado({ fase: 'pronto' });
        }
        catch (e) {
            if (e instanceof ApiError && e.status === 401)
                setEstado({ fase: 'entrada' });
            else
                setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
        }
    }, [fake]);
    const iniciar = useCallback(async () => {
        setEstado({ fase: 'carregando' });
        const url = fake?.url ?? servidorAtual();
        if (!url)
            return setEstado({ fase: 'entrada' });
        const s = servidorDe(url);
        if (!(await s.temSessao()))
            return setEstado({ fase: 'entrada' });
        await carregar(s);
    }, [carregar, fake, servidorDe]);
    useEffect(() => void iniciar(), [iniciar]);
    function irParaConvite(l) {
        setAviso(null);
        setLink(l);
        setOverlay(null);
        setEstado((e) => (e.fase === 'pronto' ? { fase: 'entrada', voltar: true } : { fase: 'entrada' }));
    }
    // Invite links opened in the browser come back as stackcall://entrar and land here.
    // In a call the link only asks; the call keeps running even after "Abrir" (the room stays mounted).
    const abrirConvite = useRef((l) => irParaConvite(l));
    abrirConvite.current = (l) => {
        if (!salaRef.current)
            return irParaConvite(l);
        setAviso({
            tipo: 'aviso',
            texto: `Convite recebido de ${new URL(l.servidor).host}. Abrir?`,
            acoes: [{ rotulo: 'Abrir', principal: true, onClick: () => irParaConvite(l) }, { rotulo: 'Agora não', onClick: () => setAviso(null) }],
        });
    };
    useEffect(() => {
        let parar;
        let vivo = true;
        void ouvirDeepLinks((l) => abrirConvite.current(l)).then((f) => (vivo ? (parar = f) : f()));
        return () => {
            vivo = false;
            parar?.();
        };
    }, []);
    // Session over (401 from any call, or the Rust event): back to the entry screen. A call in
    // progress keeps running only if the person says so.
    useEffect(() => {
        const encerrar = () => {
            setOverlay(null);
            setEstado({ fase: 'entrada' });
            const texto = 'Sua sessão neste aparelho acabou. Entre de novo com um convite.';
            if (!salaRef.current)
                return setAviso({ tipo: 'aviso', texto });
            setAviso({
                tipo: 'aviso',
                texto: `${texto} Você ainda está na voz: quer continuar?`,
                acoes: [
                    { rotulo: 'Sair da voz', principal: true, onClick: () => { setSala(null); setAviso(null); } },
                    { rotulo: 'Continuar na voz', onClick: () => setAviso({
                            tipo: 'aviso', texto: 'Você continua na voz, sem sessão neste aparelho.',
                            acoes: [{ rotulo: 'Sair da voz', onClick: () => { setSala(null); setAviso(null); } }],
                        }) },
                ],
            });
        };
        const parar = aoPerderSessao(encerrar);
        let pararEvento;
        let vivo = true;
        if (isTauri())
            void listen('sessao-encerrada', encerrar).then((f) => (vivo ? (pararEvento = f) : f()), () => undefined);
        return () => {
            vivo = false;
            parar();
            pararEvento?.();
        };
    }, []);
    useEffect(() => {
        if (!srv || estado.fase !== 'pronto')
            return;
        let ativa = true;
        const agenda = agendarPresenca(async () => {
            const [ps, ss] = await Promise.allSettled([srv.pessoas(), srv.salas()]);
            if (ativa) {
                if (ps.status === 'fulfilled')
                    setPessoas(ps.value);
                if (ss.status === 'fulfilled')
                    setSalas(ss.value);
            }
            return [ps, ss].some((r) => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 429);
        }, visivelRef.current);
        agendaPresenca.current = agenda;
        window.addEventListener('focus', avisarPresenca);
        return () => {
            ativa = false;
            agenda.parar();
            agendaPresenca.current = null;
            window.removeEventListener('focus', avisarPresenca);
        };
    }, [srv, estado.fase, avisarPresenca]);
    useEffect(() => agendaPresenca.current?.visibilidade(visivel), [visivel]);
    // Game in the presence: the core is asked every 30 s while the preference is on.
    useEffect(() => {
        if (!srv || estado.fase !== 'pronto' || falso)
            return;
        return iniciarDeteccaoJogo(srv);
    }, [srv, estado.fase, falso]);
    // Opens "Novidades" once after an update.
    useEffect(() => {
        if (fake)
            return;
        const seen = store.get('versaoVista');
        if (seen && seen !== updater.current)
            setOverlay({ novidades: seen });
        store.set('versaoVista', updater.current);
    }, [updater.current]);
    async function sairDoAparelho() {
        if (!srv)
            return;
        await srv.sair();
        if (!falso)
            esquecerServidor(srv.url);
        setSala(null);
        setOverlay(null);
        setSrv(null);
        setEstado({ fase: 'entrada' });
    }
    function trocarServidor(url) {
        escolherServidor(url);
        setSala(null);
        setOverlay(null);
        void iniciar();
    }
    async function convidar() {
        if (!srv)
            return;
        const c = await srv.criarConvite();
        if (!c.link)
            throw new Error('O servidor não devolveu o link do convite.');
        await navigator.clipboard.writeText(c.link);
    }
    async function remover(p) {
        if (!srv)
            return;
        setAviso(null);
        try {
            await srv.remover(p.id);
            setPessoas((ps) => ps.filter((x) => x.id !== p.id));
        }
        catch (e) {
            setAviso({
                tipo: 'erro',
                texto: `Não deu para remover ${p.nome}. ${e instanceof Error ? e.message : String(e)}`,
                acoes: [{ rotulo: 'Tentar de novo', onClick: () => void remover(p) }],
            });
        }
    }
    async function amigo(id, sim) {
        if (!srv)
            return;
        setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: sim } : p)));
        await srv.amigo(id, sim).catch(() => setPessoas((ps) => ps.map((p) => (p.id === id ? { ...p, amigo: !sim } : p))));
    }
    const podeAdministrar = eu?.papel === 'dono' || eu?.papel === 'admin';
    const cartao = overlay && typeof overlay === 'object' && 'cartao' in overlay
        ? (overlay.cartao === eu?.id ? eu : pessoas.find((p) => p.id === overlay.cartao)) ?? null
        : null;
    // A call survives the entry screen (invite opened, session over): the room stays mounted, hidden.
    const comSala = !!(srv && eu && (estado.fase === 'pronto' || (estado.fase === 'entrada' && sala)));
    let corpo = null;
    if (estado.fase === 'carregando') {
        corpo = (_jsxs("div", { className: "grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 px-5 pt-4 pb-5", "aria-busy": "true", "aria-label": "Carregando", children: [_jsxs("div", { className: "flex gap-3", children: [_jsx("div", { className: "skeleton h-[52px] w-[260px]" }), _jsx("div", { className: "skeleton h-[52px] w-[420px]" }), _jsx("div", { className: "skeleton ml-auto size-11" })] }), _jsxs("div", { className: "grid grid-cols-[minmax(0,1fr)_340px] gap-4", children: [_jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" })] })] }));
    }
    else if (estado.fase === 'erro') {
        corpo = (_jsx("div", { className: "flex h-full items-center justify-center p-8", children: _jsxs("div", { className: "janela flex w-[520px] max-w-full flex-col", children: [_jsx("div", { className: "barra barra-ar", children: "Sem conex\u00E3o" }), _jsxs("div", { className: "flex flex-col gap-4 p-5", children: [_jsx("h1", { className: "text-[40px]", children: "Servidor fora do alcance" }), _jsx("p", { role: "alert", className: "m-0", children: estado.mensagem }), _jsx("p", { className: "m-0 text-[14px] text-texto-fraco", children: "Confira a internet. Se ela estiver boa, o servidor pode estar reiniciando." }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", className: "btn btn-prim", onClick: () => void iniciar(), children: "Tentar de novo" }), _jsx("button", { type: "button", className: "btn", onClick: () => setEstado({ fase: 'entrada', voltar: true }), children: "Usar outro convite" })] })] })] }) }));
    }
    else if (estado.fase === 'entrada' || !srv || !eu) {
        corpo = (_jsx(Entrada, { link: link, servidorDe: servidorDe, onLink: setLink, onConfig: () => setOverlay('settings'), onVoltar: estado.fase === 'entrada' && estado.voltar && srv ? () => { setLink(null); setEstado({ fase: 'pronto' }); } : undefined, onEntrou: (s) => {
                setLink(null);
                setSala(null);
                setAviso(null);
                if (!falso)
                    escolherServidor(s.url);
                void carregar(s);
            } }));
    }
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden", children: [_jsx(UpdateBanner, { updater: updater, inCall: !!sala, room: salas.find((s) => s.id === sala)?.nome ?? '', onNotes: () => setOverlay({ novidades: null }) }), aviso && (_jsx(Faixa, { tipo: aviso.tipo, acoes: aviso.acoes, onFechar: aviso.acoes?.length ? undefined : () => setAviso(null), className: "mx-5 mt-3 shrink-0", children: aviso.texto })), _jsxs("div", { className: "relative min-h-0 flex-1", children: [comSala && srv && eu && !sala && (_jsx("div", { hidden: !!corpo, className: "h-full", children: _jsx(Saguao, { nomeServidor: nomeServidor, eu: eu, salas: salas, pessoas: pessoas, cutucada: cutucada, onSala: (id) => {
                                if (cutucada?.salaId === id)
                                    setCutucada(null);
                                escolherSala(id);
                            }, onConfig: () => setOverlay('settings'), onPerfil: () => setOverlay('perfil'), onCartao: (id) => setOverlay({ cartao: id }), onConvidar: convidar, onFecharCutucada: () => setCutucada(null) }) })), comSala && srv && eu && sala && (_jsx("div", { hidden: !!corpo, className: "h-full", children: _jsx(RoomScreen, { servidor: srv, nomeServidor: nomeServidor, eu: eu, salas: salas, pessoas: pessoas, sala: sala, demo: falso, onSala: escolherSala, onPresenceChange: avisarPresenca, onConfig: () => setOverlay('settings'), onPerfil: () => setOverlay('perfil'), onCartao: (id) => setOverlay({ cartao: id }), onConvidar: convidar, onAmigo: (id, sim) => void amigo(id, sim), cutucada: cutucada, onFecharCutucada: () => setCutucada(null) }) })), corpo, _jsx(Camada05, { servidor: estado.fase === 'pronto' ? srv : null, eu: eu, pessoas: pessoas, salas: salas, sala: sala, onSala: escolherSala, onCartao: (id) => setOverlay({ cartao: id }), onConfig: (pagina) => { setPaginaConfig(pagina); setOverlay('settings'); } }), overlay === 'settings' && (_jsx(Settings, { updater: updater, inCall: !!sala, servidor: estado.fase === 'pronto' ? srv : null, eu: eu, salas: salas, pessoas: pessoas, onClose: () => { setOverlay(null); setPaginaConfig(undefined); }, onNotes: () => setOverlay({ novidades: null }), onPerfil: () => setOverlay('perfil'), pagina: paginaConfig ?? (falso ? new URLSearchParams(location.search).get('pagina') ?? undefined : undefined), onSalas: setSalas, onPessoas: setPessoas, onSair: () => void sairDoAparelho(), onTrocar: trocarServidor, onColarConvite: () => { setOverlay(null); setLink(null); setEstado({ fase: 'entrada', voltar: !!srv }); } })), overlay === 'perfil' && srv && eu && (_jsx(Perfil, { servidor: srv, eu: eu, onFechar: () => setOverlay(null), onSalvo: (u) => {
                            setEu(u);
                            setOverlay(null);
                        } })), cartao && eu && (_jsx(CartaoPerfil, { pessoa: cartao, souEu: cartao.id === eu.id, podeRemover: podeAdministrar && cartao.papel !== 'dono', onAmigo: (sim) => void amigo(cartao.id, sim), onEditar: () => setOverlay('perfil'), onRemover: () => {
                            setOverlay(null);
                            void remover(cartao);
                        }, onFechar: () => setOverlay(null) })), overlay && typeof overlay === 'object' && 'novidades' in overlay && (_jsx(Novidades, { from: overlay.novidades, current: updater.current, onClose: () => setOverlay(null), onHistory: () => setOverlay('settings') }))] })] }));
}
