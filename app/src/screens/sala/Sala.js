import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Avatar } from '../../components/Avatar';
import { Faixa } from '../../components/Faixa';
import { Icone } from '../../components/Icone';
import { useInterfaceAtiva } from '../../lib/leveza';
import { demoScreen } from '../../lib/config';
import { ultimoAlvo, esperaCutucar, marcarCutucada, marcarSilenciado } from '../../lib/cutucadas';
import { replay as nucleoReplay } from '../../lib/nucleo';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import { publicarQuemFala } from '../../lib/quemfala';
import { registrarItensSala } from '../../lib/paleta';
import { RECUO_MS } from '../../room/reconexao';
import { barrasDe, nomesReplay, textoRede } from '../../room/sala05';
import { GoLive } from '../GoLive';
import { ACOES, aoAtalho, aoMudarAtalhos, bipe, criarControleVoz, lerAtalhos } from '../../lib/atalhos';
import { Cutucar } from './Cutucar';
import { MenuPessoa } from './MenuPessoa';
import { navegarMenu, Popover } from './Popover';
const fmt = (n, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const qualidadePing = (ms) => (ms <= 150 ? 'bom' : ms <= 250 ? 'ok' : 'alto');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const ancoraDe = (el, abaixo = false) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: abaixo ? r.bottom + 4 : r.top };
};
export function RoomView(props) {
    const { model, sala, salas, pessoas, eu, demo, onSala, onCartao, onConvidar, servidor } = props;
    const [goLive, setGoLive] = useState(() => demo && demoScreen() === 'ar');
    const [fallback, setFallback] = useState(false);
    const [stageId, setStageId] = useState(null);
    const [convite, setConvite] = useState('');
    const [confirmarAr, setConfirmarAr] = useState(0);
    const [painel, setPainel] = useState(null);
    const [grade, setGrade] = useState(() => new URLSearchParams(location.search).has('grade'));
    const [replay, setReplay] = useState(null);
    const [aviso, setAviso] = useState(null);
    const antesDoMudo = useRef(new Map());
    const me = model.people.find((p) => p.isLocal);
    const imLive = !!me?.live;
    const emGrade = grade && model.streams.length >= 2;
    const stage = model.streams.find((s) => s.owner.id === stageId) ?? model.streams[0];
    const others = model.people.filter((p) => !p.isLocal);
    const porId = new Map(pessoas.map((p) => [p.id, p]));
    const conectada = model.state === 'connected';
    const gravando = model.people.filter((p) => p.replay);
    useEffect(() => void nucleoReplay.estado().then(setReplay, () => setReplay(null)), []);
    useEffect(() => {
        marcarSilenciado(model.deafened);
        return () => marcarSilenciado(false);
    }, [model.deafened]);
    // "Quem fala" window: equal states are dropped by publicarQuemFala, so every render may call it.
    useEffect(() => publicarQuemFala({
        sala: sala.nome, ping: model.ping, replay: !!replay?.ligado,
        pessoas: model.people.map((p) => ({ id: p.id, nome: p.name, cor: porId.get(p.id)?.cor ?? null, falando: p.speaking, mudo: p.muted })),
    }));
    useEffect(() => () => publicarQuemFala(null), []);
    // Grid: receive every screen while it is open; back to one when it closes.
    useEffect(() => {
        model.assistirTodas?.(emGrade);
        if (!emGrade)
            model.setSomTela?.(null);
    }, [emGrade]);
    const avisar = (texto, erro = false) => setAviso({ texto, erro });
    // Keyboard: M mic, S sound, T transmit (app in focus). Never while typing or with a dialog open.
    // The same voice actions answer the global shortcuts (lib/atalhos), which beep because the game hides the app.
    const atual = useRef({ model, conectada, imLive, goLive, stage, others });
    atual.current = { model, conectada, imLive, goLive, stage, others };
    const voz = useMemo(() => criarControleVoz({
        micAberto: () => atual.current.model.micOn,
        abrirMic: (on) => (atual.current.model.setMic ? atual.current.model.setMic(on) : on !== atual.current.model.micOn && atual.current.model.toggleMic()),
        silenciado: () => atual.current.model.deafened,
        alternarSilencio: () => atual.current.model.toggleDeafen(),
    }), []);
    useEffect(() => () => voz.parar(), [voz]);
    async function salvarClipe() {
        try {
            const c = await nucleoReplay.salvarClipe();
            bipe('liga');
            avisar(`Clipe de ${c.duracao_s} s salvo. Veja em Clipes, no topo.`);
        }
        catch (e) {
            avisar(`Não deu para salvar o clipe. ${e instanceof Error ? e.message : String(e)}`, true);
        }
    }
    const alternarRedeRuim = () => {
        const on = !atual.current.model.redeRuim;
        atual.current.model.setRedeRuim?.(on);
        bipe(on ? 'desliga' : 'liga');
    };
    // Same preference as Settings and the global shortcut; the main window shows or hides the window.
    const alternarQuemFala = () => {
        const mostrar = !lerPreferencias().quemFalaMostrar;
        salvarPreferencias({ quemFalaMostrar: mostrar });
        avisar(mostrar ? 'Janela quem fala aberta.' : 'Janela quem fala escondida.');
    };
    async function cutucarDeNovo() {
        const alvo = ultimoAlvo();
        if (!alvo || esperaCutucar(alvo) > 0)
            return;
        await servidor.cutucar(alvo, '').then(() => { marcarCutucada(alvo); bipe('liga'); }, () => bipe('desliga'));
    }
    useEffect(() => {
        const tecla = (e) => {
            const alvo = e.target;
            if (e.ctrlKey || e.altKey || e.metaKey || e.repeat)
                return;
            if (alvo?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]') || document.querySelector('[aria-modal="true"]'))
                return;
            const a = atual.current;
            const k = e.key.toLowerCase();
            if (k === 'm')
                voz.executar('mic', 'pressionado', false);
            else if (k === 's')
                voz.executar('silenciar', 'pressionado', false);
            else if (k === 't' && a.conectada && !a.imLive && !a.goLive)
                setGoLive(true);
            else
                return;
            e.preventDefault();
        };
        window.addEventListener('keydown', tecla);
        const parar = aoAtalho((id, estado) => {
            if (voz.executar(id, estado) || estado !== 'pressionado')
                return;
            const a = atual.current;
            const tela = a.stage && !a.stage.owner.isLocal ? a.stage : undefined;
            if (id === 'arEntrar' && a.conectada && !a.imLive) {
                // First press opens with the last choice; a second press while open confirms it.
                if (a.goLive)
                    setConfirmarAr((n) => n + 1);
                else
                    setGoLive(true);
                bipe('liga');
            }
            else if (id === 'arSair' && a.imLive) {
                a.model.stopLive();
                bipe('desliga');
            }
            else if (id === 'assistir' && tela && !tela.watching) {
                a.model.watch(tela.owner.id);
                bipe('liga');
            }
            else if (id === 'pararAssistir' && tela?.watching) {
                a.model.unwatch(tela.owner.id);
                bipe('desliga');
            }
            else if (id === 'clipe')
                void salvarClipe();
            else if (id === 'redeRuim')
                alternarRedeRuim();
            else if (id === 'cutucarUltimo')
                void cutucarDeNovo();
        });
        return () => {
            window.removeEventListener('keydown', tecla);
            parar();
        };
    }, [voz]);
    // The palette (above every screen) lists the room's live actions.
    useEffect(() => registrarItensSala(() => {
        const a = atual.current;
        const ruim = !!a.model.redeRuim;
        return [
            { id: 'sala-rede', grupo: 'acoes', rotulo: 'Modo internet ruim', detalhe: ruim ? 'ligado' : undefined, onde: ruim ? 'desligar' : 'ligar', icone: 'antena',
                apelidos: ['lag', 'rede', 'voz primeiro'], teclas: lerAtalhos().teclas.redeRuim, executar: alternarRedeRuim },
            { id: 'sala-clipe', grupo: 'acoes', rotulo: 'Salvar clipe', onde: 'clipes', icone: 'replay', teclas: lerAtalhos().teclas.clipe, executar: () => void salvarClipe() },
            { id: 'sala-quemfala', grupo: 'acoes', rotulo: 'Mostrar ou esconder a janela quem fala', onde: 'janela', icone: 'pessoa', executar: alternarQuemFala },
            { id: 'sala-transmitir', grupo: 'acoes', rotulo: a.imLive ? 'Sair do ar' : 'Transmitir', onde: 'transmitir', icone: 'tela',
                executar: () => (a.imLive ? a.model.stopLive() : setGoLive(true)) },
            ...a.others.flatMap((p) => [{
                    id: `sala-cutucar-${p.id}`, grupo: 'salas', pessoa: true, rotulo: `Cutucar ${p.name}`, detalhe: textoRede(p.rede ?? { qualidade: 'boa' }) ?? undefined,
                    onde: 'na sala', icone: 'cutuca', executar: () => abrirCutucar(p.id),
                }]),
        ];
    }), []);
    function abrirCutucar(id, ancora) {
        const el = document.querySelector(`[data-canal="${CSS.escape(id)}"]`);
        setPainel({ tipo: 'cutucar', id, ancora: ancora ?? (el ? ancoraDe(el) : { x: innerWidth / 2 - 208, y: innerHeight / 2 - 120 }) });
    }
    async function convidar() {
        setConvite('gerando');
        try {
            await onConvidar();
            setConvite('copiado');
        }
        catch (e) {
            setConvite({ erro: e instanceof Error ? e.message : String(e) });
        }
    }
    async function moderar(acao, nome) {
        try {
            await servidor.moderar(sala.id, acao);
            props.onPresenceChange?.();
            avisar(acao.acao === 'mover' ? `${nome} foi movido.` : acao.acao === 'retirar' ? `${nome} saiu da sala.` : 'Todos os microfones da sala foram desligados. Cada um pode religar o seu.');
        }
        catch (e) {
            avisar(`Não deu para moderar. ${e instanceof Error ? e.message : String(e)}`, true);
        }
    }
    const silenciarParaMim = (p) => {
        if (p.volume > 0) {
            antesDoMudo.current.set(p.id, p.volume);
            model.setVolume(p.id, 0);
        }
        else
            model.setVolume(p.id, antesDoMudo.current.get(p.id) ?? 1);
    };
    const abrirGoLive = () => setGoLive(true);
    const vivo = model.state === 'connected' || model.state === 'reconnecting';
    const linha = `${model.people.length} na sala · ${stage ? `${stage.owner.isLocal ? 'você' : stage.owner.name} no ar` : 'ninguém no ar'}`;
    const alvoMenu = painel?.tipo === 'menu' || painel?.tipo === 'cutucar' ? model.people.find((p) => p.id === painel.id) : undefined;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid min-h-0 grid-rows-[36px_minmax(0,1fr)_164px] gap-2.5", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3.5", children: [_jsx("h1", { className: "text-[32px] leading-none", children: sala.nome }), _jsx("span", { className: "rotulo truncate", children: linha }), gravando.length > 0 && (_jsxs("span", { className: "inline-flex h-[30px] shrink-0 items-center gap-2 border border-texto bg-superficie px-2.5 text-[13px]", role: "status", title: "Quem est\u00E1 com o replay ligado grava os \u00FAltimos segundos da sala", children: [_jsx("span", { className: "text-destaque", children: _jsx(Icone, { nome: "replay", tamanho: 16 }) }), _jsxs("span", { children: [_jsx("b", { children: "Replay ligado:" }), " ", nomesReplay(gravando.map((p) => (p.isLocal ? 'você' : p.name)))] })] })), model.streams.length >= 2 && (_jsxs("div", { className: "abas shrink-0 [&>button]:min-h-[30px]", role: "group", "aria-label": "Arranjo das telas", children: [_jsxs("button", { type: "button", "aria-pressed": !grade, onClick: () => setGrade(false), children: [_jsx(Icone, { nome: "uma", tamanho: 14 }), " Uma"] }), _jsxs("button", { type: "button", "aria-pressed": grade, onClick: () => setGrade(true), children: [_jsx(Icone, { nome: "grade", tamanho: 14 }), " Grade"] })] })), _jsxs("span", { className: "ml-auto flex shrink-0 items-center gap-2", children: [convite === 'copiado' && _jsx("span", { role: "status", className: "text-[13px] text-texto-fraco", children: "Link copiado. Vale 7 dias e 1 uso." }), _jsxs("button", { type: "button", className: "btn btn-sm", disabled: convite === 'gerando', onClick: () => void convidar(), children: [_jsx(Icone, { nome: "link", tamanho: 16 }), convite === 'gerando' ? 'Gerando…' : 'Convidar'] }), _jsx("button", { type: "button", className: "btn btn-sm btn-icone", "aria-label": "Menu da sala", "aria-haspopup": "menu", title: "Menu da sala", onClick: (e) => setPainel({ tipo: 'sala', ancora: { x: e.currentTarget.getBoundingClientRect().right - 260, y: e.currentTarget.getBoundingClientRect().bottom + 4 } }), children: _jsx(Icone, { nome: "pontos", tamanho: 16 }) })] })] }), _jsxs("main", { className: `grid min-h-0 gap-3 ${emGrade ? 'grid-cols-[minmax(0,1fr)_44px]' : 'grid-cols-[minmax(0,1fr)_330px]'}`, children: [_jsxs("section", { className: "flex min-h-0 min-w-0 flex-col gap-2", children: [typeof convite === 'object' && (_jsxs(Faixa, { acoes: [{ rotulo: 'Tentar de novo', onClick: () => void convidar() }], onFechar: () => setConvite(''), children: ["N\u00E3o deu para gerar o convite. ", convite.erro] })), aviso && _jsx(Faixa, { tipo: aviso.erro ? 'erro' : 'aviso', onFechar: () => setAviso(null), children: aviso.texto }), emGrade ? (_jsx(Grade, { model: model, streams: model.streams })) : stage || !vivo ? (_jsx(Palco, { model: model, stage: stage, reconexao: props.reconexao, jogo: stage ? porId.get(stage.owner.id)?.jogo : null, onPick: (id) => {
                                            if (stage?.watching && !stage.owner.isLocal && stage.owner.id !== id)
                                                model.unwatch(stage.owner.id);
                                            setStageId(id);
                                        }, onRetry: props.onRetry })) : (_jsx(SalaLivre, { model: model, others: others, porId: porId, pessoas: pessoas, salas: salas, sala: sala, onCartao: onCartao, onMenu: (id, ancora) => setPainel({ tipo: 'menu', id, ancora }) }))] }), emGrade
                                ? _jsx(ConversaFina, { chat: model.chat, onAbrir: () => setGrade(false) })
                                : _jsx(Lateral, { sala: sala.nome, model: model, pessoas: pessoas, salas: salas, eu: eu, onCartao: onCartao, onAmigo: props.onAmigo })] }), _jsxs("footer", { className: "grid min-h-0 min-w-0 grid-cols-[372px_minmax(0,1fr)] gap-3", children: [_jsx(Voce, { model: model, nome: eu.nome, sala: sala.nome, imLive: imLive, replay: replay, onGoLive: abrirGoLive, onSair: () => onSala(null), onClipe: () => void salvarClipe(), onFallback: () => { model.clearStreamError?.(); setFallback(true); setGoLive(true); }, onOuvem: (el) => setPainel({ tipo: 'ouvem', ancora: { x: el.getBoundingClientRect().left - 10, y: el.getBoundingClientRect().top - 8 } }), onMais: (el) => setPainel({ tipo: 'mais', ancora: ancoraDe(el) }) }), stage || emGrade ? (_jsxs("ul", { "aria-label": "Pessoas na sala", className: "m-0 grid min-w-0 list-none auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto p-0", children: [others.map((p) => (_jsx(Canal, { person: p, perfil: porId.get(p.id), onVolume: (v) => model.setVolume(p.id, v), onCartao: () => onCartao(p.id), onMenu: (ancora) => setPainel({ tipo: 'menu', id: p.id, ancora }), onAssistir: () => p.live && model.watch(p.id) }, p.id))), others.length === 0 && _jsx("li", { className: "flex items-center px-2 text-[14px] text-texto-fraco", children: "S\u00F3 voc\u00EA na sala." })] })) : (_jsx(Atalhos, {}))] })] }), painel?.tipo === 'menu' && alvoMenu && (_jsx(MenuPessoa, { ancora: painel.ancora, person: alvoMenu, perfil: porId.get(alvoMenu.id), eu: eu, salas: salas, salaAtual: sala.id, esperaCutucar: esperaCutucar(alvoMenu.id), silenciadoParaMim: alvoMenu.volume === 0, onFechar: () => setPainel(null), onVolume: (v) => model.setVolume(alvoMenu.id, v), onPerfil: () => onCartao(alvoMenu.id), onAssistir: () => model.watch(alvoMenu.id), onCutucar: () => abrirCutucar(alvoMenu.id, painel.ancora), onSilenciarParaMim: () => silenciarParaMim(alvoMenu), onMover: (destinoId) => void moderar({ acao: 'mover', usuarioId: alvoMenu.id, destinoId }, alvoMenu.name), onTirar: () => void moderar({ acao: 'retirar', usuarioId: alvoMenu.id }, alvoMenu.name) })), painel?.tipo === 'cutucar' && alvoMenu && (_jsx(Cutucar, { ancora: painel.ancora, alvo: { id: alvoMenu.id, nome: alvoMenu.name }, eu: eu.nome, servidor: servidor, somDesligado: false, onFechar: () => setPainel(null), onEnviada: () => avisar(`${alvoMenu.name} foi cutucado.`) })), painel?.tipo === 'ouvem' && (_jsx(QuemRecebe, { ancora: painel.ancora, model: model, imLive: imLive, onFechar: () => setPainel(null) })), painel?.tipo === 'sala' && (_jsx(Popover, { ancora: painel.ancora, onFechar: () => setPainel(null), rotulo: "Menu da sala", role: "menu", className: "w-[260px] py-1", children: _jsx("div", { onKeyDown: navegarMenu, children: [
                        ...(eu.papel === 'dono' || eu.papel === 'admin' ? [{ t: 'Silenciar todos', f: () => void moderar({ acao: 'silenciar' }, sala.nome), i: 'mic-off' }] : []),
                        { t: 'Sair da sala', f: () => onSala(null), i: 'sair' },
                    ].map((o) => (_jsxs("button", { type: "button", role: "menuitem", onClick: () => { setPainel(null); o.f(); }, className: "flex h-[34px] w-full items-center gap-2.5 border-0 bg-transparent px-3 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none", children: [_jsx(Icone, { nome: o.i, tamanho: 16 }), o.t] }, o.t))) }) })), painel?.tipo === 'mais' && (_jsx(Popover, { ancora: painel.ancora, onFechar: () => setPainel(null), rotulo: "Mais", role: "menu", className: "w-[260px] py-1", children: _jsx("div", { onKeyDown: navegarMenu, children: [
                        { t: model.redeRuim ? 'Desligar modo internet ruim' : 'Modo internet ruim', f: alternarRedeRuim, i: 'antena' },
                        { t: 'Mostrar ou esconder a janela quem fala', f: alternarQuemFala, i: 'pessoa' },
                        { t: 'Teste de rede e microfone', f: props.onConfig, i: 'ajustes' },
                        { t: 'Entrar no ar com outra fonte', f: abrirGoLive, i: 'tela', off: !conectada || imLive },
                    ].map((o) => (_jsxs("button", { type: "button", role: "menuitem", "aria-disabled": o.off || undefined, onClick: o.off ? undefined : () => { setPainel(null); o.f(); }, className: `flex h-[34px] w-full items-center gap-2.5 border-0 bg-transparent px-3 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none ${o.off ? 'text-texto-fraco' : ''}`, children: [_jsx(Icone, { nome: o.i, tamanho: 16 }), o.t] }, o.t))) }) })), goLive && (_jsx(GoLive, { demo: demo, fallback: fallback, server: servidor.url, roomLabel: sala.nome, viewers: Math.max(0, model.people.length - 1), confirmar: confirmarAr, onCancel: () => { setGoLive(false); setFallback(false); setConfirmarAr(0); }, onStart: async (track, preset, codec) => {
                    await model.goLive(track, preset, codec);
                    setGoLive(false);
                    setFallback(false);
                }, onNativeStart: model.goLiveNative && (async (...args) => {
                    await model.goLiveNative(...args);
                    setGoLive(false);
                }) }))] }));
}
/** "Quem recebe você": opens above the Você window. Someone who silenced you only for themselves still shows (decision 2). */
function QuemRecebe({ ancora, model, imLive, onFechar }) {
    const lista = model.receptores ?? [];
    const avatar = (id, nome) => _jsx(Avatar, { pessoa: { nome, avatar: null }, tamanho: 28 }, id);
    return (_jsxs(Popover, { ancora: { x: ancora.x, y: Math.max(8, ancora.y - (lista.length * 43 + 110)) }, onFechar: onFechar, rotulo: "Quem recebe voc\u00EA", className: "w-[372px]", children: [_jsxs("div", { className: "barra", children: ["Quem recebe voc\u00EA", _jsx("span", { className: "ml-auto font-medium", children: "voz \u00B7 tela" })] }), lista.length === 0 ? (_jsx("p", { className: "m-0 px-3 py-3 text-[13px] text-texto-fraco", children: "Ningu\u00E9m mais aqui. Para chamar algu\u00E9m, clique com o bot\u00E3o direito no nome e escolha Cutucar." })) : (_jsx("ul", { className: "m-0 list-none p-0", children: lista.map((r) => (_jsxs("li", { className: "grid grid-cols-[28px_minmax(0,1fr)_auto_44px] items-center gap-2.5 border-b border-borda px-3 py-[7px]", children: [avatar(r.id, r.nome), _jsx("b", { className: "truncate text-[14px]", children: r.nome }), _jsx("span", { className: `font-mono text-[11px] font-bold uppercase ${r.voz ? 'text-vitoria' : 'text-texto-fraco'}`, children: r.voz ? '✓ voz' : r.motivo ?? '—' }), _jsx("span", { className: `text-center font-mono text-[11px] ${r.tela ? 'font-bold text-vitoria uppercase' : 'text-texto-fraco'}`, children: r.tela ? '✓ tela' : '—' })] }, r.id))) })), _jsx("p", { className: "m-0 px-3 pt-2 pb-3 text-[12.5px] text-texto-fraco", children: imLive ? 'Quem assiste a sua tela aparece em “tela”.' : 'Você não está transmitindo. Quando estiver, quem assiste aparece em “tela”.' })] }));
}
/** Local keys (app in focus) and the global shortcuts the person configured in Settings > Atalhos. */
export function Atalhos() {
    const [cfg, setCfg] = useState(lerAtalhos);
    useEffect(() => aoMudarAtalhos(setCfg), []);
    const locais = [['M', 'microfone'], ['S', 'silencia tudo'], ['T', 'transmite'], ['Ctrl+K', 'busca e comandos']];
    const globais = ACOES.flatMap((a) => (cfg.teclas[a.id] ? [[cfg.teclas[a.id], a.rotulo.toLowerCase()]] : []));
    const item = ([k, t]) => (_jsxs("li", { className: "flex items-center gap-2 text-[14px]", children: [_jsx("kbd", { className: "inline-flex h-8 min-w-8 items-center justify-center border border-texto bg-superficie-alta px-1.5 font-mono text-[13px] font-bold", children: k }), _jsx("span", { className: "text-texto-fraco", children: t })] }, k + t));
    return (_jsxs("section", { className: "janela flex min-w-0 flex-col", "aria-label": "Atalhos do teclado", children: [_jsxs("div", { className: "barra", children: ["Atalhos", _jsx("span", { className: "ml-auto font-medium", children: globais.length ? `${globais.length} globais` : 'com o app em foco' })] }), _jsxs("ul", { className: "m-0 flex flex-1 list-none flex-wrap content-center items-center gap-x-6 gap-y-2 px-4 py-3", children: [locais.map(item), globais.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("li", { "aria-hidden": "true", className: "h-6 w-px bg-borda" }), globais.map(item)] })) : (_jsx("li", { className: "text-[13px] text-texto-fraco", children: "Atalhos com o jogo na frente: Configura\u00E7\u00F5es > Atalhos." }))] })] }));
}
/** Empty stage: a slim strip (the one red Transmit lives in the Você window) and the room's people get the space. */
function SalaLivre({ model, others, porId, pessoas, salas, sala, onCartao, onMenu }) {
    const nomeSala = new Map(salas.map((s) => [s.id, s.nome]));
    const naVoz = new Set(model.people.map((p) => p.id));
    const fora = pessoas.filter((p) => p.online && !naVoz.has(p.id) && p.sala !== sala.id);
    return (_jsxs("div", { className: "flex min-h-0 flex-1 flex-col gap-3", children: [_jsxs("div", { className: "janela flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pr-3 pl-4", children: [_jsx("b", { className: "font-display text-[28px]", children: "Palco livre" }), _jsx("span", { className: "text-texto-fraco", children: "Ningu\u00E9m transmitindo. Use Transmitir na janela Voc\u00EA para mostrar seu jogo." })] }), _jsxs("section", { className: "janela flex min-h-0 flex-1 flex-col", "aria-label": "Pessoas na sala", children: [_jsxs("div", { className: "barra", children: ["Na sala", _jsx("span", { className: "ml-auto font-medium", children: plural(model.people.length, 'pessoa', 'pessoas') })] }), others.length > 0 ? (_jsx("ul", { className: "m-0 grid min-h-0 flex-1 list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-y-auto p-3", children: others.map((p) => (_jsx(Canal, { person: p, perfil: porId.get(p.id), onVolume: (v) => model.setVolume(p.id, v), onCartao: () => onCartao(p.id), onMenu: (ancora) => onMenu(p.id, ancora), onAssistir: () => undefined }, p.id))) })) : (_jsx(Vazio, { titulo: "S\u00F3 voc\u00EA por aqui", texto: "Chame a galera em Convidar. O link vale 7 dias e 1 uso.", children: fora.length > 0 && (_jsxs("div", { className: "mt-3 flex flex-col items-center gap-2", children: [_jsxs("span", { className: "rotulo", children: ["Online em outro lugar \u00B7 ", fora.length] }), _jsx("ul", { className: "m-0 flex list-none flex-wrap justify-center gap-2 p-0", children: fora.slice(0, 8).map((p) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "btn btn-fant gap-2 px-2", onClick: () => onCartao(p.id), "aria-label": `Ver perfil de ${p.nome}`, children: [_jsx(Avatar, { pessoa: p, tamanho: 28 }), _jsxs("span", { className: "text-[13px]", children: [p.nome, _jsxs("span", { className: "text-texto-fraco", children: [" \u00B7 ", p.sala ? nomeSala.get(p.sala) ?? 'outra sala' : 'fora da voz'] })] })] }) }, p.id))) })] })) }))] })] }));
}
export function TrackVideo({ track, className, muted = true, pip = false, videoRef }) {
    const proprio = useRef(null);
    const ref = videoRef ?? proprio;
    const ativa = useInterfaceAtiva();
    // Detached while nobody sees the window: the decoder stops drawing (leveza). PiP keeps it attached.
    useEffect(() => {
        const el = ref.current;
        if (!track || !el || (!ativa && document.pictureInPictureElement !== el))
            return;
        track.attach(el);
        return () => void track.detach(el);
    }, [track, ativa]);
    // Picture in picture only where the stage offers it (the button), never the browser's own overlay elsewhere.
    return _jsx("video", { ref: ref, className: className, autoPlay: true, playsInline: true, muted: muted, disablePictureInPicture: !pip });
}
async function toggleFullscreen(el) {
    const on = !document.fullscreenElement;
    if (on)
        await el.requestFullscreen().catch(() => undefined);
    else
        await document.exitFullscreen().catch(() => undefined);
    // WebView2 fullscreens the element only inside the window; make the window follow.
    if (isTauri())
        await getCurrentWindow().setFullscreen(on).catch(() => undefined);
}
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
/** Stage controls: quality, zoom, floating window, full screen. They show on hover or focus. */
function ControlesTela({ model, stream, videoRef, alvo, zoom, setZoom, mini = false }) {
    const q = model.qualidade?.[stream.owner.id] ?? 'original';
    const local = stream.owner.isLocal;
    const s = model.stageStats;
    const nomeQ = q === 'leve' ? 'Leve 720p' : `Original${!mini && s ? ` ${s.height}p${s.fps}` : ''}`;
    const pip = async () => {
        const v = videoRef.current;
        if (!v)
            return;
        if (document.pictureInPictureElement)
            await document.exitPictureInPicture().catch(() => undefined);
        else
            await v.requestPictureInPicture?.().catch(() => undefined);
    };
    const ctrl = `inline-flex ${mini ? 'h-[30px] min-w-[30px]' : 'h-9 min-w-9'} items-center justify-center gap-2 border border-[#4a4a50] bg-[#101012] px-2 text-[13px] text-[#f4f4f1] hover:border-[#f4f4f1]`;
    return (_jsxs("div", { role: "toolbar", "aria-label": `Controles da tela de ${stream.owner.isLocal ? 'você' : stream.owner.name}`, className: `absolute ${mini ? 'inset-x-2 bottom-2' : 'inset-x-3 bottom-3'} z-10 flex items-center justify-end gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, children: [!local && model.setQualidade && (_jsxs("button", { type: "button", className: `${ctrl} ${mini ? 'mr-auto' : ''}`, title: "Qualidade que voc\u00EA recebe", "aria-label": `Você recebe: ${nomeQ}. Trocar para ${q === 'leve' ? 'Original' : 'Leve'}`, onClick: () => model.setQualidade(stream.owner.id, q === 'leve' ? 'original' : 'leve'), children: [_jsx("span", { className: "font-mono text-[11px] text-[#b3b3ab] uppercase", children: mini ? 'Recebe' : 'Você recebe' }), _jsx("b", { children: nomeQ }), !mini && _jsx(Icone, { nome: "dir", tamanho: 14 })] })), !mini && stream.track && (_jsxs("span", { className: "inline-flex", children: [_jsx("button", { type: "button", className: ctrl, "aria-label": "Diminuir zoom", disabled: zoom <= 1, onClick: () => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]), children: _jsx(Icone, { nome: "menos", tamanho: 16 }) }), _jsxs("span", { className: `${ctrl} min-w-[52px] border-x-0 font-mono text-[12px] font-bold`, "aria-live": "polite", children: [Math.round(zoom * 100), "%"] }), _jsx("button", { type: "button", className: ctrl, "aria-label": "Aumentar zoom", disabled: zoom >= 3, onClick: () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]), children: _jsx(Icone, { nome: "mais", tamanho: 16 }) })] })), stream.track && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: ctrl, "aria-label": "Janela flutuante", title: "Janela flutuante", onClick: () => void pip(), children: _jsx(Icone, { nome: "pip", tamanho: 16 }) }), _jsx("button", { type: "button", className: ctrl, "aria-label": "Tela cheia", title: "Tela cheia (clique duplo)", onClick: () => alvo.current && void toggleFullscreen(alvo.current), children: _jsx(Icone, { nome: "cheia", tamanho: 16 }) })] })), !mini && stream.watching && !local && (_jsx("button", { type: "button", className: "btn btn-sm min-h-9", onClick: () => model.unwatch(stream.owner.id), children: "Parar de assistir" }))] }));
}
/** Bad internet mode over the stage: "voz primeiro" and the way back. */
function VozPrimeiro({ model }) {
    return (_jsxs("div", { className: "absolute inset-0 z-20 grid place-content-center justify-items-center gap-3 bg-palco p-6 text-center text-sobre-palco", role: "status", children: [_jsx("b", { className: "font-pincel -rotate-4 text-[40px] text-lima", children: "voz primeiro" }), _jsx("p", { className: "m-0 max-w-[52ch] text-[14px]", children: "Modo internet ruim ligado. O v\u00EDdeo que voc\u00EA recebe est\u00E1 pausado e a sua voz tem prioridade. A sua tela continua indo para quem assiste." }), _jsx("button", { type: "button", className: "btn btn-sm", onClick: () => model.setRedeRuim?.(false), children: "Desligar e voltar o v\u00EDdeo" })] }));
}
function Palco({ model, stage, reconexao, jogo, onPick, onRetry }) {
    const ref = useRef(null);
    const videoRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [arraste, setArraste] = useState({ x: 0, y: 0 });
    const inicio = useRef(null);
    useEffect(() => {
        const sync = () => {
            if (!document.fullscreenElement && isTauri())
                void getCurrentWindow().setFullscreen(false).catch(() => undefined);
        };
        document.addEventListener('fullscreenchange', sync);
        return () => document.removeEventListener('fullscreenchange', sync);
    }, []);
    useEffect(() => {
        if (zoom === 1)
            setArraste({ x: 0, y: 0 });
    }, [zoom]);
    useEffect(() => setZoom(1), [stage?.owner.id]);
    if (model.state === 'error') {
        const proxima = RECUO_MS[reconexao.falhas] / 1000;
        return (_jsxs("div", { className: "janela flex min-h-0 flex-1 flex-col", children: [_jsxs("div", { className: "barra barra-ar", children: ["Palco", _jsx("span", { className: "ml-auto font-medium", children: "sem conex\u00E3o" })] }), _jsxs("div", { className: "flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center", children: [_jsx("b", { className: "font-display text-[32px]", children: "Sem conex\u00E3o com a sala" }), _jsx("p", { role: "alert", className: "m-0 max-w-[480px]", children: model.error }), _jsx("p", { role: "status", className: "m-0 text-[14px] text-texto-fraco", children: reconexao.esgotou ? 'Toque em Reconectar quando a internet voltar.'
                                : !navigator.onLine ? 'Sem internet. Reconecta sozinho quando a rede voltar.'
                                    : `Reconectando sozinho em ${proxima} s (tentativa ${reconexao.falhas + 1} de ${RECUO_MS.length}).` }), _jsx("button", { type: "button", className: "btn btn-prim btn-lg", onClick: onRetry, children: "Reconectar" })] })] }));
    }
    if (model.state === 'connecting' || !stage) {
        return (_jsxs("div", { className: "janela flex min-h-0 flex-1 flex-col", "aria-busy": "true", children: [_jsxs("div", { className: "barra", children: ["Palco", _jsx("span", { className: "ml-auto font-medium", children: "conectando" })] }), _jsx("div", { className: "skeleton m-4 flex-1" })] }));
    }
    const nome = stage.owner.isLocal ? 'Você' : stage.owner.name;
    const s = model.stageStats;
    const numeros = stage.owner.isLocal || !s
        ? stage.info
        : [`${s.height}p${s.fps}`, s.codec, s.mbps !== null && `${fmt(s.mbps)} Mb/s`].filter(Boolean).join(' · ');
    const roda = (e) => {
        if (!stage.track)
            return;
        const i = ZOOMS.indexOf(zoom) + (e.deltaY < 0 ? 1 : -1);
        setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))]);
    };
    return (_jsxs("div", { ref: ref, className: "janela flex min-h-0 flex-1 flex-col", children: [_jsxs("div", { className: "barra barra-ar", children: [_jsx("span", { "aria-hidden": "true", className: "size-[7px] bg-sobre-destaque" }), _jsxs("span", { className: "truncate", children: ["No ar \u00B7 ", nome, jogo ? ` · ${jogo}` : ''] }), _jsx("span", { className: "ml-auto truncate font-medium normal-case", children: [numeros, `${stage.watchers} assistindo`].filter(Boolean).join(' · ') })] }), _jsxs("div", { tabIndex: stage.track ? 0 : -1, "aria-label": `Tela de ${nome}`, className: "group relative min-h-0 flex-1 overflow-hidden bg-palco outline-none", onWheel: roda, onDoubleClick: () => stage.track && ref.current && void toggleFullscreen(ref.current), onPointerDown: (e) => { if (zoom > 1) {
                    inicio.current = { x: e.clientX, y: e.clientY, ax: arraste.x, ay: arraste.y };
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                } }, onPointerMove: (e) => { const i = inicio.current; if (i)
                    setArraste({ x: i.ax + e.clientX - i.x, y: i.ay + e.clientY - i.y }); }, onPointerUp: () => (inicio.current = null), children: [stage.track ? (_jsx("div", { className: "absolute inset-0", style: { transform: `translate(${arraste.x}px, ${arraste.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : undefined }, children: _jsx(TrackVideo, { track: stage.track, videoRef: videoRef, pip: true, className: "absolute inset-0 size-full object-contain" }) })) : (_jsxs("div", { className: "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center", children: [_jsx("span", { className: "font-pincel -rotate-6 text-[40px] text-lima", children: "ao vivo!" }), _jsxs("span", { className: "text-[14px] text-sobre-palco", children: ["Tela de ", nome, ". Assistir gasta internet s\u00F3 de quem assiste."] }), !stage.watching && (_jsx("button", { type: "button", className: "btn btn-prim btn-lg", onClick: () => model.watch(stage.owner.id), children: "Assistir" }))] })), model.redeRuim && !stage.owner.isLocal && _jsx(VozPrimeiro, { model: model }), _jsx(ControlesTela, { model: model, stream: stage, videoRef: videoRef, alvo: ref, zoom: zoom, setZoom: setZoom }), _jsx("div", { className: "absolute top-3 right-3 z-10 flex flex-wrap justify-end gap-2", children: model.streams.length > 1 && model.streams.map((x) => (_jsx("button", { type: "button", onClick: () => onPick(x.owner.id), "aria-pressed": x === stage, className: `btn btn-sm ${x === stage ? 'bg-texto text-superficie' : ''}`, children: x.owner.isLocal ? 'Você' : x.owner.name }, x.owner.id))) })] })] }));
}
/** Two or more screens side by side; the sound comes from the marked one (red outline). Click a screen to move the sound. */
function Grade({ model, streams }) {
    const som = model.somTela ?? streams.find((s) => !s.owner.isLocal)?.owner.id ?? null;
    useEffect(() => {
        if (model.somTela === undefined || model.somTela === null)
            model.setSomTela?.(som);
    }, [som]);
    return (_jsxs("div", { className: "flex min-h-0 flex-1 flex-col gap-2", children: [_jsxs("span", { className: "rotulo", children: [streams.length, " telas \u00B7 o som vem da tela marcada \u00B7 clique numa tela para ouvir ela"] }), _jsx("div", { className: `grid min-h-0 flex-1 gap-3 ${streams.length > 2 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'}`, children: streams.map((s) => _jsx(TelaGrade, { model: model, stream: s, comSom: s.owner.id === som }, s.owner.id)) })] }));
}
function TelaGrade({ model, stream, comSom }) {
    const ref = useRef(null);
    const videoRef = useRef(null);
    const q = model.qualidade?.[stream.owner.id] === 'leve' ? 'leve 720p' : '1080p60';
    return (_jsxs("div", { ref: ref, className: `janela flex min-h-0 flex-col ${comSom ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : ''}`, children: [_jsxs("div", { className: "barra barra-ar", children: [_jsxs("span", { className: "truncate", children: ["\u25A0 ", stream.owner.isLocal ? 'Você' : stream.owner.name] }), _jsx("span", { className: "ml-auto font-medium", children: comSom ? `♪ som · ${q}` : `mudo · ${q}` })] }), _jsxs("div", { className: "group relative min-h-0 flex-1 overflow-hidden bg-palco", onClick: () => !stream.owner.isLocal && model.setSomTela?.(stream.owner.id), children: [stream.track ? _jsx(TrackVideo, { track: stream.track, videoRef: videoRef, pip: true, className: "absolute inset-0 size-full object-contain" })
                        : _jsx("span", { className: "absolute inset-0 grid place-items-center text-[13px] text-sobre-palco", children: "Carregando a tela\u2026" }), model.redeRuim && !stream.owner.isLocal && _jsx(VozPrimeiro, { model: model }), _jsx(ControlesTela, { model: model, stream: stream, videoRef: videoRef, alvo: ref, zoom: 1, setZoom: () => undefined, mini: true }), !comSom && !stream.owner.isLocal && (_jsx("button", { type: "button", className: "btn btn-sm absolute top-2 right-2 z-10", "aria-label": `Ouvir a tela de ${stream.owner.name}`, onClick: (e) => { e.stopPropagation(); model.setSomTela?.(stream.owner.id); }, children: _jsx(Icone, { nome: "volume", tamanho: 16 }) }))] })] }));
}
/** In the grid the chat shrinks to a 44 px strip with the count of new messages. */
function ConversaFina({ chat, onAbrir }) {
    const [base] = useState(chat.length);
    const novas = Math.max(0, chat.length - base);
    return (_jsxs("button", { type: "button", onClick: onAbrir, "aria-label": `Abrir conversa${novas ? `, ${novas} novas` : ''}`, className: "janela flex flex-col items-center gap-3 border-texto pt-3 hover:bg-superficie-alta", children: [_jsx(Icone, { nome: "chat", tamanho: 18 }), _jsx("span", { className: "rotate-180 font-mono text-[11px] font-bold tracking-[0.08em] uppercase [writing-mode:vertical-rl]", children: "Conversa" }), novas > 0 && _jsx("b", { className: "bg-destaque px-1.5 py-1 font-mono text-[11px] text-sobre-destaque", children: novas })] }));
}
/** Three network bars: faint when fine, `perigo` only when bad (always with text elsewhere). */
function BarrasRede({ rede, naBarra = true }) {
    if (!rede)
        return null;
    const n = barrasDe(rede.qualidade);
    const dica = [rede.ms !== undefined && `ping ${rede.ms} ms`, rede.perda !== undefined && `perda ${fmt(rede.perda * 100)}%`].filter(Boolean).join(' · ') || 'rede';
    return (_jsx("span", { className: `inline-flex h-[11px] shrink-0 items-end gap-0.5 ${rede.qualidade === 'ruim' ? (naBarra ? 'text-[#ff7a6b]' : 'text-perigo') : ''}`, title: dica, "aria-label": `Rede ${rede.qualidade}, ${dica}`, role: "img", children: [4, 7, 11].map((h, i) => _jsx("i", { className: "w-[3px] bg-current", style: { height: h, opacity: i < n ? 1 : 0.3 } }, h)) }));
}
function Voce({ model, nome, sala, imLive, replay, onGoLive, onSair, onFallback, onClipe, onOuvem, onMais }) {
    const me = model.people.find((p) => p.isLocal);
    const estado = { connecting: 'conectando…', connected: `na voz · ${sala}`, reconnecting: 'reconectando…', error: 'fora da voz' }[model.state];
    const ping = model.ping;
    const receptores = model.receptores ?? [];
    const ouvem = receptores.filter((r) => r.voz).length;
    const veem = receptores.filter((r) => r.tela).length;
    return (_jsxs("div", { className: "janela flex min-h-0 flex-col", children: [_jsxs("div", { className: "barra", children: [_jsxs("span", { className: "truncate", children: ["Voc\u00EA \u00B7 ", nome] }), _jsx("span", { className: "ml-auto inline-flex items-center gap-1.5 font-medium", role: "status", children: estado }), _jsx(BarrasRede, { rede: me?.rede ?? (ping !== null ? { qualidade: ping > 250 ? 'ruim' : ping > 150 ? 'media' : 'boa', ms: ping } : undefined) }), ping !== null && (_jsxs("span", { role: "status", "aria-label": `Ping ${ping} milissegundos, ${qualidadePing(ping)}`, title: "Ida e volta at\u00E9 o servidor de voz", className: `font-medium tabular-nums normal-case ${ping > 250 ? 'text-[#ff7a6b]' : ''}`, children: [ping, " ms"] }))] }), _jsxs("div", { className: "flex items-center gap-1.5 px-2.5 pt-3 pb-2.5", children: [_jsx("button", { type: "button", className: `btn btn-icone w-10 ${model.micOn ? '' : 'btn-off'}`, "aria-pressed": !model.micOn, "aria-label": model.micOn ? 'Desligar microfone' : 'Ligar microfone', title: model.micOn ? 'Microfone ligado (M)' : 'Microfone desligado (M)', onClick: model.toggleMic, children: _jsx(Icone, { nome: model.micOn ? 'mic' : 'mic-off' }) }), _jsx("button", { type: "button", className: `btn btn-icone w-10 ${model.deafened ? 'btn-off' : ''}`, "aria-pressed": model.deafened, "aria-label": model.deafened ? 'Ligar o som' : 'Silenciar tudo', title: model.deafened ? 'Som desligado (S)' : 'Silenciar tudo (S)', onClick: model.toggleDeafen, children: _jsx(Icone, { nome: model.deafened ? 'fone-off' : 'fone' }) }), imLive ? (_jsxs("button", { type: "button", className: "btn min-w-0 flex-1 px-2", onClick: model.stopLive, children: [_jsx(Icone, { nome: "tela" }), "Sair do ar"] })) : (_jsxs("button", { type: "button", className: "btn btn-prim min-w-0 flex-1 px-2", disabled: model.state !== 'connected', onClick: onGoLive, children: [_jsx(Icone, { nome: "tela" }), "Transmitir"] })), _jsxs("button", { type: "button", className: "btn btn-icone relative w-10", onClick: onClipe, "aria-label": replay?.ligado ? 'Salvar clipe, replay ligado' : 'Salvar clipe', title: replay?.ligado ? `Salvar clipe (últimos ${replay.segundos} s)` : 'Salvar clipe (ligue o replay em Configurações)', children: [_jsx(Icone, { nome: "replay" }), replay?.ligado && _jsx("span", { "aria-hidden": "true", className: "absolute top-1 right-1 size-[7px] bg-destaque" })] }), _jsx("button", { type: "button", className: "btn btn-icone w-10", "aria-label": "Mais", "aria-haspopup": "menu", title: "Mais: janela quem fala, internet ruim, teste de rede", onClick: (e) => onMais(e.currentTarget), children: _jsx(Icone, { nome: "pontos" }) }), _jsx("button", { type: "button", className: "btn btn-icone w-10 text-destaque", "aria-label": "Sair da sala", title: "Sair da sala", onClick: onSair, children: _jsx(Icone, { nome: "sair" }) })] }), (model.micError || model.streamError || (imLive && model.videoPaused)) && (_jsxs("div", { role: "alert", className: "flex flex-col gap-1.5 px-2.5 pb-2 text-[12.5px] text-perigo", children: [imLive && model.videoPaused && _jsx("span", { className: "text-texto-fraco", children: "Ningu\u00E9m assistindo \u00B7 v\u00EDdeo pausado" }), model.micError && _jsx("span", { children: model.micError }), model.streamError && (_jsxs(_Fragment, { children: [_jsx("span", { children: model.streamError }), _jsx("button", { type: "button", className: "btn btn-sm self-start", disabled: model.state !== 'connected', onClick: onFallback, children: "Transmitir pelo modo de reserva" })] }))] })), _jsxs("div", { className: "mt-auto flex items-center justify-between gap-2 border-t border-borda px-2.5 py-2", children: [_jsxs("button", { type: "button", className: "inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] whitespace-nowrap text-texto underline decoration-borda underline-offset-[3px]", "aria-haspopup": "dialog", onClick: (e) => onOuvem(e.currentTarget), children: [_jsx(Icone, { nome: "antena", tamanho: 16 }), _jsx("b", { children: ouvem }), " te ouvem \u00B7 ", _jsx("b", { children: veem }), " veem"] }), replay?.ligado && _jsxs("span", { className: "rotulo text-[11px]", children: ["Replay ", replay.segundos, " s"] }), model.redeRuim && _jsx("span", { className: "rotulo text-[11px] text-perigo", children: "internet ruim" })] })] }));
}
/**
 * Voice meter outside React state: while the person speaks and the window is visible, a
 * requestAnimationFrame loop reads the level and flips the lit cells in the DOM. Silence = no loop.
 */
