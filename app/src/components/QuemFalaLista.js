import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { corDe, inicial } from './Avatar';
import { linhasQuemFala } from '../lib/quemfala';
/** Row height and type per size; the core sizes the window from LARGURA_QUEM_FALA. */
const ESCALA = { p: { linha: 26, avatar: 16, fonte: 12 }, m: { linha: 32, avatar: 20, fonte: 13.5 }, g: { linha: 40, avatar: 26, fonte: 16 } };
/**
 * Content of the "quem fala" window (and its preview in Settings). Always dark: it sits over a
 * game. Static marks only, no continuous animation: it repaints when the room state changes.
 */
export function QuemFalaLista({ estado, prefs, largura }) {
    const e = ESCALA[prefs.quemFalaTamanho];
    const linhas = linhasQuemFala(estado, prefs.quemFalaConteudo);
    // "Só quem fala" with nobody speaking: nothing at all, not even the frame.
    if (!estado || (prefs.quemFalaConteudo === 'falando' && !linhas.length))
        return null;
    return (_jsxs("div", { "aria-label": "Quem est\u00E1 falando", style: { opacity: prefs.quemFalaOpacidade / 100, width: largura, fontSize: e.fonte }, className: "flex flex-col border border-[rgba(244,244,241,0.55)] bg-[rgba(16,16,18,0.86)] text-[#f4f4f1]", children: [_jsx("ul", { className: "m-0 list-none p-0", children: linhas.map((p) => (_jsxs("li", { className: `flex items-center gap-2 px-2 ${p.falando ? '' : 'opacity-60'}`, style: { height: e.linha }, children: [_jsx("span", { "aria-hidden": "true", className: `font-display flex shrink-0 items-center justify-center border border-[#111] text-[#111] ${p.falando ? 'outline-2 outline-offset-1 outline-lima' : ''}`, style: { width: e.avatar, height: e.avatar, fontSize: Math.round(e.avatar * 0.55), background: p.cor ?? corDe(p.nome) }, children: inicial(p.nome) }), _jsx("b", { className: `min-w-0 flex-1 truncate ${p.falando ? 'text-lima' : ''}`, children: p.nome }), p.falando && _jsx("span", { className: "sr-only", children: "falando" }), p.falando && _jsx("span", { "aria-hidden": "true", className: "h-2 w-6 shrink-0 bg-[repeating-linear-gradient(90deg,var(--color-lima)_0_4px,transparent_4px_6px)]" }), p.mudo && _jsx("span", { className: "shrink-0 font-mono text-[10px] font-bold uppercase text-[#ff7a6b]", children: "mudo" })] }, p.id))) }), _jsxs("div", { className: "flex items-center justify-between gap-2 border-t border-[rgba(244,244,241,0.3)] px-2 py-1 font-mono text-[10.5px] font-medium uppercase text-[#b3b3ab]", children: [_jsxs("span", { className: "truncate", children: [estado.sala, estado.ping !== null && ` · ${estado.ping} ms`] }), estado.replay && _jsx("span", { className: "text-[#ff7a6b]", children: "\u25CF replay" })] })] }));
}
