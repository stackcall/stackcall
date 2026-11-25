import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { CATEGORIES, bundledChangelog, formatDate, loadChangelog, upperFirst } from '../lib/changelog';
const GROUP = {
    Novidades: { label: 'novidades', one: 'novidade' },
    Melhorias: { label: 'melhorias', one: 'melhoria' },
    Correções: { label: 'correções', one: 'correção' },
    Ajustes: { label: 'ajustes', one: 'ajuste' },
};
/** Notes for one version; `from` is the version before an update (shown once after updating). */
export function Novidades({ from, current, onClose, onHistory }) {
    const [versions, setVersions] = useState(bundledChangelog);
    useEffect(() => void loadChangelog().then(setVersions), []);
    const v = versions.find((x) => x.version === current) ?? versions[0];
    const groups = v ? CATEGORIES.flatMap((c) => v.categories.filter((g) => g.name === c).map((g) => ({ c, items: g.items }))) : [];
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": "Novidades", className: "absolute inset-0 z-30 flex justify-center overflow-y-auto bg-fundo", children: _jsxs("div", { className: "flex w-[880px] max-w-[calc(100%-48px)] flex-col gap-6 py-12", children: [_jsxs("header", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "rotulo", children: from ? `Atualizado · ${from} → ${v?.version}` : `Versão ${v?.version ?? current}` }), _jsxs("h1", { className: "text-[64px]", children: ["O que mudou na ", v?.version ?? current] }), v && _jsxs("span", { className: "text-texto-fraco", children: ["Publicada em ", formatDate(v.date), " \u00B7 canal est\u00E1vel"] }), _jsx("div", { className: "mt-1 flex flex-wrap gap-2", children: groups.map((g) => (_jsxs("span", { className: "rotulo border border-texto bg-lima px-2.5 py-1 text-sobre-lima", children: [g.items.length, " ", g.items.length === 1 ? GROUP[g.c].one : GROUP[g.c].label] }, g.c))) })] }), groups.map((g) => (_jsxs("section", { className: "janela flex flex-col", children: [_jsx("h2", { className: "barra m-0", children: g.c }), g.items.map((i, n) => (_jsxs("div", { className: "flex items-center gap-3 border-t border-borda px-4 py-3 first-of-type:border-t-0", children: [_jsx("span", { children: upperFirst(i.message) }), i.breaking && _jsx("span", { className: "rotulo ml-auto text-perigo", children: "Exige atualizar" })] }, n)))] }, g.c))), _jsxs("footer", { className: "mt-auto flex items-center gap-3", children: [_jsx("button", { type: "button", onClick: onHistory, className: "btn btn-fant", children: "Ver todas as vers\u00F5es" }), _jsx("button", { type: "button", onClick: onClose, className: "btn btn-prim btn-lg ml-auto", children: "Voltar" })] })] }) }));
}
