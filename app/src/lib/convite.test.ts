import { lerConvite, origemServidor } from './convite';
import { lerUsuario } from './servidor';

test('reads invite links from the web page and from the deep link', () => {
  expect(lerConvite('https://stackcall.example.test/c/abcDEF123_-')).toEqual({ servidor: 'https://stackcall.example.test', codigo: 'abcDEF123_-', aparelho: false });
  expect(lerConvite('  https://stackcall.example.test/c/abcDEF123/  ')).toMatchObject({ codigo: 'abcDEF123' });
  expect(lerConvite('stackcall://entrar?servidor=https%3A%2F%2Fgalera.test&codigo=abcdef12')).toEqual({ servidor: 'https://galera.test', codigo: 'abcdef12', aparelho: false });
  expect(lerConvite('stackcall://aparelho?servidor=https://galera.test&codigo=abcdef12')).toMatchObject({ aparelho: true });
  expect(lerConvite('https://galera.test/a/abcdef12')).toMatchObject({ aparelho: true });
});

test('refuses links that could send the session elsewhere', () => {
  expect(lerConvite('http://galera.test/c/abcdef12')).toBeNull(); // plain http outside the local network
  expect(lerConvite('https://user:pw@galera.test/c/abcdef12')).toBeNull();
  expect(lerConvite('https://galera.test/c/abc')).toBeNull(); // code too short
  expect(lerConvite('https://galera.test/c/abcdef12/extra')).toBeNull();
  expect(lerConvite('stackcall://entrar?servidor=javascript:alert(1)&codigo=abcdef12')).toBeNull();
  expect(lerConvite('stackcall://outra?servidor=https://galera.test&codigo=abcdef12')).toBeNull();
  expect(lerConvite('bora jogar')).toBeNull();
});

test('allows http only on the home network', () => {
  expect(origemServidor('http://192.168.0.20:8080/c/x')).toBe('http://192.168.0.20:8080');
  expect(origemServidor('http://localhost:3000')).toBe('http://localhost:3000');
  expect(origemServidor('http://8.8.8.8')).toBeNull();
});

test('accepts the porteiro user in snake_case', () => {
  expect(lerUsuario({ id: 7, nome: 'Rafa', papel: 'admin', avatar_url: '/media/a.webp', tema_perfil: 'noite', bio: null })).toEqual({
    id: '7', nome: 'Rafa', papel: 'admin', avatar: '/media/a.webp', banner: null, bio: '', tema: 'noite', cor: null,
  });
  expect(lerUsuario({ id: 'x', nome: 'y', papel: 'root', tema: 'neon' })).toMatchObject({ papel: 'membro', tema: 'papel' });
});

test('maps the porteiro media hash to its /media URL', () => {
  const hash = 'a'.repeat(64);
  expect(lerUsuario({ id: '1', nome: 'R', papel: 'dono', avatar: hash, banner: null }, 'https://galera.test')).toMatchObject({
    avatar: `https://galera.test/media/${hash}.webp`, banner: null,
  });
});

test('real server: invite, device link and profile follow the porteiro contract', async () => {
  const calls: { metodo: string; rota: string; corpo: unknown }[] = [];
  const respostas: Record<string, unknown> = {
    'POST /api/convites': { id: 'i1', codigo: 'c'.repeat(32), url: 'https://galera.test/c/' + 'c'.repeat(32), expira_em: 1_800_000_000, usos_max: 1 },
    'GET /api/convites': [
      { id: 'a', criado_por: 'u', expira_em: 4_000_000_000, usos_max: 1, usos: 0, revogado: false },
      { id: 'b', criado_por: 'u', expira_em: 4_000_000_000, usos_max: 1, usos: 0, revogado: true },
      { id: 'c', criado_por: 'u', expira_em: 4_000_000_000, usos_max: 1, usos: 1, revogado: false },
    ],
    'POST /api/aparelhos/link': { codigo: 'd'.repeat(64), url: 'stackcall://aparelho?servidor=https%3A%2F%2Fgalera.test&codigo=' + 'd'.repeat(64), expira_em: 1 },
    'PATCH /api/eu/perfil': { id: 'u', nome: 'R', papel: 'membro', avatar: null, banner: null, bio: 'oi', tema_perfil: 'lima', cor: null },
  };
  vi.resetModules();
  vi.doMock('@tauri-apps/api/core', () => ({
    isTauri: () => true,
    invoke: async (_cmd: string, { chamada }: { chamada: { metodo: string; rota: string; corpo: unknown } }) => {
      calls.push(chamada);
      return { status: 200, corpo: respostas[`${chamada.metodo} ${chamada.rota}`] };
    },
  }));
  const { servidorReal } = await import('./servidor');
  const s = servidorReal('https://galera.test');
  const c = await s.criarConvite();
  expect(c).toMatchObject({ link: 'https://galera.test/c/' + 'c'.repeat(32), expiraEm: new Date(1_800_000_000_000).toISOString() });
  expect((await s.convites()).map((x) => x.id)).toEqual(['a']);
  const link = await s.linkAparelho();
  const { lerConvite: ler } = await import('./convite');
  expect(ler(link)).toMatchObject({ servidor: 'https://galera.test', aparelho: true });
  expect(await s.perfil({ bio: 'oi', tema: 'lima' })).toMatchObject({ tema: 'lima', bio: 'oi' });
  expect(calls.at(-1)?.corpo).toEqual({ bio: 'oi', tema_perfil: 'lima' });
  vi.doUnmock('@tauri-apps/api/core');
});