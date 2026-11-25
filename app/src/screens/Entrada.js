import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { lerConvite } from '../lib/convite';
import { NAME_PATTERN, store } from '../lib/config';
import { SERVIDOR_OFICIAL, lerServidores } from '../lib/servidores';
/** No password and no address to type: the invite link brings the server, the person types a name. */
export function Entrada({ link, servidorDe, onLink, onEntrou, onConfig, onVoltar }) {
    return (_jsxs("div", { className: "grid h-full grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)] items-center gap-10 overflow-y-auto px-14 py-10", children: [_jsxs("div", { className: "flex flex-col gap-5", children: [_jsxs("span", { className: "font-display text-[34px] leading-none", children: ["stack", _jsx("span", { className: "text-destaque", children: "call" })] }), _jsxs("h1", { className: "text-[96px]", children: ["Bora pra ", _jsx("span", { className: "font-pincel inline-block -rotate-3 text-[0.8em] text-destaque normal-case", children: "call" })] }), _jsx("p", { className: "m-0 max-w-[46ch] text-[17px] text-texto-fraco", children: "Voz, tela e conversa com a sua turma. N\u00E3o tem senha nem cadastro: quem j\u00E1 est\u00E1 no grupo manda um link de convite." }), _jsxs("span", { className: "rotulo", children: ["v", __APP_VERSION__] })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [link ? (_jsx(ComLink, { link: link, servidor: servidorDe(link.servidor), onTrocar: () => onLink(null), onEntrou: onEntrou }, `${link.servidor}/${link.codigo}`)) : (_jsx(ColarLink, { onLink: onLink })), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [onVoltar && _jsx("button", { type: "button", className: "btn btn-fant", onClick: onVoltar, children: "Voltar para o servidor" }), _jsx("button", { type: "button", className: "btn btn-fant ml-auto", onClick: onConfig, children: "Sobre e atualiza\u00E7\u00F5es" })] })] })] }));
}
function ColarLink({ onLink }) {
    const [texto, setTexto] = useState('');
    const [erro, setErro] = useState();
    function enviar(e) {
        e.preventDefault();
        const link = lerConvite(texto);
        if (!link)
            return setErro('Isso não parece um link de convite. Ele começa com https:// e tem /c/ no meio.');
        setErro(undefined);
        onLink(link);
    }
    return (_jsxs("form", { onSubmit: enviar, className: "janela flex flex-col", "aria-label": "Entrar com convite", children: [_jsx("div", { className: "barra", children: "Entrar com convite" }), _jsxs("div", { className: "flex flex-col gap-3 p-5", children: [_jsx("label", { htmlFor: "link", className: "font-bold", children: "Colar link de convite" }), _jsx("input", { id: "link", className: "campo", value: texto, onChange: (e) => setTexto(e.target.value), placeholder: "https://servidor/c/\u2026", autoComplete: "off", spellCheck: false, "aria-invalid": !!erro, "aria-describedby": "link-ajuda" }), _jsx("span", { id: "link-ajuda", className: `text-[13px] ${erro ? 'text-perigo' : 'text-texto-fraco'}`, role: erro ? 'alert' : undefined, children: erro ?? 'Recebeu o link no celular? Cole aqui. Se abrir o link neste PC, o app já entra sozinho.' }), _jsx("button", { type: "submit", className: "btn btn-prim btn-lg", disabled: !texto.trim(), children: "Continuar" })] })] }));
}
function ComLink({ link, servidor, onTrocar, onEntrou }) {
    const [previa, setPrevia] = useState(null);
    const [erroPrevia, setErroPrevia] = useState();
    const [nome, setNome] = useState(() => store.get('nome') ?? '');
    const [erro, setErro] = useState();
    const [ocupado, setOcupado] = useState(false);
    const conhecido = link.servidor === SERVIDOR_OFICIAL || lerServidores().some((s) => s.url === link.servidor);
    const host = new URL(link.servidor).host;
    useEffect(() => {
        if (link.aparelho)
            return;
        let vivo = true;
        servidor.previa(link.codigo).then((p) => vivo && setPrevia(p), (e) => vivo && setErroPrevia(e.message));
        return () => { vivo = false; };
    }, [servidor, link]);
    async function entrar(e) {
        e.preventDefault();
        if (!link.aparelho && !NAME_PATTERN.test(nome.trim()))
            return setErro('O nome deve ter de 1 a 32 caracteres, sem dois-pontos.');
        setOcupado(true);
        setErro(undefined);
        try {
            const eu = link.aparelho ? await servidor.entrarAparelho(link.codigo) : await servidor.aceitar(link.codigo, nome.trim());
            store.set('nome', eu.nome);
            const info = await servidor.info().catch(() => ({ nome: previa?.servidor || host, versao: '' }));
            onEntrou(servidor, info.nome, eu);
        }
        catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
            setOcupado(false);
        }
    }
    if (erroPrevia) {
        return (_jsxs("div", { className: "janela flex flex-col", children: [_jsx("div", { className: "barra", children: "Convite" }), _jsxs("div", { className: "flex flex-col gap-3 p-5", children: [_jsx("p", { role: "alert", className: "m-0 text-perigo", children: erroPrevia }), _jsx("button", { type: "button", className: "btn", onClick: onTrocar, children: "Colar outro link" })] })] }));
    }
    return (_jsxs("form", { onSubmit: entrar, className: "janela flex flex-col", "aria-label": "Entrar no servidor", "aria-busy": !previa && !link.aparelho, children: [_jsxs("div", { className: "barra barra-lima", children: [link.aparelho ? 'Entrar neste aparelho' : 'Convite', _jsx("span", { className: "ml-auto truncate font-medium", children: host })] }), _jsxs("div", { className: "flex flex-col gap-4 p-5", children: [link.aparelho ? (_jsx("p", { className: "m-0", children: "Este link entra com a sua conta neste PC. Ele vale uma vez s\u00F3, por 10 minutos." })) : previa ? (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "rotulo", children: previa.convidadoPor ? `${previa.convidadoPor} chamou você para` : 'Você foi chamado para' }), _jsx("b", { className: "font-display text-[48px]", children: previa.servidor || host })] })) : (_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "skeleton h-4 w-40" }), _jsx("span", { className: "skeleton h-12 w-64" })] })), !conhecido && (_jsxs("p", { className: "m-0 border border-texto bg-superficie-alta px-3 py-2 text-[14px]", children: ["Este servidor n\u00E3o \u00E9 o oficial: ", _jsx("b", { children: host }), ". Entre s\u00F3 se conhece quem mandou o link."] })), !link.aparelho && (_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("label", { htmlFor: "nome", className: "font-bold", children: "Seu nome" }), _jsx("input", { id: "nome", className: "campo", value: nome, onChange: (e) => setNome(e.target.value), autoComplete: "nickname", maxLength: 32, "aria-invalid": !!erro, "aria-describedby": "nome-ajuda", autoFocus: true }), _jsx("span", { id: "nome-ajuda", className: "text-[13px] text-texto-fraco", children: "\u00C9 como a galera v\u00EA voc\u00EA." })] })), erro && _jsx("p", { role: "alert", className: "m-0 text-perigo", children: erro }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", className: "btn", onClick: onTrocar, disabled: ocupado, children: "Outro link" }), _jsx("button", { type: "submit", className: "btn btn-prim btn-lg flex-1", disabled: ocupado || (!previa && !link.aparelho), children: ocupado ? 'Entrando…' : conhecido ? 'Entrar' : `Entrar em ${host}` })] })] })] }));
}
