import { invoke, isTauri } from '@tauri-apps/api/core';
import { store } from './config';

/**
 * Porteiro API (docs/PLANO-ABERTO.md). One server = one group of friends.
 * Real calls go through the Rust `api` command, which keeps the device session in the
 * Windows Credential Manager; the WebView never sees the token.
 */

export type Papel = 'dono' | 'admin' | 'membro';
export type TemaPerfil = 'papel' | 'noite' | 'lima';
export type Usuario = {
  id: string;
  nome: string;
  papel: Papel;
  avatar: string | null;
  banner: string | null;
  bio: string;
  tema: TemaPerfil;
  cor: string | null;
};
export type Pessoa = Usuario & {
  online: boolean;
  amigo: boolean;
  sala: string | null;
  /** 0.5: game detected on that person's PC (docs/api-v05.md), null when none. */
  jogo?: string | null;
  /** 0.5: pokes this person sent to me, still valid (deduplicate by id). */
  cutucadas?: Cutucada[];
};
/** POST /api/cutucar answer and the items of `cutucadas` in the presence. */
export type Cutucada = { id: string; recado: string; salaId: string | null; expiraEm: number };
/** Room moderation (docs/api-v05.md): owner and admins only. */
export type AcaoModeracao = { acao: 'mover'; usuarioId: string; destinoId: string } | { acao: 'silenciar'; usuarioId: string } | { acao: 'retirar'; usuarioId: string };
export type Sala = { id: string; nome: string; ordem: number; pessoas: number; noAr: boolean };
export type Convite = { id: string; link: string | null; expiraEm: string; usos: number; usosMax: number };
export type InfoServidor = { nome: string; versao: string };
export type Previa = { servidor: string; convidadoPor: string };
export type TokenSala = { url: string; token: string; screen_token: string };
export type Perfil = Partial<Pick<Usuario, 'nome' | 'bio' | 'tema' | 'cor'>>;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MENSAGENS: Record<number, string> = {
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
export const mensagemDe = (status: number) =>
  MENSAGENS[status] ?? `O servidor recusou o pedido (código ${status}). Atualize o app e tente de novo.`;

/**
 * Central 401: the Rust side already dropped the device session. App listens and goes to the
 * entry screen. Routes that answer 401 for a bad code (not a dead session) are left out.
 */
const ouvintesSessao = new Set<(servidor: string) => void>();
export function aoPerderSessao(f: (servidor: string) => void) {
  ouvintesSessao.add(f);
  return () => void ouvintesSessao.delete(f);
}
const rotaDeCodigo = (metodo: string, rota: string) =>
  rota === '/api/aparelhos/entrar' || /^\/api\/convites\/[^/]+\/aceitar$/.test(rota) || (metodo === 'GET' && /^\/api\/convites\/[^/]+$/.test(rota));

export interface Servidor {
  readonly url: string;
  temSessao(): Promise<boolean>;
  info(): Promise<InfoServidor>;
  previa(codigo: string): Promise<Previa>;
  aceitar(codigo: string, nome: string): Promise<Usuario>;
  linkAparelho(): Promise<string>;
  entrarAparelho(codigo: string): Promise<Usuario>;
  sair(): Promise<void>;
  eu(): Promise<Usuario>;
  perfil(dados: Perfil): Promise<Usuario>;
  imagem(tipo: 'avatar' | 'banner', webp: Blob): Promise<Usuario>;
  pessoas(): Promise<Pessoa[]>;
  amigo(id: string, sim: boolean): Promise<void>;
  remover(id: string): Promise<void>;
  salas(): Promise<Sala[]>;
  criarSala(nome: string): Promise<Sala>;
  renomearSala(id: string, nome: string): Promise<Sala>;
  apagarSala(id: string): Promise<void>;
  token(salaId: string): Promise<TokenSala>;
  convites(): Promise<Convite[]>;
  criarConvite(): Promise<Convite>;
  revogarConvite(id: string): Promise<void>;
  /** 0.5, optional so older fakes keep compiling. 429 = the 30 s limit for that person. */
  cutucar?(usuarioId: string, recado: string): Promise<Cutucada>;
  moderar?(salaId: string, acao: AcaoModeracao): Promise<void>;
}

const nomeAparelho = () => (navigator.userAgent.includes('Windows') ? 'PC com Windows' : 'Computador');

// The porteiro is written in another thread; accept snake_case and short names alike.
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const opt = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Avatar and banner: the porteiro sends the relative path `/media/<hash>.webp` (older builds a
 * bare hash). Both become an absolute URL on the server; a relative path would hit tauri.localhost.
 */
const midia = (v: unknown, base?: string) => {
  const s = opt(v);
  if (!s || !base) return s;
  if (/^[0-9a-f]{64}$/.test(s)) return `${base}/media/${s}.webp`;
  return s.startsWith('/media/') ? base + s : s;
};

export function lerUsuario(o: Record<string, unknown>, base?: string): Usuario {
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
const lerCutucada = (o: Record<string, unknown>): Cutucada => ({
  id: str(o.id),
  recado: str(o.recado ?? o.mensagem).slice(0, 80),
  salaId: opt(o.sala_id ?? o.salaId),
  expiraEm: Number(o.expira_em ?? o.expiraEm) || 0,
});
const lerPessoa = (o: Record<string, unknown>, base?: string): Pessoa => ({
  ...lerUsuario(o, base),
  online: !!o.online,
  amigo: !!o.amigo,
  sala: opt(o.sala ?? o.sala_id),
  jogo: opt(o.jogo),
  cutucadas: Array.isArray(o.cutucadas) ? (o.cutucadas as Record<string, unknown>[]).map(lerCutucada).filter((c) => c.id) : [],
});
const lerSala = (o: Record<string, unknown>): Sala => ({
  id: str(o.id),
  nome: str(o.nome),
  ordem: Number(o.ordem) || 0,
  pessoas: Number(o.pessoas) || 0,
  noAr: !!(o.no_ar ?? o.noAr),
});
// expira_em comes in Unix seconds from the porteiro.
const quando = (v: unknown) => (typeof v === 'number' ? new Date(v * 1000).toISOString() : str(v));
const lerConvite = (o: Record<string, unknown>): Convite => ({
  id: str(o.id),
  link: opt(o.link ?? o.url),
  expiraEm: quando(o.expira_em ?? o.expiraEm),
  usos: Number(o.usos) || 0,
  usosMax: Number(o.usos_max ?? o.usosMax) || 1,
});
type Obj = Record<string, unknown>;
const lista = (v: unknown, chave: string): Obj[] =>
  Array.isArray(v) ? v : Array.isArray((v as Obj | null)?.[chave]) ? ((v as Obj)[chave] as Obj[]) : [];

export function servidorReal(url: string): Servidor {
  async function chamar(metodo: string, rota: string, corpo?: unknown, webp?: Blob): Promise<Obj> {
    if (!isTauri()) throw new ApiError(0, 'Abra pelo app do Stackcall.');
    let r: { status: number; corpo: unknown };
    try {
      r = await invoke('api', {
        chamada: {
          servidor: url, metodo, rota, corpo: corpo ?? null,
          bytes: webp ? Array.from(new Uint8Array(await webp.arrayBuffer())) : null,
          tipo: webp ? 'image/webp' : null,
        },
      });
    } catch (e) {
      throw new ApiError(0, typeof e === 'string' ? e : MENSAGENS[0]);
    }
    if (r.status >= 400) {
      if (r.status === 401 && !rotaDeCodigo(metodo, rota)) ouvintesSessao.forEach((f) => f(url));
      const msg = (r.corpo as Obj | null)?.erro;
      throw new ApiError(r.status, typeof msg === 'string' && msg ? msg : mensagemDe(r.status));
    }
    return (r.corpo ?? {}) as Obj;
  }
  const base = url.replace(/\/+$/, '');
  const usuarioDe = (o: Obj) => lerUsuario((o.usuario as Obj) ?? o, base);
  const c = encodeURIComponent;
  return {
    url,
    temSessao: async () => (isTauri() ? invoke<boolean>('sessao_existe', { servidor: url }).catch(() => false) : false),
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
    // Assumed contract (the route was still being written): body { usuario_id, recado } -> 201 Cutucada.
    cutucar: async (usuarioId, recado) => lerCutucada(await chamar('POST', '/api/cutucar', { usuario_id: usuarioId, recado })),
    moderar: async (salaId, a) => void (await chamar('POST', `/api/salas/${c(salaId)}/moderacao/${a.acao}`,
      a.acao === 'mover' ? { usuario_id: a.usuarioId, destino_id: a.destinoId } : { usuario_id: a.usuarioId })),
  };
}

const MB = 1024 * 1024;
const UPLOAD_VALE_MS = 24 * 60 * 60 * 1000;
let medindo: { servidor: string; promessa: Promise<number | null> } | null = null;

/** Upload measured for this server in the last 24 h, or null. */
export function uploadGuardado(servidor: string): number | null {
  try {
    const o = JSON.parse(store.get('upload') ?? 'null') as { mbps: number; at: number; servidor: string } | null;
    return o && o.servidor === servidor && Date.now() - o.at < UPLOAD_VALE_MS && o.mbps > 0 ? o.mbps : null;
  } catch {
    return null;
  }
}

/** Saved upload when fresh; otherwise one test at a time per server, saved for 24 h. */
export function uploadMedido(servidor: string, refazer = false): Promise<number | null> {
  const guardado = refazer ? null : uploadGuardado(servidor);
  if (guardado !== null) return Promise.resolve(guardado);
  if (medindo?.servidor === servidor) return medindo.promessa;
  const promessa = medirUpload(servidor).then((mbps) => {
    if (mbps !== null) store.set('upload', JSON.stringify({ mbps, at: Date.now(), servidor }));
    return mbps;
  }).finally(() => {
    if (medindo?.promessa === promessa) medindo = null;
  });
  medindo = { servidor, promessa };
  return promessa;
}

/** Mbit/s of one connection, counting only requests of 1 MB or more (the slow TCP start is left out). */
export function taxaUpload(amostras: { bytes: number; ms: number }[]) {
  const grandes = amostras.filter((a) => a.bytes >= MB);
  const usadas = grandes.length ? grandes : amostras;
  const bytes = usadas.reduce((t, a) => t + a.bytes, 0);
  const ms = usadas.reduce((t, a) => t + a.ms, 0);
  return ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : 0;
}

/** Upload speed in Mbit/s against `POST /api/upload-test`, two connections in parallel; null when unreachable. */
export async function medirUpload(url: string, segundos = 5) {
  const alvo = url.replace(/\/+$/, '') + '/api/upload-test';
  const fim = performance.now() + segundos * 1000;
  const conexao = async () => {
    const amostras: { bytes: number; ms: number }[] = [];
    let size = 256 * 1024;
    while (performance.now() < fim) {
      const sent = performance.now();
      const response = await fetch(alvo, { method: 'POST', body: new Uint8Array(size), cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const ms = performance.now() - sent;
      amostras.push({ bytes: size, ms });
      // Grow until one request takes ~1 s, capped below the server limit (16 MB).
      if (ms < 1000 && size < 8 * MB) size *= 2;
    }
    return taxaUpload(amostras);
  };
  try {
    const taxas = await Promise.all([conexao(), conexao()]);
    return taxas[0] + taxas[1];
  } catch {
    return null;
  }
}
