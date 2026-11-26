import { invoke, isTauri } from '@tauri-apps/api/core';
import { naWeb } from './ambiente';
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
/** `jogo`: game in the presence (docs/api-v05.md), null when none or older servers. */
export type Pessoa = Usuario & {
  online: boolean;
  amigo: boolean;
  sala: string | null;
  jogo: string | null;
  /** Only on my own profile: pokes waiting for me, consumed by this read (docs/api-v05.md, Cutucar). */
  cutucadas?: CutucadaPendente[];
};
/** Who may poke this person. Proposed route GET/PUT /api/eu/cutucadas (docs/design/v05-interface.md). */
export type ReceberCutucadas = 'todos' | 'amigos' | 'ninguem';
/** Item of `cutucadas` in my own profile: `de` is the sender's id, `criadoEm` Unix seconds. */
export type CutucadaPendente = { id: string; de: string; recado: string; criadoEm: number };
/** Room moderation (docs/api-v05.md): owner and admins only. `silenciar` acts on the whole room. */
export type AcaoModeracao = { acao: 'mover'; usuarioId: string; destinoId: string } | { acao: 'silenciar' } | { acao: 'retirar'; usuarioId: string };
/** `paiId` and `time`: CS2 sub-room ("CS · CT"), listed only while occupied (docs/api-v05.md). */
export type Sala = { id: string; nome: string; ordem: number; pessoas: number; noAr: boolean; paiId?: string | null; time?: 'ct' | 'tr' | null };
export type Convite = { id: string; link: string | null; expiraEm: string; usos: number; usosMax: number };
/** Voice server sleep (docs/api-v05.md): configured in the server .env, read only here. */
export type Dorme = { ligado: boolean; minutos: number | null; dormindo: boolean };
export type InfoServidor = { nome: string; versao: string; dorme: Dorme | null };
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

export type RespostaBora = 'dentro' | '10min' | 'nao';
export type Bora = {
  id: string; autor: string; sala: string | null; recado: string; criadoEm: number; expiraEm: number;
  respostas: { usuario: string; resposta: RespostaBora; em: number }[];
};
const RESPOSTAS: readonly RespostaBora[] = ['dentro', '10min', 'nao'];
export const lerBora = (o: Record<string, unknown>): Bora => ({
  id: String(o.id ?? ''),
  autor: String(o.autor ?? ''),
  sala: typeof o.sala === 'string' ? o.sala : null,
  recado: typeof o.recado === 'string' ? o.recado : '',
  criadoEm: Number(o.criado_em) || 0,
  expiraEm: Number(o.expira_em) || 0,
  respostas: (Array.isArray(o.respostas) ? o.respostas : [])
    .map((r: Record<string, unknown>) => ({ usuario: String(r.usuario ?? ''), resposta: r.resposta as RespostaBora, em: Number(r.em) || 0 }))
    .filter((r) => RESPOSTAS.includes(r.resposta)),
});

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
  /** Owner only: PUT /api/pessoas/{id}/cargo. */
  cargo(id: string, cargo: 'admin' | 'membro'): Promise<void>;
  salas(): Promise<Sala[]>;
  criarSala(nome: string): Promise<Sala>;
  renomearSala(id: string, nome: string): Promise<Sala>;
  apagarSala(id: string): Promise<void>;
  token(salaId: string): Promise<TokenSala>;
  /** POST /api/salas/{pai}/cs2/token: the id of the team sub-room (the voice token comes from `token`). */
  tokenCs2(paiId: string, time: 'ct' | 'tr'): Promise<string>;
  convites(): Promise<Convite[]>;
  /** `usos` > 1 makes a group link (owner and admins only). Defaults: 1 use, 7 days. */
  criarConvite(opcoes?: { usos?: number; dias?: number }): Promise<Convite>;
  revogarConvite(id: string): Promise<void>;
  /** PUT /api/eu/jogo; "" clears. */
  jogo(nome: string): Promise<void>;
  cutucadas(): Promise<ReceberCutucadas>;
  salvarCutucadas(receber: ReceberCutucadas): Promise<void>;
  /** POST /api/cutucar. 429 = the 30 s limit for that person, 403 = their preference refused. */
  cutucar(para: string, recado: string): Promise<void>;
  moderar(salaId: string, acao: AcaoModeracao): Promise<void>;
  /** "Bora?": open calls to play (2 h), newest first. */
  boras(): Promise<Bora[]>;
  criarBora(opcoes: { sala?: string; recado?: string }): Promise<string>;
  responderBora(id: string, resposta: RespostaBora): Promise<void>;
  encerrarBora(id: string): Promise<void>;
  /** Web Push (phone notices): the server key, then this browser's subscription. */
  pushChave(): Promise<string>;
  pushInscrever(inscricao: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  pushRemover(endpoint: string): Promise<void>;
}

