import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
import { Icone } from '../../components/Icone';
import { fraseCutucada } from '../../lib/cutucar';
import { esperaCutucar, lembrarUltimo, LIMITE_RECADO, marcarCutucada, SUGESTOES } from '../../lib/cutucadas';
import { ApiError } from '../../lib/servidor';
import { Popover } from './Popover';
/**
 * Small poke field over the person's channel: message up to 80 characters with a counter, three quick
 * suggestions, the exact sentence the person will hear and the 30 s limit. Enter sends; Esc closes.
 */
export function Cutucar({ ancora, alvo, eu, servidor, somDesligado, onFechar, onEnviada }) {
    const [recado, setRecado] = useState('');
    const [estado, setEstado] = useState('');
    const espera = esperaCutucar(alvo.id);
    async function enviar(e) {
        e?.preventDefault();
        if (estado === 'enviando' || espera > 0)
            return;
        setEstado('enviando');
        try {
            await servidor.cutucar(alvo.id, recado.trim());
            marcarCutucada(alvo.id);
            lembrarUltimo(alvo.id);
            onEnviada();
            onFechar();
        }
        catch (x) {
            if (x instanceof ApiError && x.status === 429)
                marcarCutucada(alvo.id);
            setEstado({ erro: x instanceof ApiError && x.status === 403 ? `${alvo.nome} não recebe cutucadas agora.` : x instanceof Error ? x.message : String(x) });
        }
    }
    return (_jsx(Popover, { ancora: ancora, onFechar: onFechar, rotulo: `Cutucar ${alvo.nome}`, className: "flex w-[416px] flex-col", children: _jsxs("form", { onSubmit: (e) => void enviar(e), children: [_jsxs("div", { className: "barra", children: [_jsxs("span", { className: "truncate", children: ["Cutucar ", alvo.nome] }), somDesligado && _jsx("span", { className: "ml-auto font-medium", children: "som desligado \u00B7 ouve mesmo assim" })] }), _jsxs("div", { className: "flex flex-col gap-2.5 p-3", children: [_jsxs("label", { className: "flex h-11 items-center gap-2 border border-destaque px-3 focus-within:outline-2 focus-within:outline-destaque", children: [_jsx("span", { className: "sr-only", children: "Recado" }), _jsx("input", { autoFocus: true, className: "min-w-0 flex-1 border-0 bg-transparent text-[15px] text-texto outline-none", value: recado, maxLength: LIMITE_RECADO, placeholder: "Recado (opcional)", onChange: (e) => setRecado(e.target.value) }), _jsxs("span", { className: "font-mono text-[12px] text-texto-fraco tabular-nums", "aria-label": `${recado.length} de ${LIMITE_RECADO} caracteres`, children: [recado.length, "/", LIMITE_RECADO] })] }), _jsx("div", { className: "flex flex-wrap gap-2", role: "group", "aria-label": "Recados r\u00E1pidos", children: SUGESTOES.map((s) => (_jsx("button", { type: "button", "aria-pressed": recado === s, onClick: () => setRecado(s), className: `btn btn-sm font-medium ${recado === s ? 'bg-texto text-superficie' : ''}`, children: s }, s))) }), _jsxs("p", { className: "m-0 flex items-start gap-2 text-[13px] text-texto-fraco", children: [_jsx(Icone, { nome: "volume", tamanho: 16 }), _jsxs("span", { children: [alvo.nome, " vai ouvir: ", _jsxs("b", { className: "text-texto", children: ["\u201C", fraseCutucada({ de: eu, recado }), "\u201D"] })] })] }), typeof estado === 'object' && _jsx("p", { role: "alert", className: "m-0 text-[13px] font-bold text-perigo", children: estado.erro })] }), _jsxs("div", { className: "flex items-center gap-2 border-t border-borda p-3", children: [_jsx("span", { className: "rotulo mr-auto text-[11px] leading-tight", children: espera > 0 ? `Pode cutucar de novo em ${espera} s` : 'Uma cutucada a cada 30 s para a mesma pessoa' }), _jsx("button", { type: "button", className: "btn btn-sm", onClick: onFechar, children: "Cancelar" }), _jsxs("button", { type: "submit", className: "btn btn-sm btn-prim", disabled: estado === 'enviando' || espera > 0, children: [_jsx(Icone, { nome: "cutuca", tamanho: 16 }), estado === 'enviando' ? 'Cutucando…' : 'Cutucar'] })] })] }) }));
}
