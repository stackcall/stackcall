import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { Icone } from '../components/Icone';
import { replay as nucleo } from '../lib/nucleo';
const gb = (b) => (b / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function quando(seg) {
    const d = new Date(seg * 1000);
    const hoje = new Date();
    const ontem = new Date(Date.now() - 86_400_000);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString())
        return `hoje ${hora}`;
    if (d.toDateString() === ontem.toDateString())
        return 'ontem';
    return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
}
/**
 * Clip gallery (film icon on the top bar): the clips saved on this PC, the space used, open the
 * folder and delete. Cutting by track and sending to the chat come with the core contract.
 */
export function Clipes({ onFechar, onReplay }) {
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState();
    const [filtro, setFiltro] = useState('todos');
    const [aberto, setAberto] = useState(null);
    const [apagar, setApagar] = useState(false);
    const carregar = () => {
        setErro(undefined);
        nucleo.listarClipes().then((d) => {
            setDados(d);
            setAberto((a) => a ?? d.clipes[0]?.id ?? null);
        }, (e) => setErro(`Não deu para ler os clipes. ${e instanceof Error ? e.message : String(e)}`));
    };
    useEffect(carregar, []);
    useEffect(() => {
        const esc = (e) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && onFechar();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onFechar]);
    const todos = dados?.clipes ?? [];
    const meus = todos.filter((c) => c.autor === 'você');
    const lista = filtro === 'meus' ? meus : filtro === 'recebidos' ? todos.filter((c) => c.autor !== 'você') : todos;
    const clipe = todos.find((c) => c.id === aberto);
    const cheio = dados ? dados.usados_bytes >= dados.limite_bytes : false;
    async function apagarClipe(c) {
        setApagar(false);
        try {
            await nucleo.apagarClipe(c.id);
            setAberto(null);
            carregar();
        }
        catch (e) {
            setErro(`Não deu para apagar o clipe. ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return (_jsxs("div", { role: "region", "aria-label": "Clipes", className: "absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)_540px] gap-4 bg-fundo px-5 pt-4 pb-5 max-[1280px]:grid-cols-[minmax(0,1fr)_420px]", children: [_jsxs("section", { className: "flex min-h-0 flex-col gap-3", children: [_jsxs("header", { className: "flex items-start gap-4", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "rotulo", children: "/ Clipes \u00B7 salvos neste PC" }), _jsx("h1", { className: "text-[56px]", children: "Clipes" })] }), dados && (_jsxs("div", { className: `janela ml-auto flex w-[310px] flex-col ${cheio ? 'border-perigo' : ''}`, "aria-label": "Espa\u00E7o", children: [_jsxs("div", { className: `barra ${cheio ? 'barra-ar' : 'barra-lima'}`, children: ["Espa\u00E7o", _jsxs("span", { className: "ml-auto font-medium", children: ["limite ", gb(dados.limite_bytes), " GB"] })] }), _jsxs("div", { className: "flex flex-col gap-1.5 px-3 py-2", children: [_jsxs("span", { className: "flex items-center gap-3", children: [_jsx("b", { className: "font-display text-[36px] leading-none tabular-nums", children: gb(dados.usados_bytes) }), _jsx("span", { className: "rotulo", children: "GB" }), _jsx("span", { className: "h-2.5 flex-1 border border-texto", "aria-hidden": "true", children: _jsx("span", { className: "block h-full bg-texto", style: { width: `${Math.min(100, (dados.usados_bytes / dados.limite_bytes) * 100)}%` } }) })] }), _jsx("span", { className: `text-[12px] ${cheio ? 'font-bold text-perigo' : 'text-texto-fraco'}`, children: cheio ? `Limite de ${gb(dados.limite_bytes)} GB cheio. O clipe mais antigo vai sair no próximo.` : `${todos.length} clipes · o mais antigo sai quando encher` })] })] })), _jsx("button", { type: "button", className: "btn btn-icone", "aria-label": "Fechar clipes", title: "Fechar (Esc)", onClick: onFechar, children: _jsx(Icone, { nome: "fechar" }) })] }), erro && _jsx(Faixa, { acoes: [{ rotulo: 'Tentar de novo', onClick: carregar }], onFechar: () => setErro(undefined), children: erro }), _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx("div", { className: "abas", role: "group", "aria-label": "Filtro", children: [['todos', `Todos · ${todos.length}`], ['meus', `Meus · ${meus.length}`], ['recebidos', `Recebidos · ${todos.length - meus.length}`]].map(([id, t]) => (_jsx("button", { type: "button", "aria-pressed": filtro === id, onClick: () => setFiltro(id), children: t }, id))) }), _jsxs("button", { type: "button", className: "btn btn-fant ml-auto", onClick: () => void nucleo.abrirPastaClipes(), children: [_jsx(Icone, { nome: "pasta" }), "Abrir pasta"] })] }), dados === null && !erro ? (_jsx("div", { className: "grid grid-cols-3 gap-3", "aria-busy": "true", children: [0, 1, 2].map((i) => _jsx("div", { className: "skeleton h-[160px]" }, i)) })) : todos.length === 0 ? (_jsxs("div", { className: "janela flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center", children: [_jsx("b", { className: "font-display text-[28px]", children: "Nenhum clipe ainda" }), _jsx("span", { className: "max-w-[48ch] text-[14px] text-texto-fraco", children: "Ligue o replay e use o bot\u00E3o Clipe depois de uma jogada boa." }), _jsxs("button", { type: "button", className: "btn btn-prim", onClick: onReplay, children: [_jsx(Icone, { nome: "replay" }), "Ligar replay"] })] })) : (_jsx("ul", { className: "m-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-y-auto p-0 pb-1", children: lista.map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", "aria-pressed": c.id === aberto, onClick: () => { setAberto(c.id); setApagar(false); }, className: `janela flex w-full flex-col p-0 text-left ${c.id === aberto ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : 'hover:bg-superficie-alta'}`, children: [_jsx("span", { className: "relative block aspect-video w-full bg-palco", children: _jsx("span", { className: "absolute top-2 right-2 bg-texto px-1.5 py-0.5 font-mono text-[12px] font-bold text-superficie", children: dur(c.duracao_s) }) }), _jsxs("span", { className: "flex flex-col gap-0.5 border-t border-texto px-3 py-2", children: [_jsx("b", { className: "truncate text-[15px]", children: c.titulo }), _jsx("span", { className: "truncate text-[12px] text-texto-fraco", children: [c.autor, c.jogo, quando(c.criado_em)].filter(Boolean).join(' · ') })] })] }) }, c.id))) }))] }), _jsx("aside", { className: "janela flex min-h-0 flex-col", "aria-label": "Clipe aberto", children: clipe ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "barra", children: [_jsx("span", { className: "truncate", children: clipe.titulo }), _jsxs("span", { className: "ml-auto font-medium normal-case", children: [dur(clipe.duracao_s), " \u00B7 ", Math.round(clipe.bytes / 1e6), " MB"] })] }), _jsx("div", { className: "relative grid min-h-0 flex-1 place-items-center bg-palco", children: clipe.url ? _jsx("video", { src: clipe.url, controls: true, className: "absolute inset-0 size-full object-contain" }, clipe.id)
                                : _jsx("span", { className: "px-6 text-center text-[14px] text-sobre-palco", children: "A pr\u00E9via aparece no app instalado." }) }), _jsx("div", { className: "flex flex-col gap-2 border-t border-texto p-3", children: apagar ? (_jsxs("div", { role: "alertdialog", "aria-label": "Apagar clipe", className: "flex flex-wrap items-center gap-2 border border-perigo p-2.5", children: [_jsxs("span", { className: "flex-1 text-[13px]", children: ["Apagar ", _jsx("b", { children: clipe.titulo }), " deste PC? N\u00E3o d\u00E1 para desfazer."] }), _jsx("button", { type: "button", className: "btn btn-sm border-perigo text-perigo", onClick: () => void apagarClipe(clipe), children: "Apagar" }), _jsx("button", { type: "button", className: "btn btn-sm", onClick: () => setApagar(false), children: "Cancelar" })] })) : (_jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { type: "button", className: "btn flex-1", onClick: () => void nucleo.abrirPastaClipes(clipe.id), children: [_jsx(Icone, { nome: "pasta" }), "Mostrar na pasta"] }), _jsx("button", { type: "button", className: "btn btn-icone text-perigo", "aria-label": `Apagar ${clipe.titulo}`, title: "Apagar", onClick: () => setApagar(true), children: _jsx(Icone, { nome: "lixo" }) })] })) })] })) : (_jsx("p", { className: "m-auto px-6 text-center text-[14px] text-texto-fraco", children: "Escolha um clipe para ver aqui." })) })] }));
}