export function Medidor({ person, ativo, className = 'h-14 w-2.5' }) {
    const ref = useRef(null);
    const { nivel, speaking, level } = person;
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        let aceso = -1;
        const pintar = (v) => {
            const n = Math.round(v * 8);
            if (n === aceso)
                return;
            aceso = n;
            Array.from(el.children).forEach((c, i) => c.toggleAttribute('data-aceso', i < n));
        };
        if (!ativo)
            return pintar(0);
        if (!nivel)
            return pintar(level); // demo room: fixed level
        if (!speaking)
            return pintar(0);
        let id = requestAnimationFrame(function quadro() {
            pintar(nivel());
            id = requestAnimationFrame(quadro);
        });
        return () => cancelAnimationFrame(id);
    }, [ativo, speaking, nivel, level]);
    return (_jsx("span", { ref: ref, "aria-hidden": "true", className: `medidor flex flex-col-reverse gap-0.5 ${className}`, children: Array.from({ length: 8 }, (_, i) => _jsx("i", {}, i)) }));
}
const mesmaRede = (a, b) => a?.qualidade === b?.qualidade && a?.ms === b?.ms && a?.perda === b?.perda;
const mesmaPessoa = (a, b) => a.id === b.id && a.name === b.name && a.speaking === b.speaking && (a.nivel ? true : a.level === b.level)
    && a.muted === b.muted && a.live === b.live && a.volume === b.volume && a.replay === b.replay && mesmaRede(a.rede, b.rede);
