import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useId } from 'react';
/** Page header of Settings: data label, headline, one line of description. */
export function Cabecalho({ rotulo, titulo, children }) {
    return (_jsxs("header", { className: "flex flex-col gap-1.5", children: [rotulo && _jsxs("span", { className: "rotulo", children: ["/ ", rotulo] }), _jsx("h1", { className: "text-[52px]", children: titulo }), children && _jsx("p", { className: "m-0 max-w-[72ch] text-texto-fraco", children: children })] }));
}
/**
 * One setting as a window row: name, one sentence of what changes, the control on the right.
 * `ajuste` is the search id (lib/buscaConfig.ts); `destaque` outlines it after a search.
 */
export function Linha({ ajuste, titulo, descricao, children, destaque, coluna = false }) {
    const id = useId();
    return (_jsxs("section", { "data-ajuste": ajuste, "aria-labelledby": id, className: `janela flex gap-x-6 gap-y-3 px-4 py-3.5 ${coluna ? 'flex-col' : 'flex-wrap items-center justify-between'} ${destaque ? 'outline-2 outline-offset-2 outline-destaque' : ''}`, children: [_jsxs("span", { className: "flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5", children: [_jsx("b", { id: id, className: "text-[15px]", children: titulo }), descricao && _jsx("span", { className: "text-[13.5px] text-texto-fraco", children: descricao })] }), children] }));
}
/** On/off switch: ink track, lime knob when on; the text says the state. */
export function Chave({ ligado, rotulo, onMudar, disabled, textos = ['Ligado', 'Desligado'] }) {
    return (_jsxs("button", { type: "button", role: "switch", "aria-checked": ligado, "aria-label": rotulo, disabled: disabled, onClick: () => onMudar(!ligado), className: "flex min-h-11 shrink-0 items-center gap-2.5 border-0 bg-transparent px-1 text-[13px] font-bold text-texto disabled:text-texto-fraco", children: [_jsx("span", { "aria-hidden": "true", className: `relative h-5 w-[38px] border border-texto ${ligado ? 'bg-texto' : 'bg-superficie'}`, children: _jsx("span", { className: `absolute top-[3px] size-3 ${ligado ? 'left-[21px] bg-lima' : 'left-[3px] bg-texto'}` }) }), _jsx("span", { className: "w-[72px] text-left", children: ligado ? textos[0] : textos[1] })] }));
}
/** Segmented choice (abas): the chosen one in ink, never red. */
export function Segmento({ valor, opcoes, rotulo, onMudar, disabled }) {
    return (_jsx("div", { className: "abas shrink-0", role: "group", "aria-label": rotulo, children: opcoes.map(([v, texto]) => (_jsx("button", { type: "button", "aria-pressed": valor === v, disabled: disabled, onClick: () => onMudar(v), children: texto }, String(v)))) }));
}
/** Range with its value next to it (tabular), for volume and opacity. */
export function Deslizante({ valor, min, max, passo = 1, rotulo, sufixo = '%', onMudar, disabled }) {
    return (_jsxs("span", { className: "flex shrink-0 items-center gap-3", children: [_jsxs("span", { className: "rotulo tabular-nums", children: [min, sufixo] }), _jsx("input", { type: "range", min: min, max: max, step: passo, value: valor, "aria-label": rotulo, disabled: disabled, "aria-valuetext": `${valor}${sufixo}`, onChange: (e) => onMudar(Number(e.target.value)), className: "h-11 w-36 accent-texto" }), _jsxs("span", { className: "rotulo tabular-nums", children: [max, sufixo] }), _jsxs("b", { className: "w-12 text-right font-mono text-[13px] tabular-nums", children: [valor, sufixo] })] }));
}
