import { lerUsuario, mensagemDe } from './servidor';

type Chamada = { metodo: string; rota: string; corpo: unknown };

/** Real client against a fake Rust `api` command that answers `responder(chamada)`. */
async function servidorCom(responder: (c: Chamada) => { status: number; corpo?: unknown }) {
  const calls: Chamada[] = [];
  vi.resetModules();
  vi.doMock('@tauri-apps/api/core', () => ({
    isTauri: () => true,
    invoke: async (_cmd: string, { chamada }: { chamada: Chamada }) => {
      calls.push(chamada);
      return responder(chamada);
    },
  }));
  const mod = await import('./servidor');
  onTestFinished(() => vi.doUnmock('@tauri-apps/api/core'));
  return { mod, s: mod.servidorReal('https://galera.test'), calls };
}

test('creating an invite sends a JSON body (the porteiro answers 415 without one)', async () => {
  const { s, calls } = await servidorCom(() => ({ status: 201, corpo: { id: 'i', url: 'https://galera.test/c/abcdefgh', expira_em: 1, usos_max: 1 } }));
  await s.criarConvite();
  expect(calls[0]).toMatchObject({ metodo: 'POST', rota: '/api/convites', corpo: {} });
});

test('avatar and banner in the real porteiro format become absolute URLs', () => {
  const hash = 'b'.repeat(64);
  const u = lerUsuario({ id: '1', nome: 'R', papel: 'membro', avatar: `/media/${hash}.webp`, banner: `/media/${hash}.webp` }, 'https://galera.test');
  expect(u.avatar).toBe(`https://galera.test/media/${hash}.webp`);
  expect(u.banner).toBe(`https://galera.test/media/${hash}.webp`);
});

test('the people list carries absolute media URLs too', async () => {
  const { s } = await servidorCom(() => ({ status: 200, corpo: [{ id: 'p', nome: 'P', papel: 'membro', avatar: '/media/x.webp', online: true, sala: 'cs' }] }));
  expect(await s.pessoas()).toMatchObject([{ avatar: 'https://galera.test/media/x.webp', sala: 'cs' }]);
});

test('clear messages for every status the porteiro sends, and a readable fallback', async () => {
  for (const status of [413, 415, 422, 500, 502, 503, 504]) {
    expect(mensagemDe(status)).not.toMatch(/Erro do servidor/);
    expect(mensagemDe(status).length).toBeGreaterThan(20);
  }
  expect(mensagemDe(409)).toBe('O servidor recusou o pedido (código 409). Atualize o app e tente de novo.');
  const { s } = await servidorCom(() => ({ status: 503, corpo: null }));
  await expect(s.salas()).rejects.toMatchObject({ status: 503, message: 'Servidor ocupado. Tente de novo em alguns segundos.' });
});

test('the porteiro message wins over the generic one', async () => {
  const { s } = await servidorCom(() => ({ status: 413, corpo: { erro: 'Imagem acima de 4 MB.' } }));
  await expect(s.imagem('avatar', new Blob(['x']))).rejects.toThrow('Imagem acima de 4 MB.');
});

test('a 401 on an authenticated route ends the session centrally; a bad device code does not', async () => {
  const { mod, s } = await servidorCom(() => ({ status: 401 }));
  const perdeu = vi.fn();
  const parar = mod.aoPerderSessao(perdeu);
  await expect(s.entrarAparelho('c'.repeat(64))).rejects.toMatchObject({ status: 401 });
  await expect(s.aceitar('abcdefgh', 'Rafa')).rejects.toMatchObject({ status: 401 });
  expect(perdeu).not.toHaveBeenCalled();
  await expect(s.pessoas()).rejects.toMatchObject({ status: 401 });
  expect(perdeu).toHaveBeenCalledWith('https://galera.test');
  parar();
});