/**
 * Memoized: a speaker event re-renders only the channels whose voice data changed.
 * The callbacks are skipped on purpose; they only forward the person's id to stable actions.
 */
const Canal = memo(CanalView, (a, b) => mesmaPessoa(a.person, b.person) && a.perfil === b.perfil);
function CanalView({ person, perfil, onVolume, onCartao, onMenu, onAssistir }) {
    const ativa = useInterfaceAtiva();
    const pct = Math.round(person.volume * 100);
    const status = person.speaking ? 'falando' : person.muted ? 'mic desligado' : 'ouvindo';
    const ruim = person.rede ? textoRede(person.rede) : null;
    const linha2 = ruim ?? (person.live ? `no ar${perfil?.jogo ? ` · ${perfil.jogo}` : ''}` : perfil?.jogo ? `jogando ${perfil.jogo}` : null);
    const fala = person.speaking && !person.live;
    const fundo = person.live ? 'bg-palco text-sobre-palco' : fala ? 'bg-lima text-[#111]' : 'bg-superficie';
    const abrirMenu = (e) => {
        e.preventDefault();
        const el = e.currentTarget.getBoundingClientRect();
        onMenu('clientX' in e && e.clientX ? { x: e.clientX, y: e.clientY } : { x: el.left, y: el.top });
    };
    return (_jsxs("li", { "data-canal": person.id, tabIndex: 0, "aria-label": `${person.name}, ${status}${ruim ? `, ${ruim}` : ''}. Menu com botão direito ou Shift+F10`, onContextMenu: abrirMenu, onDoubleClick: () => person.live && onAssistir(), onKeyDown: (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
            abrirMenu(e); }, className: `flex min-w-0 flex-col border border-texto ${fundo}`, children: [_jsxs("div", { className: `barra ${person.live ? 'barra-ar' : fala ? 'barra-lima' : ''}`, children: [_jsx("span", { className: "truncate", children: person.name }), _jsxs("span", { className: "ml-auto inline-flex items-center gap-2", children: [person.replay && _jsx("span", { className: person.live ? '' : 'text-destaque', "aria-label": "Replay ligado", role: "img", children: _jsx(Icone, { nome: "replay", tamanho: 14 }) }), _jsx(BarrasRede, { rede: person.rede }), _jsx("button", { type: "button", className: "-mr-1.5 inline-flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 text-current opacity-80 hover:opacity-100", "aria-label": `Menu de ${person.name}`, "aria-haspopup": "menu", onClick: (e) => { e.stopPropagation(); onMenu({ x: e.currentTarget.getBoundingClientRect().left - 230, y: e.currentTarget.getBoundingClientRect().bottom }); }, children: _jsx(Icone, { nome: "pontos", tamanho: 14 }) })] })] }), _jsxs("div", { className: "flex min-h-0 flex-1 gap-2.5 px-2.5 pt-2.5 pb-1", children: [_jsx("button", { type: "button", className: "h-11 border-0 bg-transparent p-0", "aria-label": `Ver perfil de ${person.name}`, onClick: onCartao, children: _jsx(Avatar, { pessoa: { nome: person.name, avatar: perfil?.avatar ?? null }, tamanho: 44 }) }), _jsxs("span", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsx("b", { className: `text-[14px] ${person.muted && !person.speaking ? (person.live ? 'text-[#ff7a6b]' : 'text-perigo') : ''}`, children: status }), linha2 && _jsx("span", { className: `font-mono text-[11px] leading-[1.3] ${ruim ? `font-bold ${person.live ? 'text-[#ff7a6b]' : 'text-perigo'}` : 'opacity-75'}`, children: linha2 })] }), _jsx(Medidor, { person: person, ativo: ativa, className: "h-11 w-2" })] }), _jsxs("div", { className: "flex items-center gap-2 px-3 pb-2", children: [_jsxs(Slider.Root, { className: "relative flex h-8 flex-1 touch-none items-center select-none", min: 0, max: 200, step: 5, value: [pct], onValueChange: ([v]) => onVolume(v / 100), children: [_jsx(Slider.Track, { className: "relative h-1 grow bg-current/25", children: _jsx(Slider.Range, { className: "absolute h-full bg-current" }) }), _jsx(Slider.Thumb, { "aria-label": `Volume de ${person.name}`, "aria-valuetext": `${pct}%`, className: "block h-4 w-3 border border-current bg-superficie" })] }), _jsxs("span", { className: "w-10 text-right font-mono text-[11px] tabular-nums", children: [pct, "%"] })] })] }));
}
function Lateral({ sala, model, pessoas, salas, eu, onCartao, onAmigo }) {
    const [aba, setAba] = useState('conversa');
    return (_jsxs("aside", { className: "janela flex min-h-0 flex-col", "aria-label": aba === 'conversa' ? 'Conversa da sala' : 'Pessoas do servidor', children: [_jsx("div", { className: "flex border-b border-texto", role: "tablist", "aria-label": "Painel lateral", children: ['conversa', 'pessoas'].map((a) => (_jsx("button", { type: "button", role: "tab", "aria-selected": aba === a, onClick: () => setAba(a), className: `min-h-10 flex-1 border-0 font-mono text-[11px] font-bold tracking-[0.04em] uppercase [&+&]:border-l [&+&]:border-texto ${aba === a ? 'bg-texto text-superficie' : 'bg-transparent text-texto-fraco hover:bg-superficie-alta'}`, children: a === 'conversa' ? `Conversa · ${sala}` : `Pessoas · ${pessoas.filter((p) => p.online).length} on` }, a))) }), aba === 'conversa'
                ? _jsx(Conversa, { sala: sala, chat: model.chat, onSend: model.sendChat })
                : _jsx(Pessoas, { pessoas: pessoas, salas: salas, eu: eu, onCartao: onCartao, onAmigo: onAmigo })] }));
}
/** Memoized: a new message or a voice event does not redraw the messages already on screen. */
const Mensagem = memo(function Mensagem({ m }) {
    return (_jsxs(_Fragment, { children: [_jsx(Avatar, { pessoa: { nome: m.who, avatar: null }, tamanho: 30 }), _jsxs("div", { className: "flex min-w-0 flex-col gap-0.5", children: [_jsxs("span", { className: "flex items-baseline gap-2", children: [_jsx("b", { className: "text-[14px]", children: m.who }), _jsx("span", { className: "rotulo text-[11px]", children: m.hora })] }), _jsx("span", { className: "text-[14px] leading-[1.45] break-words", children: m.text })] })] }));
});
/** Memoized on the messages: voice events and stats do not redraw the chat (sendChat reads the room itself). */
const Conversa = memo(ConversaView, (a, b) => a.sala === b.sala && a.chat === b.chat);
function ConversaView({ sala, chat, onSend }) {
    const [text, setText] = useState('');
    const lista = useRef(null);
    // Virtualized: only the visible messages are in the DOM (leveza).
    const v = useVirtualizer({ count: chat.length, getScrollElement: () => lista.current, estimateSize: () => 64, overscan: 6, initialRect: { width: 330, height: 600 } });
    useEffect(() => {
        if (chat.length)
            v.scrollToIndex(chat.length - 1, { align: 'end' });
    }, [chat.length]);
    const submit = (e) => {
        e.preventDefault();
        onSend(text);
        setText('');
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { ref: lista, className: "min-h-0 flex-1 overflow-y-auto px-3.5 py-3", "aria-live": "polite", role: "log", "aria-label": "Mensagens", children: chat.length === 0 ? (_jsx("p", { className: "m-0 flex h-full items-end text-texto-fraco", children: "Sala quieta. Manda um oi." })) : (_jsx("div", { className: "relative w-full", style: { height: v.getTotalSize() }, children: v.getVirtualItems().map((item) => {
                        const m = chat[item.index];
                        return (_jsx("div", { "data-index": item.index, ref: v.measureElement, className: "absolute left-0 grid w-full grid-cols-[30px_minmax(0,1fr)] gap-2.5 pb-3", style: { transform: `translateY(${item.start}px)` }, children: _jsx(Mensagem, { m: m }) }, m.id));
                    }) })) }), _jsxs("form", { onSubmit: submit, className: "mx-3 mb-3 flex items-center gap-2 rounded-[2px] border border-texto bg-superficie py-0.5 pr-0.5 pl-3 focus-within:outline-2 focus-within:outline-destaque", children: [_jsx("label", { htmlFor: "msg", className: "sr-only", children: "Mensagem" }), _jsx("input", { id: "msg", className: "min-h-10 min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none", placeholder: `Mensagem para ${sala}`, value: text, maxLength: 2000, onChange: (e) => setText(e.target.value), autoComplete: "off" }), _jsx("button", { type: "submit", className: "btn btn-icone btn-sm", "aria-label": "Enviar", disabled: !text.trim(), children: _jsx(Icone, { nome: "enviar", tamanho: 16 }) })] })] }));
}
function Pessoas({ pessoas, salas, eu, onCartao, onAmigo }) {
    const nomeSala = new Map(salas.map((s) => [s.id, s.nome]));
    const outras = pessoas.filter((p) => p.id !== eu.id);
    const grupos = [
        ['Amigos', outras.filter((p) => p.amigo)],
        ['Outros no servidor', outras.filter((p) => !p.amigo)],
    ];
    if (outras.length === 0)
        return _jsx(Vazio, { titulo: "S\u00F3 voc\u00EA aqui", texto: "Gere um convite e mande para a galera." });
    return (_jsx("div", { className: "min-h-0 flex-1 overflow-y-auto", children: grupos.map(([titulo, lista]) => (_jsxs("section", { children: [_jsxs("h3", { className: "rotulo m-0 border-b border-borda px-3.5 py-2", children: [titulo, " \u00B7 ", lista.length] }), lista.length === 0 && _jsx("p", { className: "m-0 px-3.5 py-2 text-[13px] text-texto-fraco", children: titulo === 'Amigos' ? 'Adicione amigos para vê-los aqui em cima.' : 'Todo mundo já é seu amigo.' }), _jsx("ul", { className: "m-0 list-none p-0", children: [...lista].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (_jsxs("li", { className: "flex items-center gap-2.5 px-3.5 py-1", children: [_jsxs("button", { type: "button", className: "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left", onClick: () => onCartao(p.id), "aria-label": `Ver perfil de ${p.nome}`, children: [_jsx(Avatar, { pessoa: p, tamanho: 32 }), _jsxs("span", { className: "flex min-w-0 flex-col leading-tight", children: [_jsx("b", { className: "truncate text-[14px]", children: p.nome }), _jsxs("span", { className: "inline-flex items-center gap-1.5 text-[12px] text-texto-fraco", children: [_jsx("span", { "aria-hidden": "true", className: `size-1.5 shrink-0 ${p.online ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda'}` }), _jsx("span", { className: "truncate", children: p.online ? [p.sala ? `em ${nomeSala.get(p.sala) ?? 'outra sala'}` : 'online', p.jogo && `jogando ${p.jogo}`].filter(Boolean).join(' · ') : 'offline' })] })] })] }), _jsx("button", { type: "button", className: "btn btn-fant btn-icone", "aria-label": p.amigo ? `Remover ${p.nome} dos amigos` : `Adicionar ${p.nome} aos amigos`, title: p.amigo ? 'Remover amigo' : 'Adicionar amigo', onClick: () => onAmigo(p.id, !p.amigo), children: _jsx(Icone, { nome: p.amigo ? 'amigo-off' : 'amigo' }) })] }, p.id))) })] }, titulo))) }));
}
export function Vazio({ titulo, texto, children }) {
    return (_jsxs("div", { className: "flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center", children: [_jsx("b", { className: "font-display text-[28px]", children: titulo }), _jsx("span", { className: "max-w-[44ch] text-[14px] text-texto-fraco", children: texto }), children] }));
}
