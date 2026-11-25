import { describe, expect, it } from 'vitest';
import { fraseCutucada } from './cutucar';
import { cutucadasPendentes, esperaCutucar, marcarCutucada } from './cutucadas';
import type { Pessoa } from './servidor';

const pessoa = (id: string, p: Partial<Pessoa> = {}): Pessoa => ({
  id, nome: id.toUpperCase(), papel: 'membro', avatar: null, banner: null, bio: '', tema: 'papel', cor: null,
  online: true, amigo: false, sala: null, jogo: null, ...p,
});

describe('cutucar (item 6)', () => {
  it('builds the sentence the other person hears', () => {
    expect(fraseCutucada({ de: 'Rafa', recado: '  bora jogar ' })).toBe('Rafa te cutucou: bora jogar');
    expect(fraseCutucada({ de: 'Rafa', recado: '   ' })).toBe('Rafa te cutucou');
  });

  it('limits one poke per person every 30 s', () => {
    expect(esperaCutucar('x', 1_000)).toBe(0);
    marcarCutucada('x', 1_000);
    expect(esperaCutucar('x', 1_000)).toBe(30);
    expect(esperaCutucar('x', 30_500)).toBe(1);
    expect(esperaCutucar('x', 31_000)).toBe(0);
    expect(esperaCutucar('y', 1_000)).toBe(0);
  });

  it('reads the pokes on my own profile with the sender name and room', () => {
    const salas = [{ id: 'lobby', nome: 'Lobby', ordem: 1, pessoas: 1, noAr: false }];
    const lista = [
      pessoa('bia', { sala: 'lobby' }),
      pessoa('eu', { cutucadas: [{ id: 'k1', de: 'bia', recado: 'oi', criadoEm: 1 }, { id: 'k2', de: 'sumiu', recado: '', criadoEm: 2 }] }),
    ];
    expect(cutucadasPendentes(lista, 'eu', salas)).toEqual([
      { id: 'k1', de: 'BIA', deId: 'bia', recado: 'oi', salaId: 'lobby', salaNome: 'Lobby' },
      { id: 'k2', de: 'Alguém', deId: 'sumiu', recado: '', salaId: null, salaNome: null },
    ]);
    expect(cutucadasPendentes(lista, 'bia', salas)).toEqual([]);
  });
});