const nomeAparelho = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone (navegador)';
  if (/Android/.test(ua)) return 'Celular Android (navegador)';
  if (naWeb()) return 'Navegador';
  return ua.includes('Windows') ? 'PC com Windows' : 'Computador';
};

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
const lerCutucada = (o: Record<string, unknown>): CutucadaPendente => ({
  id: str(o.id),
  de: str(o.de),
  recado: str(o.recado).slice(0, 80),
  criadoEm: Number(o.criado_em) || 0,
});
const lerPessoa = (o: Record<string, unknown>, base?: string): Pessoa => ({
  ...lerUsuario(o, base),
  online: !!o.online,
  amigo: !!o.amigo,
  sala: opt(o.sala ?? o.sala_id),
  jogo: opt(o.jogo),
  cutucadas: Array.isArray(o.cutucadas) ? (o.cutucadas as Record<string, unknown>[]).map(lerCutucada).filter((c) => c.id && c.de) : undefined,
});
const receberDe = (v: unknown): ReceberCutucadas => (v === 'amigos' || v === 'ninguem' ? v : 'todos');
/** Older servers have no `dorme`: null, and the page says the server does not report it. */
export const lerDorme = (v: unknown): Dorme | null => {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.ligado !== 'boolean') return null;
  return { ligado: o.ligado, minutos: typeof o.minutos === 'number' ? o.minutos : null, dormindo: o.dormindo === true };
};
const lerSala = (o: Record<string, unknown>): Sala => ({
  id: str(o.id),
  nome: str(o.nome),
  ordem: Number(o.ordem) || 0,
  pessoas: Number(o.pessoas) || 0,
  noAr: !!(o.no_ar ?? o.noAr),
  paiId: opt(o.pai_id),
  time: o.time === 'ct' || o.time === 'tr' ? o.time : null,
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

/** Web app: same-origin fetch; the session cookie goes along and writes carry the web header. */
async function viaNavegador(url: string, metodo: string, rota: string, corpo?: unknown, webp?: Blob) {
  const resposta = await fetch(`${url.replace(/\/+$/, '')}${rota}`, {
    method: metodo,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'x-stackcall-web': '1', ...(webp ? { 'content-type': 'image/webp' } : corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: webp ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
  });
  const texto = await resposta.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: resposta.status, corpo: json };
}

export function servidorReal(url: string): Servidor {
  async function chamar(metodo: string, rota: string, corpo?: unknown, webp?: Blob): Promise<Obj> {
    if (!isTauri() && !naWeb()) throw new ApiError(0, 'Abra pelo app do Stackcall.');
    let r: { status: number; corpo: unknown };
    try {
      r = naWeb() ? await viaNavegador(url, metodo, rota, corpo, webp) : await invoke('api', {
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
    // On the web the HttpOnly cookie is invisible to the page: asking /api/eu is the only check.
    temSessao: async () => (isTauri() ? invoke<boolean>('sessao_existe', { servidor: url }).catch(() => false)
      : naWeb() ? viaNavegador(url, 'GET', '/api/eu').then((r) => r.status === 200, () => false) : false),
    info: async () => {
      const o = await chamar('GET', '/api/servidor');
      return { nome: str(o.nome) || new URL(url).hostname, versao: str(o.versao), dorme: lerDorme(o.dorme) };
    },
    previa: async (codigo) => {
      const o = await chamar('GET', `/api/convites/${c(codigo)}`);
      return { servidor: str(o.servidor ?? o.nome), convidadoPor: str(o.convidado_por ?? o.convidadoPor) };
    },
    aceitar: async (codigo, nome) => usuarioDe(await chamar('POST', `/api/convites/${c(codigo)}/aceitar`, { nome, aparelho: nomeAparelho(), web: naWeb() })),
    linkAparelho: async () => {
      const o = await chamar('POST', '/api/aparelhos/link');
      return str(o.url ?? o.link);
    },
    entrarAparelho: async (codigo) => usuarioDe(await chamar('POST', '/api/aparelhos/entrar', { codigo, aparelho: nomeAparelho(), web: naWeb() })),
    sair: async () => void (await chamar('POST', '/api/sair').catch(() => undefined)),
    eu: async () => usuarioDe(await chamar('GET', '/api/eu')),
    perfil: async ({ tema, ...resto }) => usuarioDe(await chamar('PATCH', '/api/eu/perfil', tema ? { ...resto, tema_perfil: tema } : resto)),
    imagem: async (tipo, webp) => usuarioDe(await chamar('PUT', `/api/eu/${tipo}`, undefined, webp)),
    pessoas: async () => lista(await chamar('GET', '/api/pessoas'), 'pessoas').map((o) => lerPessoa(o, base)),
    amigo: async (id, sim) => void (await chamar(sim ? 'POST' : 'DELETE', `/api/amigos/${c(id)}`)),
    remover: async (id) => void (await chamar('DELETE', `/api/pessoas/${c(id)}`)),
    cargo: async (id, cargo) => void (await chamar('PUT', `/api/pessoas/${c(id)}/cargo`, { cargo })),
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
    tokenCs2: async (paiId, time) => {
      const o = await chamar('POST', `/api/salas/${c(paiId)}/cs2/token`, { time });
      if (typeof o.sala_id !== 'string') throw new ApiError(502, 'Resposta inesperada do servidor.');
      return o.sala_id;
    },
    convites: async () => lista(await chamar('GET', '/api/convites'), 'convites')
      .filter((o) => !o.revogado && !(typeof o.expira_em === 'number' && o.expira_em * 1000 < Date.now()) && Number(o.usos) < Number(o.usos_max ?? 1))
      .map(lerConvite),
    // The porteiro reads a JSON body here (axum answers 415 without one), so send an empty object.
    criarConvite: async (opcoes) =>
      lerConvite(await chamar('POST', '/api/convites', { usos_max: opcoes?.usos ?? 1, dias: opcoes?.dias ?? 7 })),
    revogarConvite: async (id) => void (await chamar('DELETE', `/api/convites/${c(id)}`)),
    jogo: async (nome) => void (await chamar('PUT', '/api/eu/jogo', { jogo: nome })),
    cutucadas: async () => receberDe((await chamar('GET', '/api/eu/cutucadas')).receber),
    salvarCutucadas: async (receber) => void (await chamar('PUT', '/api/eu/cutucadas', { receber })),
    cutucar: async (para, recado) => void (await chamar('POST', '/api/cutucar', { para, recado })),
    moderar: async (salaId, a) => void (await chamar('POST', `/api/salas/${c(salaId)}/moderacao/${a.acao}`,
      a.acao === 'mover' ? { usuario_id: a.usuarioId, destino_id: a.destinoId } : a.acao === 'retirar' ? { usuario_id: a.usuarioId } : {})),
    boras: async () => {
      const o = await chamar('GET', '/api/boras');
      return (Array.isArray(o) ? o : []).map(lerBora);
    },
    criarBora: async ({ sala, recado }) => str((await chamar('POST', '/api/boras', { ...(sala ? { sala } : {}), recado: recado ?? '' })).id),
    responderBora: async (id, resposta) => void (await chamar('POST', `/api/boras/${c(id)}/resposta`, { resposta })),
    encerrarBora: async (id) => void (await chamar('DELETE', `/api/boras/${c(id)}`)),
    pushChave: async () => str((await chamar('GET', '/api/push/chave')).chave),
    pushInscrever: async (inscricao) => void (await chamar('POST', '/api/push', inscricao)),
    pushRemover: async (endpoint) => void (await chamar('DELETE', '/api/push', { endpoint })),
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
