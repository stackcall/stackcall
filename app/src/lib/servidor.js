import { invoke, isTauri } from '@tauri-apps/api/core';
import { store } from './config';
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const MENSAGENS = {
    0: 'Servidor fora do ar ou sem internet.',
    400: 'Dados inválidos. Confira o que digitou.',
    401: 'Sua sessão neste aparelho acabou. Peça um convite novo.',
    403: 'Só o dono ou um admin pode fazer isso.',
    404: 'Não encontrado. O link pode ter expirado ou sido revogado.',
    410: 'Este link já foi usado ou expirou. Peça outro.',
    413: 'Imagem grande demais. Escolha um arquivo menor.',
    415: 'Formato não aceito. Use uma imagem PNG, JPG ou WebP.',
    422: 'O servidor não conseguiu ler essa imagem. Tente outra.',
    429: 'Muitas tentativas. Espere um minuto.',
    500: 'O servidor teve um erro interno. Tente de novo em instantes.',
    502: 'O servidor de voz não respondeu. Tente de novo em instantes.',
    503: 'Servidor ocupado. Tente de novo em alguns segundos.',
    504: 'O servidor demorou demais para responder. Tente de novo.',
};
/** Text for an HTTP status the porteiro sent without its own `erro` message. */
export const mensagemDe = (status) => MENSAGENS[status] ?? `O servidor recusou o pedido (código ${status}). Atualize o app e tente de novo.`;
/**
 * Central 401: the Rust side already dropped the device session. App listens and goes to the
 * entry screen. Routes that answer 401 for a bad code (not a dead session) are left out.
 */
const ouvintesSessao = new Set();
export function aoPerderSessao(f) {
    ouvintesSessao.add(f);
    return () => void ouvintesSessao.delete(f);
}
const rotaDeCodigo = (metodo, rota) => rota === '/api/aparelhos/entrar' || /^\/api\/convites\/[^/]+\/aceitar$/.test(rota) || (metodo === 'GET' && /^\/api\/convites\/[^/]+$/.test(rota));
const nomeAparelho = () => (navigator.userAgent.includes('Windows') ? 'PC com Windows' : 'Computador');
// The porteiro is written in another thread; accept snake_case and short names alike.
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const opt = (v) => (typeof v === 'string' && v ? v : null);
/**
 * Avatar and banner: the porteiro sends the relative path `/media/<hash>.webp` (older builds a
 * bare hash). Both become an absolute URL on the server; a relative path would hit tauri.localhost.
 */
