import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
// shortcut: short list of known games by process; widen it (or use a fullscreen hint from the core) when people ask.
const GAMES = new Set([
    'cs2.exe', 'valorant-win64-shipping.exe', 'league of legends.exe', 'dota2.exe', 'r5apex.exe', 'r5apex_dx12.exe',
    'fortniteclient-win64-shipping.exe', 'overwatch.exe', 'rocketleague.exe', 'gta5.exe', 'gta5_enhanced.exe',
    'eldenring.exe', 'minecraft.windows.exe', 'cod.exe', 'marvel-win64-shipping.exe', 'deadlock.exe', 'project8.exe',
]);
export const kindOf = (s) => !s.pid ? 'tela' : GAMES.has((s.process_name ?? '').toLowerCase()) ? 'jogo' : 'janela';
/** Last source by process and title (window ids change every run), else the main monitor. */
export function initialSource(list, saved) {
    const same = saved && (list.find((s) => s.process_name === saved.process_name && s.title === saved.title)
        ?? (saved.process_name ? list.find((s) => s.process_name === saved.process_name) : undefined));
    return same ?? list.find((s) => !s.pid && s.primary) ?? list.find((s) => !s.pid) ?? list[0];
}
const FILTERS = [['tudo', 'Tudo'], ['tela', 'Telas'], ['janela', 'Janelas'], ['jogo', 'Jogos']];
const GROUPS = [['tela', 'Telas'], ['jogo', 'Jogos'], ['janela', 'Janelas']];
export function Fontes({ sources, loading, selected, disabled, refreshDisabled, searchRef, onSelect, onRefresh, onEnter }) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('tudo');
    const [showAll, setShowAll] = useState(false);
    const tiles = useRef(new Map());
    // Hygiene: tiny windows and repeated titles stay hidden until "Mostrar todas".
    const seen = new Set();
    let hidden = 0;
    const kept = (sources ?? []).filter((s) => {
        if (!s.pid || s.id === selected)
            return true;
        const key = `${s.process_name}|${s.title}`;
        const tiny = !s.minimized && s.width !== null && s.height !== null && (s.width < 200 || s.height < 100);
        const repeated = seen.has(key);
        seen.add(key);
        if ((tiny || repeated) && !showAll)
            hidden++;
        return showAll || !(tiny || repeated);
    });
    const q = query.trim().toLowerCase();
    const filtered = !!q || filter !== 'tudo';
    const visible = kept.filter((s) => (filter === 'tudo' || kindOf(s) === filter)
        && (!q || s.title.toLowerCase().includes(q) || (s.process_name ?? '').toLowerCase().includes(q)));
    const groups = GROUPS.map(([kind, label]) => ({
        kind, label,
        items: visible.filter((s) => kindOf(s) === kind).sort((a, b) => (kind === 'janela' ? a.title.localeCompare(b.title, 'pt-BR') : 0)),
    })).filter((g) => g.items.length);
    const order = groups.flatMap((g) => g.items);
    const tabStop = order.some((s) => s.id === selected) ? selected : order[0]?.id;
    function onKey(event) {
        const index = order.findIndex((s) => s.id === event.target.dataset.id);
        if (index < 0)
            return;
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            return onEnter();
        }
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step)
            return;
        event.preventDefault();
        const next = order[(index + step + order.length) % order.length];
        if (!disabled)
            onSelect(next);
        tiles.current.get(next.id)?.focus();
    }
    return (_jsxs("section", { "aria-label": "Fonte", className: "janela flex min-h-0 min-w-0 flex-col", children: [_jsxs("div", { className: "barra", children: ["Fonte", sources ? ` · ${kept.length}` : '', _jsx("button", { type: "button", disabled: refreshDisabled || loading, onClick: onRefresh, className: "ml-auto border-0 bg-transparent font-mono text-[11px] font-bold text-superficie uppercase underline disabled:opacity-50", children: loading && sources ? 'Atualizando…' : 'Atualizar' })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-texto p-2", children: [_jsx("input", { ref: searchRef, type: "search", className: "campo min-w-[150px] flex-1", placeholder: "Buscar tela ou janela", "aria-label": "Buscar tela ou janela", value: query, onChange: (e) => setQuery(e.target.value) }), _jsx("div", { className: "abas", role: "group", "aria-label": "Tipo de fonte", children: FILTERS.map(([id, label]) => (_jsx("button", { type: "button", "aria-pressed": filter === id, onClick: () => setFilter(id), children: label }, id))) })] }), _jsxs("div", { role: "radiogroup", "aria-label": "Telas e janelas", "aria-busy": !sources, onKeyDown: onKey, className: "min-h-0 flex-1 overflow-y-auto px-3 pb-3", children: [!sources && (_jsx("div", { className: "grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 pt-3", children: [0, 1, 2, 3, 4, 5].map((n) => _jsx("span", { className: "skeleton aspect-[16/11]" }, n)) })), sources && !order.length && (_jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-2 py-6 text-center", children: [_jsx("b", { className: "text-[15px]", children: filtered ? 'Nada com esse filtro' : 'Nenhuma janela encontrada' }), _jsx("span", { className: "text-[13px] text-texto-fraco", children: filtered ? 'Limpe a busca ou escolha Tudo.' : 'Abra o jogo e toque em Atualizar.' }), filtered
                                ? _jsx("button", { type: "button", className: "btn", onClick: () => { setQuery(''); setFilter('tudo'); }, children: "Limpar filtro" })
                                : _jsx("button", { type: "button", className: "btn", disabled: refreshDisabled || loading, onClick: onRefresh, children: "Atualizar" })] })), groups.map((g) => (_jsxs("div", { children: [_jsxs("h3", { className: "rotulo sticky top-0 z-[2] m-0 -mx-3 border-b border-borda bg-superficie px-3 py-1.5 text-[11px]", children: [g.label, " \u00B7 ", g.items.length] }), _jsx("div", { className: "grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 pt-2", children: g.items.map((s) => (_jsx(Tile, { source: s, on: s.id === selected, tabStop: s.id === tabStop, disabled: disabled, register: (el) => { if (el)
                                        tiles.current.set(s.id, el);
                                    else
                                        tiles.current.delete(s.id); }, onSelect: () => onSelect(s) }, s.id))) })] }, g.kind))), hidden > 0 && (_jsxs("button", { type: "button", className: "mt-3 border-0 bg-transparent p-0 text-[13px] text-texto-fraco underline", onClick: () => setShowAll(true), children: ["Mostrar todas (", hidden, " ", hidden === 1 ? 'oculta' : 'ocultas', ")"] }))] })] }));
}
function Tile({ source: s, on, tabStop, disabled, register, onSelect }) {
    const dims = s.width !== null && s.height !== null ? `${s.width}×${s.height}` : '';
    // Cover fills the 16:9 frame; contain only when the shape is far from it (portrait, ultrawide).
    const ratio = s.width && s.height ? s.width / s.height : 16 / 9;
    const fit = Math.abs(ratio - 16 / 9) < 0.4 ? 'object-cover' : 'object-contain';
    return (_jsxs("button", { ref: register, type: "button", role: "radio", "aria-checked": on, "data-id": s.id, tabIndex: tabStop ? 0 : -1, disabled: disabled, title: [s.title, s.process_name, dims].filter(Boolean).join(' · '), onClick: onSelect, className: "relative flex min-w-0 flex-col border border-texto bg-superficie p-0 text-left hover:bg-superficie-alta active:translate-y-px", children: [_jsxs("span", { className: "relative block aspect-video w-full overflow-hidden border-b border-texto bg-palco", children: [s.thumbnail && !s.minimized
                        ? _jsx("img", { alt: "", className: `absolute inset-0 size-full ${fit}`, src: `data:image/png;base64,${s.thumbnail}` })
                        : _jsx("span", { className: "absolute inset-0 flex items-center justify-center px-2 text-center text-[12px] text-[#b3b3ab]", children: s.minimized ? 'Minimizada' : 'Sem prévia' }), on && _jsx("span", { className: "absolute top-0 left-0 bg-destaque px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-sobre-destaque", children: "Escolhida" })] }), _jsxs("span", { className: "flex h-9 min-w-0 items-center gap-2 px-2.5", children: [_jsx("b", { className: "truncate text-[13px]", children: s.title }), _jsx("span", { className: "rotulo ml-auto shrink-0 text-[10px]", children: dims })] }), s.minimized && _jsx("span", { className: "px-2.5 pb-2 text-[12px] leading-tight text-texto-fraco", children: "Minimizada: volte ao jogo antes de entrar no ar" }), on && _jsx("span", { "aria-hidden": "true", className: "pointer-events-none absolute inset-0 border-[3px] border-destaque" })] }));
}
