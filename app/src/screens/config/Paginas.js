import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Cabecalho, Chave, Deslizante, Linha, Segmento } from '../../components/Controles';
import { Faixa } from '../../components/Faixa';
import { Icone } from '../../components/Icone';
import { QuemFalaLista } from '../../components/QuemFalaLista';
import { falar, fraseCutucada, vozPortugues } from '../../lib/cutucar';
import { LARGURA_QUEM_FALA, nucleo } from '../../lib/nucleo';
import { usePreferencias } from '../../lib/preferencias';
import { ESTADO_EXEMPLO } from '../../lib/quemfala';
import { lerAtalhos } from '../../lib/atalhos';
import { tocarSom } from '../../lib/sons';
const erroDe = (e) => (e instanceof Error ? e.message : String(e));
/** Você > Perfil: the profile editor (its own screen) and the game in the presence. */
export function PaginaPerfil({ eu, destaque, onEditar }) {
    const [p, mudar] = usePreferencias();
    const [agora, setAgora] = useState();
    useEffect(() => {
        if (p.presencaJogo)
            void nucleo.jogoAtual().then(setAgora);
    }, [p.presencaJogo]);
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: eu ? `Você · ${eu.papel}` : 'Você', titulo: "Perfil" }), _jsx(Linha, { ajuste: "perfil-editar", titulo: "Nome, foto e capa", descricao: "Como o grupo v\u00EA voc\u00EA no cart\u00E3o de perfil.", destaque: destaque === 'perfil-editar', children: _jsx("button", { type: "button", className: "btn", onClick: onEditar, children: "Editar perfil" }) }), _jsx(Linha, { ajuste: "presenca-jogo", titulo: "Mostrar o jogo que estou jogando", destaque: destaque === 'presenca-jogo', descricao: p.presencaJogo
                    ? _jsxs(_Fragment, { children: ["O grupo v\u00EA \u201Cjogando \u2026\u201D na sala e no sagu\u00E3o. ", agora ? _jsxs(_Fragment, { children: ["Agora: ", _jsx("b", { className: "text-texto", children: agora }), "."] }) : agora === null ? 'Nenhum jogo aberto agora.' : ''] })
                    : 'Desligado: o app não procura o jogo e não manda nada ao servidor.', children: _jsx(Chave, { rotulo: "Mostrar o jogo que estou jogando", ligado: p.presencaJogo, onMudar: (presencaJogo) => mudar({ presencaJogo }) }) })] }));
}
/** Você > Clipes e replay. */
export function PaginaClipes({ destaque }) {
    const [p, mudar] = usePreferencias();
    const tecla = lerAtalhos().teclas;
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 gravado s\u00F3 neste PC", titulo: "Clipes e replay" }), _jsx(Linha, { ajuste: "replay-ligado", titulo: "Replay sempre ligado", destaque: destaque === 'replay-ligado', descricao: "Guarda os \u00FAltimos segundos da sala o tempo todo; o bot\u00E3o Clipe salva. Gasta mem\u00F3ria e um pouco da placa de v\u00EDdeo.", children: _jsx(Chave, { rotulo: "Replay sempre ligado", ligado: p.replayLigado, onMudar: (replayLigado) => mudar({ replayLigado }) }) }), _jsx(Linha, { ajuste: "replay-tempo", titulo: "Quanto tempo guardar", destaque: destaque === 'replay-tempo', descricao: `Mais tempo usa mais memória: ${p.replaySegundos} s em 1080p60 ocupam cerca de ${Math.round(p.replaySegundos * 7.5)} MB.`, children: _jsx(Segmento, { rotulo: "Quanto tempo guardar", valor: p.replaySegundos, opcoes: [[30, '30 s'], [60, '60 s'], [120, '120 s']], onMudar: (replaySegundos) => mudar({ replaySegundos }) }) }), _jsx(Linha, { ajuste: "replay-qualidade", titulo: "Qualidade do clipe", destaque: destaque === 'replay-qualidade', descricao: "Igual \u00E0 transmiss\u00E3o guarda o que voc\u00EA manda; 720p ocupa menos e pesa menos na placa.", children: _jsx(Segmento, { rotulo: "Qualidade do clipe", valor: p.replayQualidade, opcoes: [['transmissao', 'Igual à transmissão'], ['720p', '720p']], onMudar: (replayQualidade) => mudar({ replayQualidade }) }) }), _jsx(Linha, { ajuste: "replay-pasta", titulo: "Pasta dos clipes", destaque: destaque === 'replay-pasta', descricao: _jsx("span", { className: "font-mono text-[12.5px]", children: p.replayPasta || 'Vídeos\\Stackcall (padrão)' }), children: _jsxs("span", { className: "flex gap-2", children: [p.replayPasta && _jsx("button", { type: "button", className: "btn btn-fant", onClick: () => mudar({ replayPasta: '' }), children: "Usar a padr\u00E3o" }), _jsxs("button", { type: "button", className: "btn", disabled: !isTauri(), title: isTauri() ? undefined : 'Só no app instalado', onClick: async () => {
                                const pasta = await nucleo.escolherPasta();
                                if (pasta)
                                    mudar({ replayPasta: pasta });
                            }, children: [_jsx(Icone, { nome: "pasta" }), "Trocar pasta"] })] }) }), _jsxs("p", { className: "m-0 text-[13px] text-texto-fraco", children: ["Quem est\u00E1 na sala v\u00EA o aviso \u201Creplay ligado\u201D no seu canal e no topo da sala. Esse aviso n\u00E3o desliga.", Object.keys(tecla).length === 0 && ' Para salvar com uma tecla, defina um atalho em Atalhos.'] })] }));
}
const TEXTO_RECEBER = [['todos', 'Todos do grupo'], ['amigos', 'Só amigos'], ['ninguem', 'Ninguém']];
/** Você > Cutucadas. Who may poke is stored on the server; the rest is per PC. */
export function PaginaCutucadas({ servidor, eu, destaque }) {
    const [p, mudar] = usePreferencias();
    const [receber, setReceber] = useState(null);
    const [erro, setErro] = useState();
    const [semVoz, setSemVoz] = useState(false);
    const carregar = () => {
        if (!servidor)
            return;
        setErro(undefined);
        servidor.cutucadas().then(setReceber, (e) => setErro(erroDe(e)));
    };
    useEffect(carregar, [servidor]);
    useEffect(() => {
        // Voices load late in WebView2; ask again when the list arrives.
        const ver = () => setSemVoz(typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0 && !vozPortugues());
        ver();
        if (typeof speechSynthesis === 'undefined')
            return;
        speechSynthesis.addEventListener?.('voiceschanged', ver);
        return () => speechSynthesis.removeEventListener?.('voiceschanged', ver);
    }, []);
    async function escolher(r) {
        if (!servidor)
            return;
        const antes = receber;
        setReceber(r);
        setErro(undefined);
        await servidor.salvarCutucadas(r).catch((e) => {
            setReceber(antes);
            setErro(erroDe(e));
        });
    }
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 para chamar quem tirou o som", titulo: "Cutucadas" }), _jsx(Linha, { ajuste: "cutucar-receber", titulo: "Receber cutucadas de", destaque: destaque === 'cutucar-receber', descricao: servidor ? 'Quem não pode cutucar você vê “Cutucar…” apagado, sem saber o motivo. Vale em todos os seus aparelhos.' : 'Entre num servidor para escolher.', children: servidor && receber === null && !erro ? _jsx("div", { className: "skeleton h-11 w-[330px]", "aria-label": "Carregando" }) : (_jsx(Segmento, { rotulo: "Receber cutucadas de", valor: receber ?? 'todos', opcoes: TEXTO_RECEBER, onMudar: (r) => void escolher(r), disabled: !servidor || receber === null })) }), erro && _jsxs(Faixa, { acoes: [{ rotulo: 'Tentar de novo', onClick: carregar }], children: ["N\u00E3o deu para ler ou salvar essa escolha no servidor. ", erro] }), _jsx(Linha, { ajuste: "cutucar-voz", titulo: "Ler o recado em voz alta", destaque: destaque === 'cutucar-voz', descricao: semVoz ? 'Este PC não tem voz em português do Windows. A leitura sai com a voz que houver.' : 'Uma voz do Windows lê: “Rafa te cutucou: a sala tá pronta”. Roda neste PC; o recado não sai dele.', children: _jsx(Chave, { rotulo: "Ler o recado em voz alta", ligado: p.cutucarVoz, onMudar: (cutucarVoz) => mudar({ cutucarVoz }), textos: ['Ligada', 'Desligada'] }) }), _jsx(Linha, { ajuste: "cutucar-volume", titulo: "Volume da voz", descricao: "Separado do volume da sala.", destaque: destaque === 'cutucar-volume', children: _jsxs("span", { className: "flex items-center gap-3", children: [_jsx(Deslizante, { rotulo: "Volume da voz da cutucada", valor: p.cutucarVolume, min: 0, max: 100, passo: 5, onMudar: (cutucarVolume) => mudar({ cutucarVolume }), disabled: !p.cutucarVoz }), _jsxs("button", { type: "button", className: "btn btn-sm", disabled: !p.cutucarVoz, onClick: () => falar(fraseCutucada({ de: eu?.nome ?? 'Rafa', recado: 'a sala tá pronta' }), p.cutucarVolume), children: [_jsx(Icone, { nome: "play", tamanho: 14 }), "Testar"] })] }) }), _jsx(Linha, { ajuste: "cutucar-silenciado", titulo: "Tocar mesmo com o som silenciado", destaque: destaque === 'cutucar-silenciado', descricao: "\u00C9 para isso que a cutucada serve: chamar quem tirou o som do Stackcall. O mudo do Windows continua valendo.", children: _jsx(Chave, { rotulo: "Tocar mesmo com o som silenciado", ligado: p.cutucarMesmoSilenciado, onMudar: (cutucarMesmoSilenciado) => mudar({ cutucarMesmoSilenciado }), disabled: !p.cutucarVoz }) }), _jsx(Linha, { ajuste: "cutucar-aviso", titulo: "Aviso do Windows", descricao: "Mostra a cutucada na central de notifica\u00E7\u00F5es.", destaque: destaque === 'cutucar-aviso', children: _jsx(Chave, { rotulo: "Aviso do Windows", ligado: p.cutucarAvisoWindows, onMudar: (cutucarAvisoWindows) => mudar({ cutucarAvisoWindows }) }) }), _jsx("p", { className: "m-0 text-[13px] text-texto-fraco", children: "Quem cutuca espera 30 s para cutucar a mesma pessoa de novo." })] }));
}
/** Você > Sons e avisos. */
export function PaginaSons({ destaque }) {
    const [p, mudar] = usePreferencias();
    const vol = p.somEntradaSaidaVolume / 100;
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 vale para este PC", titulo: "Sons e avisos" }), _jsx(Linha, { ajuste: "som-entrada", titulo: "Som de entrada e sa\u00EDda", descricao: "Toca quando algu\u00E9m entra ou sai da sua sala.", destaque: destaque === 'som-entrada', children: _jsx(Chave, { rotulo: "Som de entrada e sa\u00EDda", ligado: p.somEntradaSaida, onMudar: (somEntradaSaida) => mudar({ somEntradaSaida }) }) }), _jsx(Linha, { ajuste: "som-entrada", titulo: "Volume dos sons", descricao: "Baixo de prop\u00F3sito: toca por cima do jogo.", children: _jsxs("span", { className: "flex items-center gap-3", children: [_jsx(Deslizante, { rotulo: "Volume dos sons de entrada e sa\u00EDda", valor: p.somEntradaSaidaVolume, min: 0, max: 100, passo: 5, onMudar: (somEntradaSaidaVolume) => mudar({ somEntradaSaidaVolume }), disabled: !p.somEntradaSaida }), _jsx("button", { type: "button", className: "btn btn-sm", disabled: !p.somEntradaSaida, onClick: () => tocarSom('entrou', vol), children: "Entrou" }), _jsx("button", { type: "button", className: "btn btn-sm", disabled: !p.somEntradaSaida, onClick: () => tocarSom('saiu', vol), children: "Saiu" })] }) })] }));
}
const CANTOS = [
    ['sup-esq', 'Em cima, à esquerda'], ['sup-dir', 'Em cima, à direita'],
    ['meio-esq', 'No meio, à esquerda'], ['meio-dir', 'No meio, à direita'],
    ['inf-esq', 'Embaixo, à esquerda'], ['inf-dir', 'Embaixo, à direita'],
];
const POSICAO_PREVIA = {
    'sup-esq': 'top-2 left-2 origin-top-left', 'sup-dir': 'top-2 right-2 origin-top-right', 'meio-esq': 'top-1/2 left-2 origin-left -translate-y-1/2', 'meio-dir': 'top-1/2 right-2 origin-right -translate-y-1/2',
    'inf-esq': 'bottom-2 left-2 origin-bottom-left', 'inf-dir': 'bottom-2 right-2 origin-bottom-right', livre: 'top-1/2 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2',
};
/** Você > Janela quem fala, with a live preview over a drawn game frame. */
export function PaginaQuemFala({ destaque }) {
    const [p, mudar] = usePreferencias();
    const [disponivel, setDisponivel] = useState(true);
    const [arrastando, setArrastando] = useState(false);
    const tecla = lerAtalhos().teclas.quemFala;
    useEffect(() => void nucleo.temJanelaQuemFala().then(setDisponivel), []);
    useEffect(() => () => void (arrastando && nucleo.arrastarQuemFala(false)), [arrastando]);
    const conteudo = p.quemFalaConteudo === 'falando' ? 'só quem fala' : 'todos';
    const tamanho = { p: 'pequeno', m: 'médio', g: 'grande' }[p.quemFalaTamanho];
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 janela separada, sempre no topo", titulo: "Janela quem fala" }), !disponivel && _jsx(Faixa, { tipo: "aviso", children: "Esta vers\u00E3o do n\u00FAcleo ainda n\u00E3o abre a janela. As escolhas ficam guardadas e valem quando ela chegar." }), _jsxs("div", { className: "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-3 max-[1180px]:grid-cols-1", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx(Linha, { ajuste: "quemfala-mostrar", titulo: "Mostrar a janela", descricao: "Fica por cima do jogo em tela cheia sem borda. Nada entra no jogo.", destaque: destaque === 'quemfala-mostrar', children: _jsx(Chave, { rotulo: "Mostrar a janela quem fala", ligado: p.quemFalaMostrar, onMudar: (quemFalaMostrar) => mudar({ quemFalaMostrar }), textos: ['Ligada', 'Desligada'] }) }), _jsx(Linha, { ajuste: "quemfala-conteudo", titulo: "O que mostrar", descricao: "Em \u201Ctodos da sala\u201D, quem fala acende em lima.", destaque: destaque === 'quemfala-conteudo', children: _jsx(Segmento, { rotulo: "O que a janela mostra", valor: p.quemFalaConteudo, opcoes: [['falando', 'Só quem fala'], ['todos', 'Todos da sala']], onMudar: (quemFalaConteudo) => mudar({ quemFalaConteudo }) }) }), _jsx(Linha, { ajuste: "quemfala-opacidade", titulo: "Opacidade", descricao: "Mais baixa deixa ver o jogo por tr\u00E1s.", destaque: destaque === 'quemfala-opacidade', children: _jsx(Deslizante, { rotulo: "Opacidade da janela", valor: p.quemFalaOpacidade, min: 20, max: 100, passo: 5, onMudar: (quemFalaOpacidade) => mudar({ quemFalaOpacidade }) }) }), _jsx(Linha, { ajuste: "quemfala-tamanho", titulo: "Tamanho", destaque: destaque === 'quemfala-tamanho', children: _jsx(Segmento, { rotulo: "Tamanho da janela", valor: p.quemFalaTamanho, opcoes: [['p', 'Pequeno'], ['m', 'Médio'], ['g', 'Grande']], onMudar: (quemFalaTamanho) => mudar({ quemFalaTamanho }) }) }), _jsx(Linha, { ajuste: "quemfala-posicao", titulo: "Posi\u00E7\u00E3o", destaque: destaque === 'quemfala-posicao', descricao: p.quemFalaPosicao === 'livre' ? 'No lugar onde você arrastou. Escolha um canto para voltar.' : 'Escolha o canto ou arraste a janela por cima do jogo.', children: _jsxs("span", { className: "flex items-center gap-3", children: [_jsx("span", { role: "radiogroup", "aria-label": "Canto da tela", className: "grid grid-cols-[repeat(2,28px)] grid-rows-[repeat(3,20px)] gap-[3px] border border-texto p-1", children: CANTOS.map(([id, texto]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": p.quemFalaPosicao === id, "aria-label": texto, title: texto, onClick: () => mudar({ quemFalaPosicao: id }), className: `border ${p.quemFalaPosicao === id ? 'border-texto bg-texto' : 'border-borda bg-superficie hover:bg-superficie-alta'}` }, id))) }), arrastando ? (_jsx("button", { type: "button", className: "btn btn-prim", onClick: () => {
                                                void nucleo.arrastarQuemFala(false);
                                                setArrastando(false);
                                                mudar({ quemFalaPosicao: 'livre' });
                                            }, children: "Pronto" })) : (_jsx("button", { type: "button", className: "btn", disabled: !disponivel || !p.quemFalaMostrar, onClick: () => {
                                                void nucleo.arrastarQuemFala(true);
                                                setArrastando(true);
                                            }, children: "Arrastar com o mouse" }))] }) }), arrastando && _jsx("p", { role: "status", className: "m-0 text-[13px]", children: "Arraste a janela pela tela. Clique em Pronto para fixar; o clique volta a passar atrav\u00E9s dela." }), _jsx(Linha, { ajuste: "quemfala-mostrar", titulo: "Atalho para mostrar e esconder", descricao: tecla ? _jsxs(_Fragment, { children: ["Tecla: ", _jsx("span", { className: "font-mono", children: tecla })] }) : 'Nenhum vem pronto.', children: _jsx("span", { className: "rotulo", children: "Em Voc\u00EA \u203A Atalhos" }) })] }), _jsxs("section", { className: "janela flex flex-col", "aria-label": "Pr\u00E9via da janela quem fala", children: [_jsxs("div", { className: "barra", children: ["Pr\u00E9via", _jsxs("span", { className: "ml-auto font-medium", children: [conteudo, " \u00B7 ", p.quemFalaOpacidade, "% \u00B7 ", tamanho] })] }), _jsxs("div", { className: "relative aspect-video overflow-hidden bg-[linear-gradient(#56636f_0_46%,#7c6f58_46%_100%)]", children: [_jsx("span", { "aria-hidden": "true", className: "absolute top-[40%] right-[30%] bottom-[30%] left-[30%] bg-[#a08f6d]" }), _jsx("div", { className: `absolute scale-[0.7] ${POSICAO_PREVIA[p.quemFalaPosicao]}`, children: _jsx(QuemFalaLista, { estado: ESTADO_EXEMPLO, prefs: p, largura: LARGURA_QUEM_FALA[p.quemFalaTamanho] }) })] }), _jsx("p", { className: "m-0 px-3 py-2.5 text-[13px] text-texto-fraco", children: p.quemFalaMostrar ? 'Assim ela aparece por cima do jogo.' : 'Desligada: a janela não aparece.' })] })] })] }));
}
/** Você > Mapa do CS2: the room split by team, from the official Valve GSI. */
export function PaginaCs2({ destaque }) {
    const [p, mudar] = usePreferencias();
    const [gsi, setGsi] = useState();
    const [confirmar, setConfirmar] = useState(false);
    const [erro, setErro] = useState();
    const [instalando, setInstalando] = useState(false);
    useEffect(() => void nucleo.gsiEstado().then(setGsi), []);
    async function instalar() {
        setConfirmar(false);
        setErro(undefined);
        setInstalando(true);
        try {
            setGsi(await nucleo.instalarGsi());
        }
        catch (e) {
            setErro(erroDe(e));
        }
        finally {
            setInstalando(false);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "Voc\u00EA \u00B7 vale para este PC", titulo: "Mapa do CS2", children: "Durante a partida, a sala se divide em CT e TR sozinha. As telas do outro time ficam escondidas at\u00E9 o fim do round." }), _jsx(Linha, { ajuste: "cs2-sala", titulo: "Sala do mapa", destaque: destaque === 'cs2-sala', descricao: gsi?.instalado ? 'Liga a troca automática para a sub-sala do seu time.' : 'Precisa da integração com o CS2, logo abaixo.', children: _jsx(Chave, { rotulo: "Sala do mapa do CS2", ligado: p.cs2SalaMapa, onMudar: (cs2SalaMapa) => mudar({ cs2SalaMapa }) }) }), _jsx(Linha, { ajuste: "cs2-gsi", titulo: "Integra\u00E7\u00E3o com o CS2", destaque: destaque === 'cs2-gsi', descricao: gsi === undefined ? 'Conferindo…' : gsi === null ? 'Esta versão do núcleo ainda não instala a integração.'
                    : gsi.instalado ? _jsxs(_Fragment, { children: ["Instalada em ", _jsx("span", { className: "break-all font-mono text-[12px]", children: gsi.caminho })] })
                        : 'O arquivo oficial de Game State Integration da Valve. O CS2 manda o time e o round para este PC; nada entra no jogo.', children: gsi?.instalado ? _jsx("span", { className: "rotulo text-vitoria", children: "\u25CF instalada" }) : (_jsx("button", { type: "button", className: "btn", disabled: !gsi || instalando, onClick: () => setConfirmar(true), children: instalando ? 'Instalando…' : 'Instalar integração' })) }), confirmar && (_jsx(Faixa, { tipo: "aviso", acoes: [{ rotulo: 'Instalar', principal: true, onClick: () => void instalar() }, { rotulo: 'Cancelar', onClick: () => setConfirmar(false) }], children: "Vai criar o arquivo gamestate_integration_stackcall.cfg na pasta cfg do CS2. Feche e abra o CS2 depois. Para desfazer, apague o arquivo." })), erro && _jsxs(Faixa, { acoes: [{ rotulo: 'Tentar de novo', onClick: () => void instalar() }], children: ["N\u00E3o deu para instalar. ", erro] })] }));
}
