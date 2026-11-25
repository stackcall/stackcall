import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { Icone } from './Icone';
export function CartaoPerfil({ pessoa, souEu = false, podeRemover = false, onAmigo, onRemover, onEditar, onFechar, comoDialogo = true }) {
    const [confirma, setConfirma] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (comoDialogo)
            ref.current?.focus();
    }, [comoDialogo]);
    const tema = pessoa.tema === 'noite' ? 'tema-noite' : pessoa.tema === 'lima' ? 'tema-lima' : '';
    const cor = pessoa.cor ?? 'var(--color-destaque)';
    const online = 'online' in pessoa ? pessoa.online : null;
    const amigo = 'amigo' in pessoa ? pessoa.amigo : null;
    const cartao = (_jsxs("div", { className: `janela w-[340px] max-w-full text-texto ${tema}`, children: [_jsxs("div", { className: "relative aspect-[3/1] border-b border-texto", style: { background: cor }, children: [pessoa.banner && _jsx("img", { src: pessoa.banner, alt: "", className: "h-full w-full object-cover" }), comoDialogo && (_jsx("button", { type: "button", "aria-label": "Fechar", onClick: onFechar, className: "btn btn-icone absolute right-2 top-2", children: _jsx(Icone, { nome: "fechar" }) }))] }), _jsxs("div", { className: "px-4 pb-4", children: [_jsx(Avatar, { pessoa: pessoa, tamanho: 88, className: "relative -mt-11 bg-superficie" }), _jsx("h2", { className: "mt-3 break-words text-[32px]", children: pessoa.nome }), _jsxs("p", { className: "rotulo mt-1 flex items-center gap-2", children: [_jsx("span", { children: pessoa.papel }), online !== null && (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": "true", children: "\u00B7" }), _jsx("span", { "aria-hidden": "true", className: "inline-block h-2 w-2 border border-texto", style: { background: online ? 'var(--color-lima)' : 'transparent' } }), _jsx("span", { children: online ? 'online' : 'offline' })] }))] }), _jsx("p", { className: `mt-3 whitespace-pre-wrap break-words text-sm ${pessoa.bio ? '' : 'text-texto-fraco'}`, children: pessoa.bio || 'Sem bio.' }), _jsxs("div", { className: "mt-4 flex flex-wrap gap-2", children: [souEu ? (_jsx("button", { type: "button", className: "btn", onClick: onEditar, children: "Editar perfil" })) : (amigo !== null && (_jsx("button", { type: "button", className: "btn", onClick: () => onAmigo?.(!amigo), children: amigo ? 'Remover amigo' : 'Adicionar amigo' }))), podeRemover && !souEu &&
                                (confirma ? (_jsx("button", { type: "button", className: "btn border-perigo text-perigo", onClick: onRemover, children: "Confirmar remo\u00E7\u00E3o" })) : (_jsx("button", { type: "button", className: "btn btn-fant", onClick: () => setConfirma(true), children: "Remover do servidor" })))] })] })] }));
    if (!comoDialogo)
        return cartao;
    return (_jsx("div", { className: "fixed inset-0 z-40 flex items-center justify-center bg-black/40", onClick: (e) => e.target === e.currentTarget && onFechar?.(), children: _jsx("div", { ref: ref, role: "dialog", "aria-modal": "true", "aria-label": `Perfil de ${pessoa.nome}`, tabIndex: -1, onKeyDown: (e) => e.key === 'Escape' && onFechar?.(), className: "outline-none", children: cartao }) }));
}
