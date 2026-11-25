import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
export function updateButtonLabel(updater, inCall) {
    if (updater.status === 'downloading')
        return `Baixando ${Math.round((updater.progress ?? 0) * 100)}%`;
    if (updater.status === 'installing')
        return 'Instalando…';
    return inCall ? 'Atualizar ao sair da sala' : 'Atualizar e reiniciar';
}
/** Slim lime strip (40 px); "Depois" hides it until the app opens again, so it never sits over a match. */
export function UpdateBanner({ updater, inCall, room, onNotes }) {
    const [depois, setDepois] = useState(null);
    if (!updater.available || depois === updater.available.version)
        return null;
    const busy = updater.status === 'downloading' || updater.status === 'installing';
    return (_jsxs("div", { role: "status", className: "flex min-h-10 shrink-0 items-center gap-3 border-b border-texto bg-lima px-5 text-[14px] text-sobre-lima", children: [_jsxs("span", { children: [_jsxs("b", { children: ["Stackcall ", updater.available.version] }), " est\u00E1 dispon\u00EDvel."] }), _jsx("button", { type: "button", onClick: onNotes, className: "border-0 bg-transparent p-0 font-bold text-sobre-lima underline underline-offset-2", children: "Ver novidades" }), updater.status === 'error' && _jsxs("span", { className: "font-bold", children: ["Falhou: ", updater.error] }), _jsx("span", { className: "ml-auto" }), updater.waitingForLeave ? (_jsxs("span", { children: ["Instala quando voc\u00EA sair da sala", room ? ` ${room}` : '', "."] })) : (_jsx("button", { type: "button", disabled: busy, onClick: () => void updater.apply(), className: "btn btn-sm", children: updateButtonLabel(updater, inCall) })), !busy && _jsx("button", { type: "button", onClick: () => setDepois(updater.available.version), className: "btn btn-sm btn-fant text-sobre-lima hover:!bg-black/10 hover:!text-sobre-lima", children: "Depois" })] }));
}
