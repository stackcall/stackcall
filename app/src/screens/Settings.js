import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { CATEGORIES, countOf, formatDate, loadChangelog } from '../lib/changelog';
import { updateButtonLabel } from '../components/UpdateBanner';
import { Avatar } from '../components/Avatar';
import { Icone } from '../components/Icone';
import { Faixa } from '../components/Faixa';
import { Cabecalho } from '../components/Controles';
import { testMachine } from '../lib/sidecar';
import { escolherServidor, lerServidores, servidorAtual } from '../lib/servidores';
import { buscarAjustes, caminhoDe, GRUPOS, paginasVisiveis } from '../lib/buscaConfig';
import { SecaoAparencia, SecaoPreferencias } from './Preferencias';
import { SecaoAtalhos } from './Atalhos';
import { PaginaClipes, PaginaCs2, PaginaCutucadas, PaginaPerfil, PaginaQuemFala, PaginaSons } from './config/Paginas';
const CATEGORY_LABEL = {
    Novidades: ['novidade', 'novidades'],
    Melhorias: ['melhoria', 'melhorias'],
    Correções: ['correção', 'correções'],
    Ajustes: ['ajuste', 'ajustes'],
};
export function summarize(v) {
    return CATEGORIES.flatMap((c) => {
        const n = countOf(v, c);
        return n ? [`${n} ${CATEGORY_LABEL[c][n === 1 ? 0 : 1]}`] : [];
    }).join(', ');
}
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—');
/**
 * Settings (docs/design/v05-interface.md, section 5): Você, Servidor (owner and admins) and
 * App, with a search over every setting. A result opens its page and outlines the row.
 */
