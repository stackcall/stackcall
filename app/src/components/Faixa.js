import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icone } from './Icone';
/**
 * Notice strip with an exit: errors get "Tentar de novo", questions get their answers.
 * `erro` is an alert (read at once); `aviso` is a polite status.
 */
export function Faixa({ tipo = 'erro', children, acoes = [], onFechar, className = '' }) {
    const erro = tipo === 'erro';
    return (_jsxs("div", { role: erro ? 'alert' : 'status', className: `flex min-h-11 items-center gap-3 border py-1 pr-1 pl-3 text-[14px] ${erro ? 'faixa-erro' : 'border-texto bg-superficie-alta text-texto'} ${className}`, children: [_jsx("span", { "aria-hidden": "true", className: "font-display shrink-0 text-[18px] leading-none", children: erro ? '!' : 'i' }), _jsx("span", { className: "min-w-0 flex-1", children: children }), acoes.map((a) => (_jsx("button", { type: "button", className: `btn btn-sm ${a.principal ? 'btn-prim' : ''}`, onClick: a.onClick, children: a.rotulo }, a.rotulo))), onFechar && (_jsx("button", { type: "button", className: "btn btn-fant btn-icone btn-sm", "aria-label": "Fechar aviso", title: "Fechar", onClick: onFechar, children: _jsx(Icone, { nome: "fechar", tamanho: 16 }) }))] }));
}
