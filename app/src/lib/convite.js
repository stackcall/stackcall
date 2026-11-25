const CODIGO = /^[A-Za-z0-9_-]{6,128}$/;
/** Server origin when the URL is https, or http on the local network (self-host at home). */
export function origemServidor(texto) {
    let url;
    try {
        url = new URL(texto.trim());
    }
    catch {
        return null;
    }
    if (url.username || url.password)
        return null;
    const h = url.hostname;
    const local = h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
        return null;
    return url.origin;
}
export function lerConvite(texto) {
    let url;
    try {
        url = new URL(texto.trim());
    }
    catch {
        return null;
    }
    if (url.protocol === 'stackcall:') {
        // stackcall://entrar?... parses with host "entrar" (or pathname "//entrar" on some engines).
        const acao = (url.host || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
        const servidor = origemServidor(url.searchParams.get('servidor') ?? '');
        const codigo = url.searchParams.get('codigo') ?? '';
        const ok = (acao === 'entrar' || acao === 'aparelho') && servidor && CODIGO.test(codigo);
        return ok ? { servidor, codigo, aparelho: acao === 'aparelho' } : null;
    }
    const servidor = origemServidor(texto);
    const m = /^\/(c|a)\/([^/]+)\/?$/.exec(url.pathname);
    return servidor && m && CODIGO.test(m[2]) ? { servidor, codigo: m[2], aparelho: m[1] === 'a' } : null;
}