export function Settings(props) {
    const admin = props.eu?.papel === 'dono' || props.eu?.papel === 'admin';
    const comServidor = !!(props.servidor && props.eu);
    const visiveis = paginasVisiveis(comServidor, admin);
    // The server may still be loading: keep the wish and fall back below until the page is visible.
    const [pagina, setPagina] = useState(props.pagina ?? 'perfil');
    const [busca, setBusca] = useState('');
    const [destaque, setDestaque] = useState();
    const principal = useRef(null);
    const atual = visiveis.some((p) => p.id === pagina) ? pagina : visiveis[0].id;
    useEffect(() => {
        // Esc while a shortcut is being recorded cancels the recording, not the whole screen.
        const esc = (e) => e.key === 'Escape' && !document.querySelector('[data-gravando]') && props.onClose();
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [props.onClose]);
    useEffect(() => {
        if (!destaque)
            return;
        principal.current?.querySelector(`[data-ajuste~="${destaque}"]`)?.scrollIntoView({ block: 'center' });
        const t = setTimeout(() => setDestaque(undefined), 2500);
        return () => clearTimeout(t);
    }, [destaque, atual]);
    const abrir = (id, ajuste) => {
        setPagina(id);
        setBusca('');
        setDestaque(ajuste);
        principal.current?.scrollTo?.({ top: 0 });
    };
    const resultados = busca.trim() ? buscarAjustes(busca, visiveis.map((p) => p.id)) : null;
    const nomeServidor = props.servidor ? new URL(props.servidor.url).host : '';
    return (_jsxs("div", { role: "dialog", "aria-modal": "true", "aria-label": "Configura\u00E7\u00F5es", className: "absolute inset-0 z-20 grid grid-cols-[272px_minmax(0,1fr)] bg-fundo", children: [_jsxs("nav", { "aria-label": "Se\u00E7\u00F5es", className: "flex min-h-0 flex-col gap-px overflow-y-auto border-r border-texto bg-superficie px-3.5 pt-4 pb-3", children: [_jsx("span", { className: "rotulo px-1", children: "/ Configura\u00E7\u00F5es" }), _jsxs("label", { className: `my-2 flex h-10 shrink-0 items-center gap-2 border px-2.5 text-texto-fraco ${busca ? 'border-2 border-destaque' : 'border-texto'}`, children: [_jsx(Icone, { nome: "busca", tamanho: 15 }), _jsx("input", { type: "search", value: busca, placeholder: "Buscar ajuste", "aria-label": "Buscar ajuste", autoComplete: "off", spellCheck: false, onChange: (e) => setBusca(e.target.value), onKeyDown: (e) => {
                                    if (e.key === 'Escape' && busca) {
                                        e.stopPropagation();
                                        setBusca('');
                                    }
                                    if (e.key === 'Enter' && resultados?.[0])
                                        abrir(resultados[0].pagina, resultados[0].id);
                                }, className: "min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none placeholder:text-texto-fraco" })] }), GRUPOS.map((g) => {
                        const itens = visiveis.filter((p) => p.grupo === g.id);
                        if (!itens.length)
                            return null;
                        return (_jsxs("div", { className: "flex flex-col gap-px", role: "group", "aria-label": g.rotulo, children: [_jsx("span", { className: "mt-2.5 flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.06em] text-texto-fraco uppercase", children: g.id === 'servidor' && props.eu ? _jsxs(_Fragment, { children: ["Servidor ", _jsx("span", { className: "max-w-[120px] truncate normal-case", children: nomeServidor }), _jsx("span", { className: "border border-current px-1 py-px text-[9.5px]", children: props.eu.papel })] }) : g.rotulo }), itens.map((p) => (_jsx("button", { type: "button", "aria-current": !resultados && atual === p.id ? 'page' : undefined, onClick: () => abrir(p.id), className: `flex min-h-[32px] items-center border-0 px-2.5 text-left text-[14px] ${!resultados && atual === p.id ? 'bg-texto font-bold text-superficie' : 'bg-transparent font-medium text-texto hover:bg-superficie-alta'}`, children: p.rotulo }, p.id)))] }, g.id));
                    }), _jsxs("button", { type: "button", onClick: props.onClose, className: "btn btn-fant mt-auto shrink-0 justify-start gap-2 border-t border-t-borda", children: [_jsx(Icone, { nome: "sair", tamanho: 16 }), "Voltar"] })] }), _jsx("main", { ref: principal, className: "flex min-w-0 flex-col gap-3 overflow-y-auto px-8 pt-6 pb-8", children: _jsx("div", { className: "flex w-full max-w-[1040px] flex-col gap-3", children: resultados ? _jsx(Resultados, { busca: busca, lista: resultados, onAbrir: (a) => abrir(a.pagina, a.id) }) : (_jsxs(_Fragment, { children: [atual === 'perfil' && _jsx(PaginaPerfil, { eu: props.eu, destaque: destaque, onEditar: props.onPerfil }), atual === 'voz' && _jsx(SecaoPreferencias, { servidorUrl: props.servidor?.url ?? null, destaque: destaque }), atual === 'atalhos' && _jsx(SecaoAtalhos, {}), atual === 'clipes' && _jsx(PaginaClipes, { destaque: destaque }), atual === 'cutucadas' && _jsx(PaginaCutucadas, { servidor: props.servidor, eu: props.eu, destaque: destaque }), atual === 'sons' && _jsx(PaginaSons, { destaque: destaque }), atual === 'quemfala' && _jsx(PaginaQuemFala, { destaque: destaque }), atual === 'cs2' && _jsx(PaginaCs2, { destaque: destaque }), atual === 'aparencia' && _jsx(SecaoAparencia, { destaque: destaque }), atual === 'geral' && props.servidor && props.eu && _jsx(PaginaGeral, { servidor: props.servidor, eu: props.eu }), atual === 'salas' && props.servidor && _jsx(PaginaSalas, { servidor: props.servidor, salas: props.salas, onSalas: props.onSalas }), atual === 'membros' && props.servidor && props.eu && _jsx(PaginaMembros, { servidor: props.servidor, eu: props.eu, pessoas: props.pessoas, onPessoas: props.onPessoas }), atual === 'servidores' && (_jsx(SecaoServidores, { atual: props.servidor?.url ?? null, servidor: props.servidor, eu: props.eu, onTrocar: props.onTrocar, onColarConvite: props.onColarConvite, onSair: props.onSair })), atual === 'sobre' && _jsx(SecaoSobre, { updater: props.updater, inCall: props.inCall, onNotes: props.onNotes })] })) }) })] }));
}
function Resultados({ busca, lista, onAbrir }) {
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: `Busca · ${lista.length === 1 ? '1 ajuste' : `${lista.length} ajustes`} com “${busca.trim()}”`, titulo: "Resultados" }), lista.length ? (_jsx("ul", { className: "janela m-0 flex list-none flex-col p-0", "aria-label": "Resultados da busca", children: lista.map((a) => (_jsx("li", { className: "border-t border-borda first:border-t-0", children: _jsxs("button", { type: "button", onClick: () => onAbrir(a), className: "flex w-full items-center gap-6 border-0 bg-transparent px-4 py-3.5 text-left text-texto hover:bg-superficie-alta", children: [_jsxs("span", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsx("span", { className: "rotulo", children: caminhoDe(a) }), _jsx("b", { className: "text-[15px]", children: a.titulo }), _jsx("span", { className: "text-[13.5px] text-texto-fraco", children: a.descricao })] }), _jsx("span", { className: "rotulo shrink-0", children: "Abrir \u203A" })] }) }, a.id))) })) : (_jsxs("div", { className: "janela p-4 text-texto-fraco", children: ["Nenhum ajuste com \u201C", busca.trim(), "\u201D. Tente outra palavra, como \u201Cmicrofone\u201D ou \u201Ctela\u201D."] })), _jsx("p", { className: "m-0 font-mono text-[11.5px] text-texto-fraco", children: "Busca no nome do ajuste, na descri\u00E7\u00E3o e em apelidos (\u201Cptt\u201D, \u201Cmute\u201D, \u201Cgrava\u00E7\u00E3o\u201D)." })] }));
}
/** Error strip with a way out: "Tentar de novo" when the action can be repeated. */
function Erro({ texto, onTentar }) {
    return texto ? _jsx(Faixa, { acoes: onTentar ? [{ rotulo: 'Tentar de novo', onClick: onTentar }] : [], children: texto }) : null;
}
/** Servidor > Geral e convites. */
function PaginaGeral({ servidor, eu }) {
    const host = new URL(servidor.url).host;
    return (_jsxs(_Fragment, { children: [_jsxs(Cabecalho, { rotulo: `Servidor · ${host}`, titulo: "Geral e convites", children: ["Voc\u00EA entrou como ", _jsx("b", { className: "text-texto", children: eu.nome }), " (", eu.papel, "). Um servidor \u00E9 um grupo: s\u00F3 entra quem recebe convite."] }), _jsx("div", { "data-ajuste": "servidor-nome convites", children: _jsx(Convites, { servidor: servidor }) })] }));
}
/** Servidor > Salas. */
function PaginaSalas({ servidor, salas, onSalas }) {
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: `Servidor · ${salas.length === 1 ? '1 sala' : `${salas.length} salas`}`, titulo: "Salas", children: "As salas fixas do grupo. As sub-salas CT e TR do CS2 aparecem e somem sozinhas durante a partida." }), _jsx("div", { "data-ajuste": "salas-lista", children: _jsx(Salas, { servidor: servidor, salas: salas, onSalas: onSalas }) })] }));
}
/** Servidor > Membros e cargos. */
function PaginaMembros(p) {
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: `Servidor · ${p.pessoas.length} membros`, titulo: "Membros e cargos", children: "O dono e os admins convidam, cuidam das salas e moderam. O cargo de cada pessoa aparece ao lado do nome." }), _jsx("div", { "data-ajuste": "membros-lista", children: _jsx(Membros, { ...p }) })] }));
}
/** "Este aparelho": another PC or leaving this one. Shown under Servidores for everyone. */
function EsteAparelho({ servidor, onSair }) {
    const [aparelho, setAparelho] = useState();
    const [erro, setErro] = useState();
    return (_jsxs("section", { "data-ajuste": "aparelho", className: "janela flex flex-col", children: [_jsxs("div", { className: "barra", children: ["Este aparelho", _jsx("span", { className: "ml-auto font-medium", children: new URL(servidor.url).host })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 p-4", children: [_jsx("button", { type: "button", className: "btn", onClick: async () => {
                            setErro(undefined);
                            try {
                                const link = await servidor.linkAparelho();
                                setAparelho(link);
                                await navigator.clipboard.writeText(link).catch(() => undefined);
                            }
                            catch (e) {
                                setErro(e instanceof Error ? e.message : String(e));
                            }
                        }, children: "Entrar em outro aparelho" }), _jsx("button", { type: "button", className: "btn text-perigo", onClick: onSair, children: "Sair deste aparelho" }), aparelho && (_jsxs("p", { role: "status", className: "m-0 basis-full text-[14px]", children: ["Link copiado. Abra no outro PC em at\u00E9 10 minutos; ele vale uma vez: ", _jsx("code", { className: "font-mono break-all", children: aparelho })] })), _jsx(Erro, { texto: erro })] })] }));
}
function Convites({ servidor }) {
    const [lista, setLista] = useState(null);
    const [falha, setFalha] = useState();
    const setErro = (texto, refazer) => setFalha(texto ? { texto, refazer } : undefined);
    const [copiado, setCopiado] = useState();
    const carregar = () => {
        setErro(undefined);
        return servidor.convites().then(setLista, (e) => { setLista([]); setErro(e.message, () => void carregar()); });
    };
    useEffect(() => void carregar(), [servidor]);
    const gerar = async () => {
        setErro(undefined);
        try {
            const c = await servidor.criarConvite();
            setLista((l) => [c, ...(l ?? [])]);
            await copiar(c);
        }
        catch (e) {
            setErro(`Não deu para gerar o convite. ${e instanceof Error ? e.message : String(e)}`, () => void gerar());
        }
    };
    const copiar = async (c) => {
        if (!c.link)
            return;
        await navigator.clipboard.writeText(c.link).catch(() => undefined);
        setCopiado(c.id);
    };
    return (_jsxs("section", { className: "janela flex flex-col", "aria-busy": lista === null, children: [_jsxs("div", { className: "barra", children: ["Convites", _jsx("span", { className: "ml-auto font-medium", children: "1 uso \u00B7 7 dias" })] }), _jsxs("div", { className: "flex flex-col gap-3 p-4", children: [_jsxs("button", { type: "button", className: "btn btn-prim self-start", onClick: () => void gerar(), children: [_jsx(Icone, { nome: "link" }), "Gerar convite"] }), _jsx(Erro, { texto: falha?.texto, onTentar: falha?.refazer }), lista === null && _jsx("div", { className: "skeleton h-11" }), lista?.length === 0 && !falha && _jsx("p", { className: "m-0 text-[14px] text-texto-fraco", children: "Nenhum convite ativo. Gere um e mande no WhatsApp." }), _jsx("ul", { className: "m-0 flex list-none flex-col p-0", children: lista?.map((c) => (_jsxs("li", { className: "flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0", children: [_jsxs("span", { className: "rotulo tabular-nums", children: [c.usos, "/", c.usosMax, " usos \u00B7 vence ", data(c.expiraEm)] }), copiado === c.id && _jsx("span", { role: "status", className: "text-[13px] text-texto-fraco", children: "Copiado" }), _jsxs("span", { className: "ml-auto flex gap-2", children: [c.link && _jsxs("button", { type: "button", className: "btn", onClick: () => void copiar(c), children: [_jsx(Icone, { nome: "copiar" }), "Copiar link"] }), _jsx("button", { type: "button", className: "btn text-perigo", onClick: async () => {
                                                await servidor.revogarConvite(c.id).then(() => setLista((l) => l?.filter((x) => x.id !== c.id) ?? null), (e) => setErro(e.message));
                                            }, children: "Revogar" })] })] }, c.id))) })] })] }));
}
function Salas({ servidor, salas, onSalas }) {
    const [nova, setNova] = useState('');
    const [editando, setEditando] = useState(null);
    const [erro, setErro] = useState();
    const tentar = async (f) => {
        setErro(undefined);
        try {
            await f();
        }
        catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
        }
    };
    const criar = (e) => {
        e.preventDefault();
        if (!nova.trim())
            return;
        void tentar(async () => {
            onSalas([...salas, await servidor.criarSala(nova.trim())]);
            setNova('');
        });
    };
    return (_jsxs("section", { className: "janela flex flex-col", children: [_jsxs("div", { className: "barra", children: ["Salas", _jsx("span", { className: "ml-auto font-medium", children: salas.length })] }), _jsxs("div", { className: "flex flex-col gap-3 p-4", children: [_jsx("ul", { className: "m-0 flex list-none flex-col p-0", children: salas.map((s) => (_jsx("li", { className: "flex min-h-11 items-center gap-2 border-t border-borda py-1.5 first:border-t-0", children: editando?.id === s.id ? (_jsxs("form", { className: "flex flex-1 gap-2", onSubmit: (e) => {
                                    e.preventDefault();
                                    void tentar(async () => {
                                        const r = await servidor.renomearSala(s.id, editando.nome.trim());
                                        onSalas(salas.map((x) => (x.id === s.id ? r : x)));
                                        setEditando(null);
                                    });
                                }, children: [_jsxs("label", { htmlFor: `sala-${s.id}`, className: "sr-only", children: ["Novo nome da sala ", s.nome] }), _jsx("input", { id: `sala-${s.id}`, className: "campo flex-1", value: editando.nome, maxLength: 32, autoFocus: true, onChange: (e) => setEditando({ id: s.id, nome: e.target.value }) }), _jsx("button", { type: "submit", className: "btn btn-prim", disabled: !editando.nome.trim(), children: "Salvar" }), _jsx("button", { type: "button", className: "btn", onClick: () => setEditando(null), children: "Cancelar" })] })) : (_jsxs(_Fragment, { children: [_jsx("b", { className: "flex-1", children: s.nome }), _jsx("button", { type: "button", className: "btn", onClick: () => setEditando({ id: s.id, nome: s.nome }), children: "Renomear" }), _jsx("button", { type: "button", className: "btn text-perigo", onClick: () => void tentar(async () => {
                                            await servidor.apagarSala(s.id);
                                            onSalas(salas.filter((x) => x.id !== s.id));
                                        }), children: "Apagar" })] })) }, s.id))) }), _jsxs("form", { onSubmit: criar, className: "flex gap-2", children: [_jsx("label", { htmlFor: "nova-sala", className: "sr-only", children: "Nome da nova sala" }), _jsx("input", { id: "nova-sala", className: "campo flex-1", placeholder: "Nome da nova sala", value: nova, maxLength: 32, onChange: (e) => setNova(e.target.value) }), _jsxs("button", { type: "submit", className: "btn", disabled: !nova.trim(), children: [_jsx(Icone, { nome: "mais" }), "Criar sala"] })] }), _jsx(Erro, { texto: erro })] })] }));
}
function Membros({ servidor, eu, pessoas, onPessoas }) {
    const [confirmar, setConfirmar] = useState(null);
    const [erro, setErro] = useState();
    return (_jsxs("section", { className: "janela flex flex-col", children: [_jsxs("div", { className: "barra", children: ["Pessoas", _jsx("span", { className: "ml-auto font-medium", children: pessoas.length })] }), _jsx("ul", { className: "m-0 flex list-none flex-col p-4", children: pessoas.map((p) => (_jsxs("li", { className: "flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0", children: [_jsx(Avatar, { pessoa: p, tamanho: 32 }), _jsx("b", { children: p.nome }), _jsx("span", { className: "rotulo", children: p.papel }), p.id !== eu.id && p.papel !== 'dono' && (confirmar === p.id ? (_jsxs("span", { className: "ml-auto flex gap-2", children: [_jsx("button", { type: "button", className: "btn border-perigo text-perigo", onClick: async () => {
                                        setErro(undefined);
                                        await servidor.remover(p.id).then(() => onPessoas(pessoas.filter((x) => x.id !== p.id)), (e) => setErro(e.message));
                                        setConfirmar(null);
                                    }, children: "Confirmar remo\u00E7\u00E3o" }), _jsx("button", { type: "button", className: "btn", onClick: () => setConfirmar(null), children: "Cancelar" })] })) : (_jsx("button", { type: "button", className: "btn ml-auto", onClick: () => setConfirmar(p.id), children: "Remover" })))] }, p.id))) }), erro && _jsx("div", { className: "px-4 pb-4", children: _jsx(Erro, { texto: erro }) }), _jsx("p", { className: "m-0 border-t border-borda px-4 py-3 text-[13px] text-texto-fraco", children: "Remover derruba a pessoa da sala e encerra as sess\u00F5es dela em todos os aparelhos." })] }));
}
function SecaoServidores({ atual, servidor, eu, onTrocar, onColarConvite, onSair }) {
    const lista = lerServidores();
    const ativo = atual ?? servidorAtual();
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: `App · ${lista.length === 1 ? '1 servidor' : `${lista.length} servidores`}`, titulo: "Servidores", children: "Cada servidor \u00E9 uma turma. Para entrar em outro, cole o convite que essa turma mandou." }), _jsxs("section", { "data-ajuste": "servidores-lista", className: "janela flex flex-col", children: [_jsx("div", { className: "barra", children: "Seus servidores" }), _jsxs("ul", { className: "m-0 flex list-none flex-col p-4", children: [lista.length === 0 && _jsx("li", { className: "text-texto-fraco", children: "Nenhum servidor salvo neste PC." }), lista.map((s) => (_jsxs("li", { className: "flex min-h-11 items-center gap-3 border-t border-borda py-1.5 first:border-t-0", children: [_jsx("b", { children: s.nome }), _jsx("span", { className: "rotulo truncate", children: new URL(s.url).host }), s.url === ativo ? (_jsx("span", { className: "rotulo ml-auto", children: "em uso" })) : (_jsx("button", { type: "button", className: "btn ml-auto", onClick: () => { escolherServidor(s.url); onTrocar(s.url); }, children: "Usar este" }))] }, s.url)))] }), _jsx("div", { className: "border-t border-texto p-4", children: _jsxs("button", { type: "button", className: "btn btn-prim", onClick: onColarConvite, children: [_jsx(Icone, { nome: "mais" }), "Adicionar servidor com convite"] }) })] }), servidor && eu && _jsx(EsteAparelho, { servidor: servidor, onSair: onSair })] }));
}
function SecaoSobre({ updater, inCall, onNotes }) {
    const [history, setHistory] = useState([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState('');
    useEffect(() => void loadChangelog().then(setHistory), []);
    const current = history.find((v) => v.version === updater.current);
    const busy = updater.status === 'downloading' || updater.status === 'installing';
    return (_jsxs(_Fragment, { children: [_jsx(Cabecalho, { rotulo: "App \u00B7 canal est\u00E1vel", titulo: "Sobre e atualiza\u00E7\u00F5es" }), _jsxs("div", { "data-ajuste": "atualizacoes", className: "grid grid-cols-2 gap-4", children: [_jsxs("section", { className: "janela flex flex-col", children: [_jsx("div", { className: "barra barra-lima", children: "Instalado" }), _jsxs("div", { className: "flex flex-col gap-3 p-4", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsx("b", { className: "font-display tabular-nums text-[48px] leading-none", children: updater.current }), _jsx("span", { className: "text-texto-fraco", children: current ? formatDate(current.date) : '' })] }), _jsxs("span", { className: "text-texto-fraco", children: [updater.lastCheck ? `Última checagem: hoje, ${hhmm(updater.lastCheck)}` : 'Ainda não checou nesta sessão', updater.status === 'uptodate' && ' · você está na versão mais nova'] }), updater.status === 'error' && _jsxs("p", { role: "alert", className: "m-0 text-perigo", children: ["N\u00E3o deu para checar: ", updater.error] }), _jsx("button", { type: "button", disabled: updater.status === 'checking', onClick: () => void updater.check(), className: "btn self-start", children: updater.status === 'checking' ? 'Procurando…' : 'Procurar atualização' })] })] }), updater.available ? (_jsxs("section", { className: "janela flex flex-col", children: [_jsx("div", { className: "barra barra-ar", children: "Dispon\u00EDvel" }), _jsxs("div", { className: "flex flex-col gap-3 p-4", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsx("b", { className: "font-display tabular-nums text-[48px] leading-none", children: updater.available.version }), updater.available.date && _jsxs("span", { className: "text-texto-fraco", children: ["publicada em ", new Date(updater.available.date).toLocaleDateString('pt-BR')] })] }), _jsx("span", { children: updater.waitingForLeave ? 'Baixada. Instala quando você sair da sala.'
                                            : inCall ? 'Você está numa chamada. A atualização baixa agora e instala quando você sair da sala.'
                                                : 'O app fecha, instala e abre de novo.' }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", disabled: busy || updater.waitingForLeave, onClick: () => void updater.apply(), className: "btn btn-prim", children: updateButtonLabel(updater, inCall) }), _jsx("button", { type: "button", onClick: onNotes, className: "btn", children: "Ver novidades" })] })] })] })) : (_jsxs("section", { className: "janela flex flex-col", children: [_jsx("div", { className: "barra", children: "Dispon\u00EDvel" }), _jsx("p", { className: "m-0 p-4 text-texto-fraco", children: "Nada novo por enquanto. O app procura ao abrir e a cada 6 horas." })] }))] }), _jsxs("label", { className: "janela flex items-center gap-4 px-4 py-3", children: [_jsxs("span", { className: "flex flex-1 flex-col gap-0.5", children: [_jsx("b", { children: "Canal" }), _jsx("span", { className: "text-texto-fraco", children: "O canal de teste chega depois. Por enquanto todo mundo recebe as vers\u00F5es est\u00E1veis." })] }), _jsx("select", { disabled: true, value: "estavel", className: "campo w-auto", children: _jsx("option", { value: "estavel", children: "Est\u00E1vel" }) })] }), isTauri() && (_jsxs("section", { "data-ajuste": "teste-placa", className: "janela flex items-center gap-4 px-4 py-3", children: [_jsx("button", { type: "button", disabled: testing, className: "btn", onClick: async () => {
                            setTesting(true);
                            setTestResult('');
                            try {
                                const { trials } = await testMachine(true);
                                setTestResult(trials.some((trial) => trial.ok) ? 'Teste da placa de vídeo concluído.' : 'Nenhum codificador de hardware disponível.');
                            }
                            catch (error) {
                                setTestResult(String(error));
                            }
                            finally {
                                setTesting(false);
                            }
                        }, children: testing ? 'Testando a placa…' : 'Refazer teste da placa de vídeo' }), _jsx("span", { role: "status", className: "text-texto-fraco", children: testResult })] })), _jsxs("section", { className: "janela flex flex-col", children: [_jsx("div", { className: "barra", children: "Hist\u00F3rico de vers\u00F5es" }), history.length === 0 && _jsx("div", { className: "skeleton m-4 h-11" }), history.map((h) => (_jsxs("div", { className: "grid min-h-11 grid-cols-[90px_120px_minmax(0,1fr)_auto] items-center gap-4 border-t border-borda px-4 first:border-t-0", children: [_jsx("b", { className: "font-display tabular-nums text-[20px]", children: h.version }), _jsx("span", { className: "text-texto-fraco", children: formatDate(h.date) }), _jsx("span", { className: "truncate", children: summarize(h) }), _jsx("button", { type: "button", onClick: onNotes, className: "btn btn-fant", children: "Ver notas" })] }, h.version)))] })] }));
}
