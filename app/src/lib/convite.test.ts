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
