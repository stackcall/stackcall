import { describe, expect, it } from 'vitest';
import { ATRIBUTO_OUVE, ATRIBUTO_REDE, barrasDe, nomesReplay, opcoesMenuPessoa, ouveLista, quemRecebe, redeDe, textoRede } from './sala05';

const ouve = (...ids: string[]) => ({ [ATRIBUTO_OUVE]: JSON.stringify(ids) });

describe('quem recebe você (item 2)', () => {
  it('lists who receives my voice and who watches my screen', () => {
    const r = quemRecebe([
      { id: 'rafa', nome: 'Rafa', conectado: true, attributes: ouve('eu', 'duda') },
      { id: 'duda', nome: 'Duda', conectado: true, attributes: ouve('rafa') },
    ], 'eu', new Set(['rafa']));
    expect(r).toEqual([
      { id: 'rafa', nome: 'Rafa', voz: true, motivo: undefined, tela: true },
      { id: 'duda', nome: 'Duda', voz: false, motivo: undefined, tela: false },
    ]);
  });

  it('gives only technical reasons', () => {
    const r = quemRecebe([
      { id: 'a', nome: 'A', conectado: false },
      { id: 'b', nome: 'B', conectado: true, redeRuim: true, attributes: ouve() },
      { id: 'c', nome: 'C', conectado: true },
      { id: 'd', nome: 'D', conectado: true, attributes: { [ATRIBUTO_OUVE]: 'not json' } },
    ], 'eu', new Set());
    expect(r.map((x) => x.motivo)).toEqual(['conectando', 'modo internet ruim', 'app antigo', 'app antigo']);
  });

  it('keeps someone silenced for me in the published list (the volume is never published)', () => {
    // ouveLista has no volume input: a person at volume 0 is still subscribed, so still listed.
    expect(ouveLista([{ id: 'leo', assinado: true }, { id: 'ana', assinado: true }, { id: 'zé', assinado: false }], false)).toEqual(['ana', 'leo']);
    expect(ouveLista([{ id: 'leo', assinado: true }], true)).toEqual([]);
  });
});

describe('menu da pessoa (item 5)', () => {
  const base = ['volume', 'perfil', 'cutucar', 'silenciarParaMim'];
  it('shows moderation only to the owner and admins', () => {
    expect(opcoesMenuPessoa({ meuPapel: 'membro', papelDela: 'membro', noAr: false })).toEqual(base);
    expect(opcoesMenuPessoa({ meuPapel: 'dono', papelDela: 'admin', noAr: false })).toEqual([...base, 'mover', 'tirar']);
    expect(opcoesMenuPessoa({ meuPapel: 'admin', papelDela: 'membro', noAr: false })).toContain('tirar');
  });
  it('never moderates the owner, and an admin does not moderate an admin', () => {
    expect(opcoesMenuPessoa({ meuPapel: 'admin', papelDela: 'dono', noAr: false })).toEqual(base);
    expect(opcoesMenuPessoa({ meuPapel: 'admin', papelDela: 'admin', noAr: false })).toEqual(base);
  });
  it('offers watching only when the person is on the air', () => {
    expect(opcoesMenuPessoa({ meuPapel: 'membro', noAr: true })).toEqual(['volume', 'perfil', 'assistir', 'cutucar', 'silenciarParaMim']);
  });
});

describe('rede por pessoa e modo internet ruim (item 8)', () => {
  it('maps LiveKit quality and lets the published numbers say "ruim" first', () => {
    expect(redeDe('excellent')).toEqual({ qualidade: 'boa', ms: undefined, perda: undefined });
    expect(redeDe('good').qualidade).toBe('media');
    expect(redeDe('lost').qualidade).toBe('ruim');
    expect(redeDe('mystery').qualidade).toBe('desconhecida');
    expect(redeDe('excellent', { [ATRIBUTO_REDE]: JSON.stringify({ ms: 210.4, perda: 0.03 }) })).toEqual({ qualidade: 'ruim', ms: 210, perda: 0.03 });
    expect(redeDe('excellent', { [ATRIBUTO_REDE]: JSON.stringify({ ms: 40, perda: 0.01 }) }).qualidade).toBe('boa');
  });
  it('ignores invalid numbers', () => {
    expect(redeDe('good', { [ATRIBUTO_REDE]: JSON.stringify({ ms: -1, perda: 2 }) })).toEqual({ qualidade: 'media', ms: undefined, perda: undefined });
    expect(redeDe('good', { [ATRIBUTO_REDE]: '{' }).qualidade).toBe('media');
  });
  it('writes the channel text only when the network is bad', () => {
    expect(textoRede({ qualidade: 'ruim', ms: 210, perda: 0.031 })).toBe('rede ruim · 210 ms · 3% perda');
    expect(textoRede({ qualidade: 'ruim' })).toBe('rede ruim');
    expect(textoRede({ qualidade: 'boa', ms: 20 })).toBeNull();
    expect([barrasDe('boa'), barrasDe('media'), barrasDe('ruim'), barrasDe('desconhecida')]).toEqual([3, 2, 1, 0]);
  });
});

describe('nomesReplay', () => {
  it('joins names in Portuguese', () => {
    expect(nomesReplay([])).toBe('');
    expect(nomesReplay(['Rafa'])).toBe('Rafa');
    expect(nomesReplay(['Rafa', 'Duda', 'Léo'])).toBe('Rafa, Duda e Léo');
  });
});
