import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { ACOES, aoMudarAtalhos, conflitos, gravarAtalho, lerAtalhos, salvarAtalhos, semModificador } from '../lib/atalhos';
import { tocarSom } from '../lib/sons';
import { lerVoz } from '../lib/voz';
const rotuloDe = (id) => ACOES.find((a) => a.id === id)?.rotulo ?? id;
/** Settings > Atalhos: one row per action with its combination, record, clear and conflicts. */
export function SecaoAtalhos() {
    const [cfg, setCfg] = useState(lerAtalhos);
    const [gravando, setGravando] = useState(null);
    const [erro, setErro] = useState();
    useEffect(() => aoMudarAtalhos(setCfg), []);
    const choques = conflitos(cfg.teclas);
    const ptt = lerVoz().modo === 'ptt';
    async function gravar(id) {
        setErro(undefined);
        setGravando(id);
        try {
            const teclas = await gravarAtalho();
            if (teclas)
                salvarAtalhos({ teclas: { ...lerAtalhos().teclas, [id]: teclas } });
        }
        catch (e) {
            setErro(`Não deu para gravar o atalho. ${e instanceof Error ? e.message : String(e)}`);
        }
        finally {
            setGravando(null);
        }
    }
    const limpar = (id) => {
        const teclas = { ...lerAtalhos().teclas };
        delete teclas[id];
        salvarAtalhos({ teclas });
    };
    return (_jsxs(_Fragment, { children: [_jsxs("header", { className: "flex flex-col gap-1.5", children: [_jsx("span", { className: "rotulo", children: "/ Voc\u00EA \u00B7 nenhum vem pronto" }), _jsx("h1", { className: "text-[52px]", children: "Atalhos" }), _jsx("p", { className: "m-0 max-w-[72ch] text-texto-fraco", children: "Funcionam com o jogo na frente, sem Alt+Tab. Nenhum vem ligado: escolha teclas que o seu jogo n\u00E3o usa. Com o app em foco, M, S e T continuam valendo." })] }), erro && _jsx(Faixa, { onFechar: () => setErro(undefined), children: erro }), _jsxs("section", { "data-ajuste": "atalhos-lista", className: "janela flex flex-col", "aria-label": "Atalhos globais", children: [_jsxs("div", { className: "barra", children: ["A\u00E7\u00F5es", _jsxs("span", { className: "ml-auto font-medium", children: [Object.keys(cfg.teclas).length, " de ", ACOES.length, " com atalho"] })] }), _jsx("ul", { className: "m-0 list-none p-0", children: ACOES.map((a) => {
                            const teclas = cfg.teclas[a.id];
                            const choque = choques[a.id];
                            const agora = gravando === a.id;
                            return (_jsxs("li", { "data-gravando": agora || undefined, className: "grid grid-cols-[minmax(0,1fr)_200px_auto] items-center gap-x-4 gap-y-1 border-t border-borda px-4 py-2.5 first:border-t-0", children: [_jsxs("span", { className: "flex min-w-0 flex-col", children: [_jsxs("b", { className: "text-[15px]", children: [a.rotulo, a.segurar && _jsx("span", { className: "ml-2 text-[12px] font-medium text-texto-fraco", children: "segurar" })] }), _jsxs("span", { className: "text-[13px] text-texto-fraco", children: [a.ajuda, a.id === 'falar' && !ptt && ' O modo atual é Detecção de voz.'] })] }), _jsx("span", { className: "flex min-w-0 flex-col items-start", "aria-live": "polite", children: agora ? (_jsx("span", { className: "flex h-9 w-full items-center border border-destaque px-2 text-[13px] font-bold text-destaque", children: "Aperte as teclas\u2026 (Esc cancela)" })) : teclas ? (_jsx("kbd", { className: `inline-flex h-9 max-w-full items-center truncate border px-2 font-mono text-[13px] font-bold ${choque ? 'border-perigo text-perigo' : 'border-texto bg-superficie-alta'}`, children: teclas })) : (_jsxs("span", { className: "text-[13px] text-texto-fraco", children: ["Sem atalho", a.sugestao && _jsxs(_Fragment, { children: [" \u00B7 sugest\u00E3o ", _jsx("span", { className: "font-mono", children: a.sugestao })] })] })) }), _jsxs("span", { className: "flex gap-2", children: [_jsx("button", { type: "button", className: "btn btn-sm", disabled: gravando !== null, onClick: () => void gravar(a.id), "aria-label": `Gravar atalho para ${a.rotulo}`, children: teclas ? 'Trocar' : 'Gravar' }), _jsx("button", { type: "button", className: "btn btn-sm btn-fant", disabled: !teclas || gravando !== null, onClick: () => limpar(a.id), "aria-label": `Limpar atalho de ${a.rotulo}`, children: "Limpar" })] }), choque && (_jsxs("p", { role: "alert", className: "col-span-3 m-0 text-[13px] font-bold text-perigo", children: ["Mesmo atalho de ", choque.map(rotuloDe).join(' e '), ". S\u00F3 uma a\u00E7\u00E3o deve usar cada combina\u00E7\u00E3o."] })), teclas && !choque && semModificador(teclas) && (_jsxs("p", { className: "col-span-3 m-0 text-[13px] text-texto-fraco", children: ["Sem Ctrl, Alt ou Shift, a tecla ", teclas, " deixa de funcionar no jogo e no chat enquanto o atalho existir."] }))] }, a.id));
                        }) })] }), _jsxs("section", { "data-ajuste": "atalhos-som", className: "janela flex items-center gap-4 px-4 py-3", "aria-label": "Som de confirma\u00E7\u00E3o", children: [_jsxs("span", { className: "flex flex-1 flex-col gap-0.5", children: [_jsx("b", { children: "Som de confirma\u00E7\u00E3o" }), _jsx("span", { className: "text-[13px] text-texto-fraco", children: "Um bipe curto quando um atalho liga, desliga ou silencia: no jogo voc\u00EA n\u00E3o v\u00EA o app." })] }), _jsx("button", { type: "button", className: "btn btn-sm btn-fant", onClick: () => tocarSom('liga'), children: "Ouvir" }), _jsx("button", { type: "button", role: "switch", "aria-checked": cfg.som, "aria-label": "Som de confirma\u00E7\u00E3o", onClick: () => salvarAtalhos({ som: !cfg.som }), className: `btn btn-sm w-[88px] ${cfg.som ? 'bg-texto text-superficie' : ''}`, children: cfg.som ? 'Ligado' : 'Desligado' })] })] }));
}
