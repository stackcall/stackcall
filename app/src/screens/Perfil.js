import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { CartaoPerfil } from '../components/CartaoPerfil';
import { Faixa } from '../components/Faixa';
import { AVATAR, BANNER, carregarImagem, posicao, recortar } from '../lib/imagem';
const CORES = [
    ['vermelho', '#c8191f'], ['azul', '#1f4fe0'], ['verde', '#1a7f37'],
    ['laranja', '#d9622b'], ['roxo', '#6b3fd4'], ['tinta', '#111111'],
];
const TEMAS = [['papel', 'Papel'], ['noite', 'Noite'], ['lima', 'Lima']];
const TAM = { avatar: AVATAR, banner: BANNER };
const PREVIA = 280; // preview box width in px
function Recorte({ ed, onMudar, onUsar, onCancelar, ocupado }) {
    const { largura, altura } = TAM[ed.tipo];
    const k = PREVIA / largura;
    const { naturalWidth: iw, naturalHeight: ih } = ed.img;
    const p = posicao(iw, ih, largura, altura, ed.corte);
    const arrasto = useRef(null);
    const mover = (e) => {
        const a = arrasto.current;
        if (!a)
            return;
        const q = posicao(iw, ih, largura, altura, a.c);
        const livreX = ((q.dw - largura) / 2) * k;
        const livreY = ((q.dh - altura) / 2) * k;
        const lim = (v) => Math.max(-1, Math.min(1, v));
        onMudar({
            zoom: a.c.zoom,
            x: livreX ? lim(a.c.x + (e.clientX - a.px) / livreX) : 0,
            y: livreY ? lim(a.c.y + (e.clientY - a.py) / livreY) : 0,
        });
    };
    return (_jsxs("div", { className: "janela mt-3", children: [_jsxs("div", { className: "barra", children: ["Ajustar ", ed.tipo === 'avatar' ? 'foto' : 'banner'] }), _jsxs("div", { className: "p-3", children: [_jsx("div", { className: "relative cursor-grab touch-none overflow-hidden border border-texto bg-superficie-alta", style: { width: PREVIA, height: altura * k }, onPointerDown: (e) => {
                            e.currentTarget.setPointerCapture?.(e.pointerId);
                            arrasto.current = { px: e.clientX, py: e.clientY, c: ed.corte };
                        }, onPointerMove: mover, onPointerUp: () => (arrasto.current = null), onPointerCancel: () => (arrasto.current = null), children: _jsx("img", { src: ed.url, alt: "", draggable: false, className: "pointer-events-none absolute max-w-none select-none", style: { left: p.dx * k, top: p.dy * k, width: p.dw * k, height: p.dh * k } }) }), _jsxs("label", { className: "rotulo mt-3 block", children: ["Zoom", _jsx("input", { type: "range", min: 1, max: 3, step: 0.05, value: ed.corte.zoom, className: "mt-1 block h-11 w-full", onChange: (e) => onMudar({ ...ed.corte, zoom: Number(e.target.value) }) })] }), _jsx("p", { className: "rotulo", children: "Arraste para posicionar." }), _jsxs("div", { className: "mt-3 flex gap-2", children: [_jsx("button", { type: "button", className: "btn", onClick: onCancelar, children: "Cancelar" }), _jsx("button", { type: "button", className: "btn btn-prim", disabled: ocupado, onClick: onUsar, children: "Usar esta foto" })] })] })] }));
}
export function Perfil({ servidor, eu, onSalvo, onFechar }) {
    const [bio, setBio] = useState(eu.bio);
    const [tema, setTema] = useState(eu.tema);
    const [cor, setCor] = useState(eu.cor);
    const [novo, setNovo] = useState({});
    const [ed, setEd] = useState(null);
    const [ocupado, setOcupado] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState('');
    const arquivoRef = useRef(null);
    const alvo = useRef('avatar');
    const urls = useRef([]);
    useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
    useEffect(() => {
        const tecla = (e) => e.key === 'Escape' && (ed ? setEd(null) : onFechar());
        window.addEventListener('keydown', tecla);
        return () => window.removeEventListener('keydown', tecla);
    }, [ed, onFechar]);
    const escolher = (tipo) => {
        alvo.current = tipo;
        arquivoRef.current?.click();
    };
    async function aoEscolher(e) {
        const arquivo = e.target.files?.[0];
        e.target.value = '';
        if (!arquivo)
            return;
        setErro('');
        try {
            const img = await carregarImagem(arquivo); // validates type and decodes
            const url = URL.createObjectURL(arquivo);
            urls.current.push(url);
            setEd({ tipo: alvo.current, arquivo, img, url, corte: { zoom: 1, x: 0, y: 0 } });
        }
        catch (x) {
            setErro(x.message);
        }
    }
    async function usar() {
        if (!ed)
            return;
        setOcupado(true);
        try {
            const { largura, altura } = TAM[ed.tipo];
            const blob = await recortar(ed.arquivo, largura, altura, ed.corte);
            const url = URL.createObjectURL(blob);
            urls.current.push(url);
            setNovo((n) => ({ ...n, [ed.tipo]: { blob, url } }));
            setEd(null);
        }
        catch (x) {
            setErro(x.message);
        }
        finally {
            setOcupado(false);
        }
    }
    async function salvar() {
        setSalvando(true);
        setErro('');
        try {
            let u = await servidor.perfil({ bio, tema, cor });
            if (novo.avatar)
                u = await servidor.imagem('avatar', novo.avatar.blob);
            if (novo.banner)
                u = await servidor.imagem('banner', novo.banner.blob);
            onSalvo(u);
        }
        catch (x) {
            setErro(x.message || 'Não foi possível salvar.');
            setSalvando(false);
        }
    }
    const previa = { ...eu, bio, tema, cor, avatar: novo.avatar?.url ?? eu.avatar, banner: novo.banner?.url ?? eu.banner };
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": "Perfil", className: "absolute inset-0 z-30 overflow-y-auto bg-fundo", children: _jsxs("div", { className: "mx-auto grid max-w-4xl gap-8 p-6 md:grid-cols-[1fr_340px]", children: [_jsxs("form", { className: "min-w-0", onSubmit: (e) => { e.preventDefault(); void salvar(); }, children: [_jsx("h1", { className: "text-[56px]", children: "Seu perfil" }), _jsx("input", { ref: arquivoRef, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, "aria-label": "Arquivo de imagem", onChange: aoEscolher }), _jsxs("div", { className: "mt-6 flex flex-wrap gap-2", children: [_jsx("button", { type: "button", className: "btn", onClick: () => escolher('avatar'), children: "Trocar foto" }), _jsx("button", { type: "button", className: "btn", onClick: () => escolher('banner'), children: "Trocar banner" })] }), ed && _jsx(Recorte, { ed: ed, ocupado: ocupado, onMudar: (corte) => setEd({ ...ed, corte }), onUsar: usar, onCancelar: () => setEd(null) }), _jsx("label", { className: "rotulo mt-6 block", htmlFor: "perfil-bio", children: "Bio" }), _jsx("textarea", { id: "perfil-bio", className: "campo mt-1 min-h-24 py-2", maxLength: 160, value: bio, onChange: (e) => setBio(e.target.value) }), _jsxs("p", { className: "rotulo text-right", children: [bio.length, "/160"] }), _jsx("p", { className: "rotulo mt-4", children: "Tema do cart\u00E3o" }), _jsx("div", { className: "abas mt-1", children: TEMAS.map(([id, nome]) => (_jsx("button", { type: "button", "aria-pressed": tema === id, onClick: () => setTema(id), children: nome }, id))) }), _jsx("p", { className: "rotulo mt-4", children: "Cor de destaque" }), _jsx("div", { className: "mt-1 flex flex-wrap gap-2", children: CORES.map(([nome, hex]) => (_jsx("button", { type: "button", "aria-label": nome, "aria-pressed": cor === hex, onClick: () => setCor(hex), className: `h-11 w-11 border border-texto ${cor === hex ? 'outline outline-2 outline-offset-2 outline-texto' : ''}`, style: { background: hex } }, hex))) }), erro && _jsx(Faixa, { className: "mt-4", acoes: [{ rotulo: 'Tentar de novo', onClick: () => void salvar() }], children: erro }), _jsxs("div", { className: "sticky bottom-0 mt-6 flex gap-2 border-t border-texto bg-fundo py-3", children: [_jsx("button", { type: "button", className: "btn", onClick: onFechar, children: "Cancelar" }), _jsx("button", { type: "submit", className: "btn btn-prim", disabled: salvando, children: salvando ? 'Salvando…' : 'Salvar' })] })] }), _jsxs("div", { children: [_jsx("p", { className: "rotulo mb-2", children: "Pr\u00E9via" }), _jsx(CartaoPerfil, { pessoa: previa, comoDialogo: false })] })] }) }));
}
