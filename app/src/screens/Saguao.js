import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Faixa } from '../components/Faixa';
import { FaixaCutucada } from '../components/FaixaCutucada';
import { Icone } from '../components/Icone';
import { Topo } from '../components/Topo';
import { desdeQuando, duracaoJogo } from '../lib/jogo';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
/** The game most people in the room are playing, if any. */
function jogoDaSala(nela) {
    const conta = new Map();
    for (const p of nela)
        if (p.jogo)
            conta.set(p.jogo, (conta.get(p.jogo) ?? 0) + 1);
    return [...conta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
/** Re-renders once a minute so "jogando CS2 · 40 min" moves on; nothing else ticks. */
function useMinuto() {
    const [agora, setAgora] = useState(Date.now);
    useEffect(() => {
        const t = setInterval(() => setAgora(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);
    return agora;
}
/**
 * Lobby, out of voice (prototype v05, #saguao): the poke strip, rooms with who is there and
 * what they play, then the whole group with the detected game.
 */
export function Saguao(props) {
    const { salas, pessoas, eu, onSala, onCartao } = props;
    const agora = useMinuto();
    const porSala = new Map();
    for (const p of pessoas)
        if (p.online && p.sala && p.id !== eu.id)
            porSala.set(p.sala, [...(porSala.get(p.sala) ?? []), p]);
    const contagem = (s) => Math.max(s.pessoas, porSala.get(s.id)?.length ?? 0);
    const sugerida = salas.reduce((m, s) => (!m || contagem(s) > contagem(m) ? s : m), undefined)?.id;
    const emVoz = salas.reduce((n, s) => n + contagem(s), 0);
    const galera = pessoas.filter((p) => p.id !== eu.id)
        .sort((a, b) => Number(b.online) - Number(a.online) || Number(!!b.jogo) - Number(!!a.jogo) || a.nome.localeCompare(b.nome));
    const nomeSala = (id) => salas.find((s) => s.id === id)?.nome;
    return (_jsxs("div", { className: "grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-5 pt-4 pb-5", children: [_jsx(Topo, { nomeServidor: props.nomeServidor, salas: salas, sala: null, pessoas: pessoas, eu: eu, onSala: onSala, onConfig: props.onConfig, onPerfil: props.onPerfil }), _jsxs("main", { className: "flex min-h-0 flex-col gap-4 overflow-y-auto", children: [props.cutucada && (_jsx(FaixaCutucada, { cutucada: props.cutucada, silenciado: false, onFechar: props.onFecharCutucada, onEntrar: props.cutucada.salaId ? () => onSala(props.cutucada.salaId) : undefined })), _jsxs("header", { className: "flex flex-wrap items-end justify-between gap-x-6 gap-y-2", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("span", { className: "rotulo", children: ["/ ", props.nomeServidor, " \u00B7 fora da voz"] }), _jsx("h1", { className: "text-[56px]", children: "Escolha uma sala" }), _jsx("p", { className: "m-0 text-texto-fraco", children: emVoz ? `${plural(emVoz, 'pessoa', 'pessoas')} em voz agora. Entre numa sala para falar, assistir e conversar.` : 'Ninguém em voz agora. Entre numa sala e chame a galera.' })] }), _jsx(Convidar, { podeConvidar: eu.papel === 'dono' || eu.papel === 'admin', onConvidar: props.onConvidar })] }), salas.length === 0 ? (_jsxs("div", { className: "janela p-5", children: [_jsx("b", { className: "font-display text-[28px]", children: "Nenhuma sala ainda" }), _jsx("p", { className: "m-0 text-texto-fraco", children: "O dono ou um admin cria as salas em Configura\u00E7\u00F5es \u203A Servidor \u203A Salas." })] })) : (_jsx("section", { "aria-label": "Salas", className: "grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3", children: salas.map((s) => {
                            const nela = porSala.get(s.id) ?? [];
                            const n = contagem(s);
                            const jogo = jogoDaSala(nela);
                            return (_jsxs("article", { "aria-label": `Sala ${s.nome}`, className: "janela flex flex-col", children: [_jsxs("div", { className: `barra ${s.noAr ? 'barra-ar' : ''}`, children: [_jsx("span", { className: "truncate", children: s.nome }), _jsx("span", { className: "ml-auto font-medium", children: s.noAr ? `no ar · ${n}` : n ? `${n} na sala` : 'vazia' })] }), n ? (_jsxs(_Fragment, { children: [_jsxs("ul", { className: "m-0 flex list-none flex-wrap gap-1.5 px-3 pt-3 pb-0", "aria-label": `Quem está na sala ${s.nome}`, children: [nela.slice(0, 8).map((p) => (_jsx("li", { children: _jsx("button", { type: "button", className: "border-0 bg-transparent p-0", onClick: () => onCartao(p.id), "aria-label": `Ver perfil de ${p.nome}`, title: p.nome, children: _jsx(Avatar, { pessoa: p, tamanho: 36 }) }) }, p.id))), nela.length > 8 && _jsxs("li", { className: "self-center text-[13px] text-texto-fraco", children: ["+", nela.length - 8] })] }), _jsxs("p", { className: "m-0 px-3 pt-2 pb-3 text-[13px] text-texto-fraco", children: [jogo ? _jsx("b", { className: "text-texto", children: jogo }) : 'só conversa', s.noAr && ' · tem tela no ar'] })] })) : (_jsx("p", { className: "m-0 min-h-[76px] p-3 text-[13px] text-texto-fraco", children: "Ningu\u00E9m aqui. Quem entra primeiro abre a conversa." })), _jsx("div", { className: "mt-auto px-3 pb-3", children: _jsxs("button", { type: "button", className: `btn w-full ${s.id === sugerida ? 'btn-prim' : ''}`, onClick: () => onSala(s.id), children: ["Entrar na sala ", s.nome] }) })] }, s.id));
                        }) })), _jsxs("section", { "aria-label": "Galera", className: "janela flex shrink-0 flex-col", children: [_jsxs("div", { className: "barra", children: [props.nomeServidor, " \u00B7 ", plural(galera.filter((p) => p.online).length, 'online', 'online'), _jsx("span", { className: "ml-auto font-medium", children: plural(pessoas.length, 'membro', 'membros') })] }), galera.length === 0 ? (_jsx("p", { className: "m-0 p-4 text-[14px] text-texto-fraco", children: "S\u00F3 voc\u00EA por aqui. Gere um convite e mande no grupo." })) : (_jsx("ul", { className: "m-0 grid list-none grid-cols-2 content-start gap-x-6 p-0 px-3 py-1 max-[900px]:grid-cols-1", children: galera.map((p) => {
                                    const local = p.online ? (p.sala ? `na sala ${nomeSala(p.sala) ?? ''}` : 'fora da voz') : '—';
                                    return (_jsx("li", { className: "border-b border-borda", children: _jsxs("button", { type: "button", onClick: () => onCartao(p.id), "aria-label": `Ver perfil de ${p.nome}`, className: `flex min-h-[52px] w-full items-center gap-2.5 border-0 bg-transparent px-1 text-left text-texto hover:bg-superficie-alta ${p.online ? '' : 'opacity-55'}`, children: [_jsx(Avatar, { pessoa: p, tamanho: 28 }), _jsx("b", { className: "shrink-0 text-[14px]", children: p.nome }), _jsx("span", { className: "min-w-0 flex-1 truncate text-[13px] text-texto-fraco", children: p.online && p.jogo ? (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": "true", className: "mr-1.5 inline-block size-[7px] bg-lima outline outline-1 outline-texto align-[1px]" }), "jogando ", p.jogo, " \u00B7 ", duracaoJogo(agora - desdeQuando(p.id, p.jogo, agora))] })) : p.online ? 'online' : 'offline' }), _jsx("span", { className: "rotulo shrink-0", children: local })] }) }, p.id));
                                }) }))] })] })] }));
}
/** Invite button for the owner and admins (the porteiro answers 403 to the others). */
function Convidar({ podeConvidar, onConvidar }) {
    const [estado, setEstado] = useState('');
    if (!podeConvidar)
        return null;
    async function convidar() {
        setEstado('gerando');
        try {
            await onConvidar();
            setEstado('copiado');
        }
        catch (e) {
            setEstado({ erro: e instanceof Error ? e.message : String(e) });
        }
    }
    return (_jsxs("div", { className: "flex flex-col items-end gap-1.5", children: [_jsxs("span", { className: "flex items-center gap-3", children: [estado === 'copiado' && _jsx("span", { role: "status", className: "text-[14px] text-texto-fraco", children: "Link copiado." }), _jsxs("button", { type: "button", className: "btn", disabled: estado === 'gerando', onClick: () => void convidar(), children: [_jsx(Icone, { nome: "link" }), estado === 'gerando' ? 'Gerando…' : 'Convidar'] })] }), typeof estado === 'object' && (_jsxs(Faixa, { acoes: [{ rotulo: 'Tentar de novo', onClick: () => void convidar() }], onFechar: () => setEstado(''), children: ["N\u00E3o deu para gerar o convite. ", estado.erro] }))] }));
}
