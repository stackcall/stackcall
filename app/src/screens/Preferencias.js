import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useTema } from '../lib/tema';
import { Cabecalho, Linha, Segmento } from '../components/Controles';
import { TesteRede } from './config/TesteRede';
import { lerAtalhos } from '../lib/atalhos';
import { aoMudarVoz, capturaDe, lerVoz, salvarVoz } from '../lib/voz';
/** Lists microphones and outputs. Labels only come after a microphone permission (the test grants it). */
async function listarAparelhos() {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices)
        return null;
    const todos = await md.enumerateDevices().catch(() => []);
    const de = (tipo) => todos
        .filter((d) => d.kind === tipo && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, nome: d.label || `${tipo === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}` }));
    return { entradas: de('audioinput'), saidas: de('audiooutput') };
}
/** Settings > Você > Voz e rede: voice mode, devices, voice processing and the network test. */
export function SecaoPreferencias({ servidorUrl, destaque }) {
    const [voz, setVoz] = useState(lerVoz);
    // The room can turn the strong suppression off by itself when it fails: follow it.
    useEffect(() => aoMudarVoz(setVoz), []);
    const [aparelhos, setAparelhos] = useState();
    const mudar = (m) => setVoz(salvarVoz(m));
    const atualizar = () => void listarAparelhos().then(setAparelhos);
    useEffect(() => {
        atualizar();
        const md = navigator.mediaDevices;
        md?.addEventListener?.('devicechange', atualizar);
        return () => md?.removeEventListener?.('devicechange', atualizar);
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 vale para este PC", titulo: "Voz e rede", children: "Muda na hora, sem sair da sala." }), _jsxs("section", { "data-ajuste": "voz-modo", className: `janela flex flex-col ${destaque === 'voz-modo' ? 'outline-2 outline-offset-2 outline-destaque' : ''}`, "aria-label": "Modo de voz", children: [_jsx("div", { className: "barra", children: "Modo de voz" }), _jsxs("div", { className: "flex flex-wrap items-center gap-x-6 gap-y-3 p-4", children: [_jsxs("div", { className: "abas", role: "group", "aria-label": "Modo de voz", children: [_jsx("button", { type: "button", "aria-pressed": voz.modo === 'voz', onClick: () => mudar({ modo: 'voz' }), children: "Detec\u00E7\u00E3o de voz" }), _jsx("button", { type: "button", "aria-pressed": voz.modo === 'ptt', onClick: () => mudar({ modo: 'ptt' }), children: "Apertar para falar" })] }), voz.modo === 'ptt' ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "flex items-center gap-3 text-[14px]", children: [_jsx("span", { className: "font-bold", children: "Soltura" }), _jsx("input", { type: "range", min: 0, max: 1000, step: 50, value: voz.soltura, className: "h-11 w-40", onChange: (e) => mudar({ soltura: Number(e.target.value) }), "aria-valuetext": `${voz.soltura} milissegundos` }), _jsxs("span", { className: "w-16 font-mono tabular-nums", children: [voz.soltura, " ms"] })] }), _jsxs("span", { className: "basis-full text-[14px] text-texto-fraco", children: ["O microfone s\u00F3 abre enquanto voc\u00EA segura a tecla, e fecha ", voz.soltura, " ms depois de soltar.", ' ', lerAtalhos().teclas.falar ? `Tecla: ${lerAtalhos().teclas.falar}.` : 'Grave a tecla em Configurações > Atalhos.'] })] })) : (_jsx("span", { className: "text-[14px] text-texto-fraco", children: "O microfone abre sozinho quando voc\u00EA fala. \u00C9 o padr\u00E3o." }))] })] }), _jsxs("div", { className: "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[1180px]:grid-cols-1", children: [_jsxs("section", { "data-ajuste": "voz-aparelhos", className: `janela flex flex-col ${destaque === 'voz-aparelhos' ? 'outline-2 outline-offset-2 outline-destaque' : ''}`, children: [_jsx("div", { className: "barra", children: "Aparelhos" }), _jsxs("div", { className: "flex flex-col gap-4 p-4", children: [aparelhos === null ? (_jsx("p", { className: "m-0 text-texto-fraco", children: "Este ambiente n\u00E3o lista aparelhos de \u00E1udio. No app instalado eles aparecem aqui." })) : (_jsxs(_Fragment, { children: [_jsx(Escolha, { id: "voz-entrada", rotulo: "Microfone", valor: voz.entrada, lista: aparelhos?.entradas, onMudar: (entrada) => mudar({ entrada }) }), _jsx(Escolha, { id: "voz-saida", rotulo: "Sa\u00EDda de som", valor: voz.saida, lista: aparelhos?.saidas, onMudar: (saida) => mudar({ saida }) }), aparelhos && aparelhos.entradas.every((a) => /^Microfone \d+$/.test(a.nome)) && (_jsx("p", { className: "m-0 text-[13px] text-texto-fraco", children: "Os nomes aparecem depois do primeiro teste do microfone." }))] })), _jsx(TesteMicrofone, { voz: voz, onPermissao: atualizar })] })] }), _jsxs("section", { "data-ajuste": "voz-ruido voz-eco voz-ganho", className: `janela flex flex-col ${destaque && ['voz-ruido', 'voz-eco', 'voz-ganho'].includes(destaque) ? 'outline-2 outline-offset-2 outline-destaque' : ''}`, children: [_jsx("div", { className: "barra", children: "Tratamento da voz" }), _jsxs("div", { className: "flex flex-col p-4", children: [_jsx(Opcao, { id: "voz-ruido", rotulo: "Supress\u00E3o de ru\u00EDdo", ajuda: voz.forte
                                            ? 'Fica parada enquanto a supressão forte está ligada, para não cortar a voz duas vezes.'
                                            : 'Tira ruído constante (ventoinha, ar-condicionado). Teclado alto ainda passa.', ligado: voz.ruido, onMudar: (ruido) => mudar({ ruido }) }), _jsx(Opcao, { id: "voz-forte", rotulo: "Supress\u00E3o forte (teclado e cliques)", ajuda: "Filtro RNNoise: tira teclado e mouse. Gasta um pouco de CPU e pode cortar o fim de palavras. S\u00F3 carrega quando voc\u00EA liga.", ligado: voz.forte, onMudar: (forte) => mudar({ forte }) }), _jsx(Opcao, { id: "voz-eco", rotulo: "Cancelamento de eco", ajuda: "Precisa se o som sai da caixa. Com fone de ouvido, pode desligar.", ligado: voz.eco, onMudar: (eco) => mudar({ eco }) }), _jsx(Opcao, { id: "voz-ganho", rotulo: "Controle autom\u00E1tico de ganho", ajuda: "Iguala o volume da sua voz. Desligue se ele subir e descer sozinho.", ligado: voz.ganho, onMudar: (ganho) => mudar({ ganho }) })] })] })] }), _jsx(TesteRede, { servidorUrl: servidorUrl, destaque: destaque === 'voz-rede' })] }));
}
/** Settings > Você > Aparência. */
export function SecaoAparencia({ destaque }) {
    const [tema, setTema] = useTema();
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 vale para este PC", titulo: "Apar\u00EAncia" }), _jsx(Linha, { ajuste: "tema", titulo: "Tema", descricao: "O claro \u00E9 o padr\u00E3o. A barra de t\u00EDtulo do Windows acompanha.", destaque: destaque === 'tema', children: _jsx(Segmento, { rotulo: "Tema", valor: tema, opcoes: [['claro', 'Claro'], ['escuro', 'Escuro']], onMudar: setTema }) })] }));
}
function Escolha({ id, rotulo, valor, lista, onMudar }) {
    const sumiu = valor && lista && !lista.some((a) => a.id === valor);
    return (_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("label", { htmlFor: id, className: "font-bold", children: rotulo }), _jsxs("select", { id: id, className: "campo", value: sumiu ? '' : valor, onChange: (e) => onMudar(e.target.value), disabled: !lista, children: [_jsx("option", { value: "", children: "Padr\u00E3o do Windows" }), lista?.map((a) => _jsx("option", { value: a.id, children: a.nome }, a.id))] }), sumiu && _jsx("span", { className: "text-[13px] text-texto-fraco", children: "O aparelho escolhido n\u00E3o est\u00E1 conectado. Usando o padr\u00E3o do Windows." })] }));
}
function Opcao({ id, rotulo, ajuda, ligado, onMudar }) {
    return (_jsxs("div", { className: "flex min-h-14 items-center gap-4 border-t border-borda py-2 first:border-t-0", children: [_jsxs("span", { className: "flex flex-1 flex-col gap-0.5", children: [_jsx("span", { id: `${id}-rotulo`, className: "font-bold", children: rotulo }), _jsx("span", { id: `${id}-ajuda`, className: "text-[13px] text-texto-fraco", children: ajuda })] }), _jsx("button", { id: id, type: "button", role: "switch", "aria-checked": ligado, "aria-labelledby": `${id}-rotulo`, "aria-describedby": `${id}-ajuda`, onClick: () => onMudar(!ligado), className: `btn btn-sm w-[88px] ${ligado ? 'bg-texto text-superficie' : ''}`, children: ligado ? 'Ligado' : 'Desligado' })] }));
}
/** Opens the microphone with the chosen options and draws its level; closes everything on stop. */
function TesteMicrofone({ voz, onPermissao }) {
    const [estado, setEstado] = useState('parado');
    const barra = useRef(null);
    const fim = useRef(null);
    const parar = () => {
        fim.current?.();
        fim.current = null;
        setEstado('parado');
    };
    useEffect(() => () => fim.current?.(), []);
    // Options changed during the test: reopen with the new ones.
    useEffect(() => {
        if (estado === 'ouvindo')
            void comecar();
    }, [voz.entrada, voz.eco, voz.ganho, voz.ruido]);
    async function comecar() {
        fim.current?.();
        setEstado('abrindo');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: capturaDe(voz) });
            const ctx = new AudioContext();
            const analisador = ctx.createAnalyser();
            analisador.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(analisador);
            const dados = new Uint8Array(analisador.fftSize);
            let id = requestAnimationFrame(function quadro() {
                analisador.getByteTimeDomainData(dados);
                let pico = 0;
                for (const d of dados)
                    pico = Math.max(pico, Math.abs(d - 128));
                if (barra.current)
                    barra.current.style.transform = `scaleX(${Math.min(1, (pico / 128) * 1.6)})`;
                id = requestAnimationFrame(quadro);
            });
            fim.current = () => {
                cancelAnimationFrame(id);
                stream.getTracks().forEach((t) => t.stop());
                void ctx.close();
            };
            setEstado('ouvindo');
            onPermissao();
        }
        catch {
            setEstado('erro');
        }
    }
    return (_jsxs("div", { className: "flex flex-col gap-2 border-t border-borda pt-4", children: [_jsx("span", { className: "font-bold", children: "Teste do microfone" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { type: "button", className: "btn", disabled: estado === 'abrindo', onClick: () => (estado === 'ouvindo' ? parar() : void comecar()), children: estado === 'ouvindo' ? 'Parar teste' : estado === 'abrindo' ? 'Abrindo…' : 'Testar microfone' }), _jsx("span", { className: "relative h-3 flex-1 border border-texto bg-superficie-alta", role: "meter", "aria-label": "N\u00EDvel do microfone", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuetext": estado === 'ouvindo' ? 'ouvindo' : 'parado', children: _jsx("span", { ref: barra, className: "absolute inset-0 origin-left scale-x-0 bg-lima" }) })] }), _jsx("span", { role: "status", className: `text-[13px] ${estado === 'erro' ? 'text-perigo' : 'text-texto-fraco'}`, children: estado === 'erro' ? 'Não deu para abrir o microfone. Confira a permissão do Windows em Privacidade > Microfone.'
                    : estado === 'ouvindo' ? 'Fale normalmente: a barra deve encher até a metade.' : 'Fale depois de tocar. Nada é gravado nem enviado.' })] }));
}
