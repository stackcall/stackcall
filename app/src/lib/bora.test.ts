import { describe, expect, it } from 'vitest';
import { resumoRespostas } from './bora';
import { lerBora } from './servidor';
import { linkDoEndereco } from './servidores';
import { enderecoCelular } from '../screens/config/Celular';

describe('Bora?', () => {
  it('lê o chamado do servidor e resume as respostas', () => {
    const b = lerBora({
      id: 'b1', autor: 'a', sala: 's', recado: 'premier', criado_em: 10, expira_em: 7210,
      respostas: [{ usuario: 'a', resposta: 'dentro', em: 1 }, { usuario: 'b', resposta: '10min', em: 2 }, { usuario: 'c', resposta: 'talvez', em: 3 }],
    });
    expect(b.respostas).toHaveLength(2);
    expect(resumoRespostas(b)).toBe('1 dentro · 1 em 10 min');
  });
});

describe('celular', () => {
  it('troca o link stackcall://aparelho pelo endereço do app web', () => {
    const codigo = 'a'.repeat(64);
    expect(enderecoCelular(`stackcall://aparelho?servidor=https%3A%2F%2Fgalera.test&codigo=${codigo}`))
      .toBe(`https://galera.test/app/#entrar=${codigo}`);
    expect(enderecoCelular('stackcall://aparelho?servidor=https%3A%2F%2Fgalera.test')).toBeNull();
  });

  it('lê o convite ou o código do endereço e limpa a barra', () => {
    history.replaceState(null, '', '/app/#convite=abc123XYZ');
    expect(linkDoEndereco()).toEqual({ servidor: location.origin, codigo: 'abc123XYZ', aparelho: false });
    expect(location.hash).toBe('');
    history.replaceState(null, '', `/app/#entrar=${'f'.repeat(64)}`);
    expect(linkDoEndereco()?.aparelho).toBe(true);
    history.replaceState(null, '', '/app/#convite=<script>');
    expect(linkDoEndereco()).toBeNull();
  });
});