const midia = (v, base) => {
    const s = opt(v);
    if (!s || !base)
        return s;
    if (/^[0-9a-f]{64}$/.test(s))
        return `${base}/media/${s}.webp`;
    return s.startsWith('/media/') ? base + s : s;
};
export function lerUsuario(o, base) {
    const tema = str(o.tema_perfil ?? o.tema);
    const papel = str(o.papel);
    return {
        id: str(o.id),
        nome: str(o.nome),
        papel: papel === 'dono' || papel === 'admin' ? papel : 'membro',
        avatar: midia(o.avatar ?? o.avatar_url, base),
        banner: midia(o.banner ?? o.banner_url, base),
        bio: str(o.bio),
        tema: tema === 'noite' || tema === 'lima' ? tema : 'papel',
        cor: opt(o.cor),
    };
}
const lerCutucada = (o) => ({
    id: str(o.id),
    de: str(o.de),
    recado: str(o.recado).slice(0, 80),
    criadoEm: Number(o.criado_em) || 0,
});
const lerPessoa = (o, base) => ({
    ...lerUsuario(o, base),
    online: !!o.online,
    amigo: !!o.amigo,
    sala: opt(o.sala ?? o.sala_id),
    jogo: opt(o.jogo),
    cutucadas: Array.isArray(o.cutucadas) ? o.cutucadas.map(lerCutucada).filter((c) => c.id && c.de) : undefined,
});
const receberDe = (v) => (v === 'amigos' || v === 'ninguem' ? v : 'todos');
const lerSala = (o) => ({
    id: str(o.id),
    nome: str(o.nome),
    ordem: Number(o.ordem) || 0,
    pessoas: Number(o.pessoas) || 0,
    noAr: !!(o.no_ar ?? o.noAr),
});
// expira_em comes in Unix seconds from the porteiro.
const quando = (v) => (typeof v === 'number' ? new Date(v * 1000).toISOString() : str(v));
const lerConvite = (o) => ({
    id: str(o.id),
    link: opt(o.link ?? o.url),
    expiraEm: quando(o.expira_em ?? o.expiraEm),
    usos: Number(o.usos) || 0,
    usosMax: Number(o.usos_max ?? o.usosMax) || 1,
});
const lista = (v, chave) => Array.isArray(v) ? v : Array.isArray(v?.[chave]) ? v[chave] : [];
export function servidorReal(url) {
    async function chamar(metodo, rota, corpo, webp) {
        if (!isTauri())
            throw new ApiError(0, 'Abra pelo app do Stackcall.');
        let r;
        try {
            r = await invoke('api', {
                chamada: {
                    servidor: url, metodo, rota, corpo: corpo ?? null,
                    bytes: webp ? Array.from(new Uint8Array(await webp.arrayBuffer())) : null,
                    tipo: webp ? 'image/webp' : null,
                },
            });
        }
        catch (e) {
            throw new ApiError(0, typeof e === 'string' ? e : MENSAGENS[0]);
        }
        if (r.status >= 400) {
            if (r.status === 401 && !rotaDeCodigo(metodo, rota))
                ouvintesSessao.forEach((f) => f(url));
            const msg = r.corpo?.erro;
            throw new ApiError(r.status, typeof msg === 'string' && msg ? msg : mensagemDe(r.status));
        }
        return (r.corpo ?? {});
    }
    const base = url.replace(/\/+$/, '');
    const usuarioDe = (o) => lerUsuario(o.usuario ?? o, base);
    const c = encodeURIComponent;
    return {
        url,
        temSessao: async () => (isTauri() ? invoke('sessao_existe', { servidor: url }).catch(() => false) : false),
        info: async () => {
            const o = await chamar('GET', '/api/servidor');
            return { nome: str(o.nome) || new URL(url).hostname, versao: str(o.versao) };
        },
        previa: async (codigo) => {
            const o = await chamar('GET', `/api/convites/${c(codigo)}`);
            return { servidor: str(o.servidor ?? o.nome), convidadoPor: str(o.convidado_por ?? o.convidadoPor) };
        },
        aceitar: async (codigo, nome) => usuarioDe(await chamar('POST', `/api/convites/${c(codigo)}/aceitar`, { nome, aparelho: nomeAparelho() })),
        linkAparelho: async () => {
            const o = await chamar('POST', '/api/aparelhos/link');
            return str(o.url ?? o.link);
        },
        entrarAparelho: async (codigo) => usuarioDe(await chamar('POST', '/api/aparelhos/entrar', { codigo, aparelho: nomeAparelho() })),
        sair: async () => void (await chamar('POST', '/api/sair').catch(() => undefined)),
        eu: async () => usuarioDe(await chamar('GET', '/api/eu')),
        perfil: async ({ tema, ...resto }) => usuarioDe(await chamar('PATCH', '/api/eu/perfil', tema ? { ...resto, tema_perfil: tema } : resto)),
        imagem: async (tipo, webp) => usuarioDe(await chamar('PUT', `/api/eu/${tipo}`, undefined, webp)),
        pessoas: async () => lista(await chamar('GET', '/api/pessoas'), 'pessoas').map((o) => lerPessoa(o, base)),
        amigo: async (id, sim) => void (await chamar(sim ? 'POST' : 'DELETE', `/api/amigos/${c(id)}`)),
        remover: async (id) => void (await chamar('DELETE', `/api/pessoas/${c(id)}`)),
        salas: async () => lista(await chamar('GET', '/api/salas'), 'salas').map(lerSala).sort((a, b) => a.ordem - b.ordem),
        criarSala: async (nome) => lerSala(await chamar('POST', '/api/salas', { nome })),
        renomearSala: async (id, nome) => lerSala(await chamar('PATCH', `/api/salas/${c(id)}`, { nome })),
        apagarSala: async (id) => void (await chamar('DELETE', `/api/salas/${c(id)}`)),
        token: async (salaId) => {
            const o = await chamar('POST', `/api/salas/${c(salaId)}/token`);
            if (typeof o.url !== 'string' || typeof o.token !== 'string' || typeof o.screen_token !== 'string') {
                throw new ApiError(502, 'Resposta inesperada do servidor.');
            }
            return { url: o.url, token: o.token, screen_token: o.screen_token };
        },
        convites: async () => lista(await chamar('GET', '/api/convites'), 'convites')
            .filter((o) => !o.revogado && !(typeof o.expira_em === 'number' && o.expira_em * 1000 < Date.now()) && Number(o.usos) < Number(o.usos_max ?? 1))
            .map(lerConvite),
        // The porteiro reads a JSON body here (axum answers 415 without one), so send an empty object.
        criarConvite: async () => lerConvite(await chamar('POST', '/api/convites', {})),
        revogarConvite: async (id) => void (await chamar('DELETE', `/api/convites/${c(id)}`)),
        jogo: async (nome) => void (await chamar('PUT', '/api/eu/jogo', { jogo: nome })),
        cutucadas: async () => receberDe((await chamar('GET', '/api/eu/cutucadas')).receber),
        salvarCutucadas: async (receber) => void (await chamar('PUT', '/api/eu/cutucadas', { receber })),
        cutucar: async (para, recado) => void (await chamar('POST', '/api/cutucar', { para, recado })),
        moderar: async (salaId, a) => void (await chamar('POST', `/api/salas/${c(salaId)}/moderacao/${a.acao}`, a.acao === 'mover' ? { usuario_id: a.usuarioId, destino_id: a.destinoId } : a.acao === 'retirar' ? { usuario_id: a.usuarioId } : {})),
    };
}
const MB = 1024 * 1024;
const UPLOAD_VALE_MS = 24 * 60 * 60 * 1000;
let medindo = null;
/** Upload measured for this server in the last 24 h, or null. */
export function uploadGuardado(servidor) {
    try {
        const o = JSON.parse(store.get('upload') ?? 'null');
        return o && o.servidor === servidor && Date.now() - o.at < UPLOAD_VALE_MS && o.mbps > 0 ? o.mbps : null;
    }
    catch {
        return null;
    }
}
/** Saved upload when fresh; otherwise one test at a time per server, saved for 24 h. */
export function uploadMedido(servidor, refazer = false) {
    const guardado = refazer ? null : uploadGuardado(servidor);
    if (guardado !== null)
        return Promise.resolve(guardado);
    if (medindo?.servidor === servidor)
        return medindo.promessa;
    const promessa = medirUpload(servidor).then((mbps) => {
        if (mbps !== null)
            store.set('upload', JSON.stringify({ mbps, at: Date.now(), servidor }));
        return mbps;
    }).finally(() => {
        if (medindo?.promessa === promessa)
            medindo = null;
    });
    medindo = { servidor, promessa };
    return promessa;
}
/** Mbit/s of one connection, counting only requests of 1 MB or more (the slow TCP start is left out). */
export function taxaUpload(amostras) {
    const grandes = amostras.filter((a) => a.bytes >= MB);
    const usadas = grandes.length ? grandes : amostras;
    const bytes = usadas.reduce((t, a) => t + a.bytes, 0);
    const ms = usadas.reduce((t, a) => t + a.ms, 0);
    return ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : 0;
}
/** Upload speed in Mbit/s against `POST /api/upload-test`, two connections in parallel; null when unreachable. */
export async function medirUpload(url, segundos = 5) {
    const alvo = url.replace(/\/+$/, '') + '/api/upload-test';
    const fim = performance.now() + segundos * 1000;
    const conexao = async () => {
        const amostras = [];
        let size = 256 * 1024;
        while (performance.now() < fim) {
            const sent = performance.now();
            const response = await fetch(alvo, { method: 'POST', body: new Uint8Array(size), cache: 'no-store' });
            if (!response.ok)
                throw new Error(String(response.status));
            const ms = performance.now() - sent;
            amostras.push({ bytes: size, ms });
            // Grow until one request takes ~1 s, capped below the server limit (16 MB).
            if (ms < 1000 && size < 8 * MB)
                size *= 2;
        }
        return taxaUpload(amostras);
    };
    try {
        const taxas = await Promise.all([conexao(), conexao()]);
        return taxas[0] + taxas[1];
    }
    catch {
        return null;
    }
}
