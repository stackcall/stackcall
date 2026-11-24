import { ApiError, type Convite, type Pessoa, type Sala, type Servidor, type Usuario } from './servidor';

/**
 * Fake server for development and tests (`?demo=1` or VITE_SERVIDOR_FALSO=1 in dev).
 * Same contract as the porteiro; data lives in memory.
 */
export const modoFalso = () =>
  import.meta.env.DEV && (import.meta.env.VITE_SERVIDOR_FALSO === '1' || new URLSearchParams(location.search).has('demo'));

const espera = (ms = 250) => (import.meta.env.MODE === 'test' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

const pessoa = (id: string, nome: string, p: Partial<Pessoa> = {}): Pessoa => ({
  id, nome, papel: 'membro', avatar: null, banner: null, bio: '', tema: 'papel', cor: null,
  online: true, amigo: false, sala: 'cs', ...p,
});

export function servidorFalso(url = 'https://galera.exemplo'): Servidor {
  let sessao = new URLSearchParams(location.search).get('tela') !== 'entrada';
  let eu: Usuario = { id: 'bronze', nome: 'bronze', papel: 'dono', avatar: null, banner: null, bio: 'entro de awp', tema: 'papel', cor: '#c8191f' };
  const pessoas: Pessoa[] = [
    pessoa('rafa', 'Rafa', { amigo: true, bio: 'clutch ou nada', tema: 'noite', cor: '#ff5a5f' }),
    pessoa('duda', 'Duda', { amigo: true, tema: 'lima', bio: 'mira de rifle, coração de pistol' }),
    pessoa('leo', 'Léo', { sala: 'cs' }),
    pessoa('nanda', 'Nanda', { papel: 'admin' }),
    pessoa('caio', 'Caio', { online: false, sala: null }),
  ];
  let salas: Sala[] = [
    { id: 'cs', nome: 'CS', ordem: 1, pessoas: 5, noAr: true },
    { id: 'lobby', nome: 'Lobby', ordem: 2, pessoas: 2, noAr: false },
    { id: 'cinema', nome: 'Cinema', ordem: 3, pessoas: 0, noAr: false },
    { id: 'ranked', nome: 'Ranked', ordem: 4, pessoas: 0, noAr: false },
  ];
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
    info: async () => (await espera(), { nome: 'Galera', versao: '0.3.0' }),
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
    pessoas: async () => (await espera(), exigeSessao(), pessoas.map((p) => ({ ...p }))),
    amigo: async (id, sim) => {
      const p = pessoas.find((x) => x.id === id);
      if (p) p.amigo = sim;
    },
    remover: async (id) => {
      const i = pessoas.findIndex((x) => x.id === id);
      if (i >= 0) pessoas.splice(i, 1);
    },
    salas: async () => (await espera(), exigeSessao(), salas.map((s) => ({ ...s }))),
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
    convites: async () => (await espera(), convites.map((c) => ({ ...c }))),
    criarConvite: async () => {
      const c = { id: `c${convites.length + 1}`, link: `${url}/c/${Math.random().toString(36).slice(2, 12)}`, expiraEm: '2026-12-01T21:00:00Z', usos: 0, usosMax: 1 };
      convites = [c, ...convites];
      return c;
    },
    revogarConvite: async (id) => void (convites = convites.filter((c) => c.id !== id)),
  };
}
