import { ApiError, type Convite, type Pessoa, type ReceberCutucadas, type Sala, type Servidor, type Usuario } from './servidor';

/**
 * Fake server for development and tests (`?demo=1` or VITE_SERVIDOR_FALSO=1 in dev).
 * Same contract as the porteiro; data lives in memory.
 */
export const modoFalso = () =>
  import.meta.env.DEV && (import.meta.env.VITE_SERVIDOR_FALSO === '1' || new URLSearchParams(location.search).has('demo'));

const espera = (ms = 250) => (import.meta.env.MODE === 'test' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

const pessoa = (id: string, nome: string, p: Partial<Pessoa> = {}): Pessoa => ({
  id, nome, papel: 'membro', avatar: null, banner: null, bio: '', tema: 'papel', cor: null,
  online: true, amigo: false, sala: 'cs', jogo: null, ...p,
});

export function servidorFalso(url = 'https://galera.exemplo'): Servidor {
  // Only the demo's own server starts signed in; another server (an invite from outra.turma) has
  // no credential on this PC, like the real app.
  let sessao = url === 'https://galera.exemplo' && new URLSearchParams(location.search).get('tela') !== 'entrada';
  let eu: Usuario = { id: 'bronze', nome: 'bronze', papel: 'dono', avatar: null, banner: null, bio: 'entro de awp', tema: 'papel', cor: '#c8191f' };
  // ?grupo=pequeno: the real common case (one room, nobody in voice, one friend offline).
  const pequeno = new URLSearchParams(location.search).get('grupo') === 'pequeno';
  const pessoas: Pessoa[] = pequeno ? [pessoa('caio', 'Caio', { online: false, sala: null, amigo: true })] : [
    pessoa('rafa', 'Rafa', { amigo: true, bio: 'clutch ou nada', tema: 'noite', cor: '#ff5a5f', jogo: 'Counter-Strike 2' }),
    pessoa('duda', 'Duda', { amigo: true, tema: 'lima', bio: 'mira de rifle, coração de pistol', jogo: 'Counter-Strike 2' }),
    pessoa('leo', 'Léo', { sala: 'cs', jogo: 'Counter-Strike 2' }),
    pessoa('nanda', 'Nanda', { papel: 'admin', jogo: 'Counter-Strike 2' }),
    pessoa('bia', 'Bia', { sala: 'lobby', amigo: true }),
    pessoa('gus', 'Gus', { sala: 'lobby', jogo: 'Forza Horizon 5' }),
    pessoa('tati', 'Tati', { sala: null }),
    pessoa('caio', 'Caio', { online: false, sala: null }),
  ];
  const cutucou = new Map<string, number>();
  // ?cutucada=1: Bia (in the Lobby) poked me. Like the porteiro, my own profile carries it once.
  let pendentes = new URLSearchParams(location.search).has('cutucada') ? [{ id: 'k-demo', de: 'bia', recado: 'a sala tá pronta', criadoEm: 0 }] : [];
  const comPendentes = (lista: Pessoa[]) => {
    if (!pendentes.length) return lista;
    const minhas = pendentes;
    pendentes = [];
    return [...lista, { ...eu, online: true, amigo: false, sala: null, jogo: null, cutucadas: minhas }];
  };
  let salas: Sala[] = pequeno ? [{ id: 'geral', nome: 'Geral', ordem: 1, pessoas: 0, noAr: false }] : [
    { id: 'cs', nome: 'CS', ordem: 1, pessoas: 5, noAr: true },
    { id: 'lobby', nome: 'Lobby', ordem: 2, pessoas: 2, noAr: false },
    { id: 'cinema', nome: 'Cinema', ordem: 3, pessoas: 0, noAr: false },
    { id: 'ranked', nome: 'Ranked', ordem: 4, pessoas: 0, noAr: false },
  ];
  let receber: ReceberCutucadas = 'todos';
  let convites: Convite[] = [{ id: 'c1', link: null, expiraEm: '2026-12-01T21:00:00Z', usos: 0, usosMax: 1 }];
  const exigeSessao = () => {
    if (!sessao) throw new ApiError(401, 'Sua sessão neste aparelho acabou. Peça um convite novo.');
  };
  const entrar = (nome: string) => {
    if (!nome.trim()) throw new ApiError(400, 'Digite um nome.');
    sessao = true;
    eu = { ...eu, nome: nome.trim() };
    return eu;
  };
  return {
    url,
    temSessao: async () => sessao,
    info: async () => (await espera(), { nome: 'Galera', versao: '0.3.0', dorme: { ligado: true, minutos: 30, dormindo: false } }),
    previa: async (codigo) => {
      await espera();
      if (codigo === 'expirado') throw new ApiError(410, 'Este link já foi usado ou expirou. Peça outro.');
      return { servidor: 'Galera', convidadoPor: 'Filippe' };
    },
    aceitar: async (_codigo, nome) => (await espera(), entrar(nome)),
    linkAparelho: async () => (exigeSessao(), `${url}/c/aparelho-${Math.random().toString(36).slice(2, 10)}`),
    entrarAparelho: async () => (await espera(), entrar(eu.nome)),
    sair: async () => void (sessao = false),
    eu: async () => (await espera(), exigeSessao(), eu),
    perfil: async (dados) => (await espera(), (eu = { ...eu, ...dados })),
    imagem: async (tipo, webp) => {
      await espera();
      const link = URL.createObjectURL(webp);
      eu = tipo === 'avatar' ? { ...eu, avatar: link } : { ...eu, banner: link };
      return eu;
    },
    pessoas: async () => (await espera(), exigeSessao(), comPendentes(pessoas.map((p) => ({ ...p })))),
    amigo: async (id, sim) => {
      const p = pessoas.find((x) => x.id === id);
      if (p) p.amigo = sim;
    },
    cargo: async (id, cargo) => {
      const p = pessoas.find((x) => x.id === id);
      if (!p || p.papel === 'dono') throw new ApiError(403, 'Só o dono pode fazer isso.');
      p.papel = cargo;
    },
    remover: async (id) => {
      const i = pessoas.findIndex((x) => x.id === id);
      if (i >= 0) pessoas.splice(i, 1);
    },
    // Counts come from the people list, so a card never says "2 pessoas" without their names.
    salas: async () => (await espera(), exigeSessao(), salas.map((s) => ({ ...s, pessoas: pessoas.filter((p) => p.online && p.sala === s.id).length }))),
    criarSala: async (nome) => {
      const s = { id: `sala-${salas.length + 1}`, nome, ordem: salas.length + 1, pessoas: 0, noAr: false };
      salas = [...salas, s];
      return s;
    },
    renomearSala: async (id, nome) => {
      salas = salas.map((s) => (s.id === id ? { ...s, nome } : s));
      return salas.find((s) => s.id === id)!;
    },
    apagarSala: async (id) => void (salas = salas.filter((s) => s.id !== id)),
    token: async () => {
      throw new ApiError(0, 'Servidor falso: a sala usa dados de demonstração.');
    },
    tokenCs2: async (paiId, time) => (await espera(), `${paiId}:cs:${time}`),
    convites: async () => (await espera(), convites.map((c) => ({ ...c }))),
    criarConvite: async (opcoes) => {
      const c = { id: `c${convites.length + 1}`, link: `${url}/c/${Math.random().toString(36).slice(2, 12)}`, expiraEm: '2026-12-01T21:00:00Z', usos: 0, usosMax: opcoes?.usos ?? 1 };
      convites = [c, ...convites];
      return c;
    },
    revogarConvite: async (id) => void (convites = convites.filter((c) => c.id !== id)),
    jogo: async () => undefined,
    cutucadas: async () => (await espera(), receber),
    salvarCutucadas: async (r) => void (receber = r),
    cutucar: async (para) => {
      await espera();
      if (Date.now() - (cutucou.get(para) ?? 0) < 30_000) throw new ApiError(429, 'Espere 30 s para cutucar essa pessoa de novo.');
      cutucou.set(para, Date.now());
    },
    moderar: async (_salaId, a) => {
      await espera();
      if (a.acao === 'silenciar') return;
      const p = pessoas.find((x) => x.id === a.usuarioId);
      if (!p) throw new ApiError(404, 'Não encontrado.');
      p.sala = a.acao === 'mover' ? a.destinoId : null;
    },
  };
}
