import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { modoFalso } from '../../lib/falso';
import { medirRede, qualidadeRede } from '../../lib/rede';
const TOTAL = 20;
/** Ping and loss to the server, with the numbers in Anton on a lime title bar (data). */
export function TesteRede({ servidorUrl, destaque }) {
    const [estado, setEstado] = useState('parado');
    const medindo = typeof estado === 'number';
    async function testar() {
        if (!servidorUrl)
            return;
        setEstado(0);
        // Demo: the fake server has no address to measure.
        const r = modoFalso() ? { ping: 142, perda: 0, amostras: TOTAL } : await medirRede(servidorUrl, TOTAL, 150, setEstado);
        setEstado(r ?? 'falhou');
    }
    const resultado = typeof estado === 'object' ? estado : null;
    return (_jsxs("section", { "data-ajuste": "voz-rede", "aria-label": "Teste de rede", className: `janela flex flex-col ${destaque ? 'outline-2 outline-offset-2 outline-destaque' : ''}`, children: [_jsxs("div", { className: "barra barra-lima", children: ["Teste de rede", _jsx("span", { className: "ml-auto font-medium", children: servidorUrl ? new URL(servidorUrl).host : 'sem servidor' })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-x-8 gap-y-3 p-4", children: [_jsxs("div", { className: "flex gap-8", "aria-live": "polite", children: [_jsxs("span", { className: "flex flex-col", children: [_jsx("span", { className: "rotulo", children: "Ping" }), _jsxs("b", { className: "font-display text-[44px] leading-none tabular-nums", children: [resultado ? resultado.ping : '—', _jsx("span", { className: "ml-1 font-mono text-[12px]", children: "ms" })] })] }), _jsxs("span", { className: "flex flex-col", children: [_jsx("span", { className: "rotulo", children: "Perda" }), _jsxs("b", { className: "font-display text-[44px] leading-none tabular-nums", children: [resultado ? resultado.perda.toLocaleString('pt-BR') : '—', _jsx("span", { className: "ml-1 font-mono text-[12px]", children: "%" })] })] })] }), _jsx("span", { className: "flex min-w-[240px] flex-1 flex-col gap-1 text-[14px]", children: resultado ? (_jsxs("span", { className: qualidadeRede(resultado) === 'ruim' ? 'font-bold text-perigo' : '', children: ["Rede ", qualidadeRede(resultado), ".", ' ', qualidadeRede(resultado) === 'ruim'
                                    ? 'A voz pode cortar. Na sala, o modo internet ruim prioriza a voz e pausa o vídeo que você recebe.'
                                    : 'Voz e tela devem ir bem.'] })) : estado === 'falhou' ? (_jsx("span", { role: "alert", className: "font-bold text-perigo", children: "O servidor n\u00E3o respondeu. Confira a internet e tente de novo." })) : (_jsx("span", { className: "text-texto-fraco", children: servidorUrl ? `Manda ${TOTAL} pacotes até o servidor e mede a volta. Leva uns 5 s.` : 'Entre num servidor para testar a rede até ele.' })) }), _jsx("button", { type: "button", className: "btn", disabled: !servidorUrl || medindo, onClick: () => void testar(), children: medindo ? `Testando… ${estado}/${TOTAL}` : resultado || estado === 'falhou' ? 'Testar de novo' : 'Testar agora' })] })] }));
}
