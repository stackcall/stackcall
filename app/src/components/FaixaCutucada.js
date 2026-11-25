import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Avatar } from './Avatar';
import { Icone } from './Icone';
/**
 * Strip under the top bar for a poke received (prototype v05, #saguao). Stays until closed or
 * until the person enters the room. Shared by the lobby and the room.
 */
export function FaixaCutucada({ cutucada, silenciado, onEntrar, onCutucarDeVolta, onFechar }) {
    const { de, recado, salaNome } = cutucada;
    return (_jsxs("div", { role: "alert", "aria-label": `${de} te cutucou`, className: "flex min-h-[64px] shrink-0 items-stretch gap-4 border-2 border-destaque bg-superficie pr-2", children: [_jsx("span", { "aria-hidden": "true", className: "flex w-[52px] shrink-0 items-center justify-center bg-destaque text-sobre-destaque", children: _jsx(Icone, { nome: "voz", tamanho: 24 }) }), _jsx("span", { className: "flex items-center", children: _jsx(Avatar, { pessoa: { nome: de, avatar: null }, tamanho: 40 }) }), _jsxs("span", { className: "flex min-w-0 flex-1 flex-col justify-center py-2", children: [_jsxs("span", { className: "truncate text-[17px]", children: [_jsxs("b", { children: [de, " te cutucou", recado.trim() ? ':' : ''] }), recado.trim() && _jsxs(_Fragment, { children: [" \u201C", recado.trim(), "\u201D"] })] }), _jsx("span", { className: "truncate text-[13px] text-texto-fraco", children: [salaNome && `sala ${salaNome}`, 'agora', silenciado ? 'lido em voz alta com o seu som desligado' : 'lido em voz alta'].filter(Boolean).join(' · ') })] }), _jsxs("span", { className: "flex items-center gap-2", children: [onEntrar && salaNome && _jsxs("button", { type: "button", className: "btn btn-prim", onClick: onEntrar, children: [_jsx(Icone, { nome: "enviar" }), "Entrar na sala ", salaNome] }), onCutucarDeVolta && _jsx("button", { type: "button", className: "btn", onClick: onCutucarDeVolta, children: "Cutucar de volta" }), _jsx("button", { type: "button", className: "btn btn-icone", "aria-label": "Fechar cutucada", title: "Fechar", onClick: onFechar, children: _jsx(Icone, { nome: "fechar" }) })] })] }));
}
