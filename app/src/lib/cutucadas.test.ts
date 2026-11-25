import { describe, expect, it } from 'vitest';
import { esperaCutucar, fraseCutucada, marcarCutucada, novasCutucadas } from './cutucadas';
import type { Cutucadas } from './preferencias';
import type { Pessoa } from './servidor';

const prefs = (receberDe: Cutucadas['receberDe']): Cutucadas => ({ receberDe, voz: true, volume: 0.8, mesmoSilenciado: true, avisoWindows: false });
const pessoa = (id: string, amigo: boolean, cutucadas: Pessoa['cutucadas']): Pessoa => ({
  id, nome: id, papel: 'membro', avatar: null, banner: null, bio: '', tema: 'papel', cor: null,
  online: true, amigo, sala: null, cutucadas,
});

describe('cutucar (item 6)', () => {
  it('builds the sentence the other person hears', () => {
    expect(fraseCutucada('Rafa', '  bora jogar ')).toBe('Rafa te cutucou: bora jogar');
    expect(fraseCutucada('Rafa', '   ')).toBe('Rafa te cutucou');
  });

  it('limits one poke per person every 30 s', () => {
    expect(esperaCutucar('x', 1_000)).toBe(0);
    marcarCutucada('x', 1_000);
    expect(esperaCutucar('x', 1_000)).toBe(30);
    expect(esperaCutucar('x', 30_500)).toBe(1);
    expect(esperaCutucar('x', 31_000)).toBe(0);
    expect(esperaCutucar('y', 1_000)).toBe(0);
  });

  it('announces each poke once and drops expired ones', () => {
    const vistas = new Set<string>();
    const lista = [pessoa('rafa', false, [{ id: 'k1', recado: 'oi', salaId: 'cs', expiraEm: 200 }, { id: 'k0', recado: 'velha', salaId: null, expiraEm: 50 }])];
    expect(novasCutucadas(lista, vistas, prefs('todos'), 100).map((r) => r.id)).toEqual(['k1']);
    expect(novasCutucadas(lista, vistas, prefs('todos'), 100)).toEqual([]);
  });

  it('filters by "receber de"', () => {
    const lista = [pessoa('amiga', true, [{ id: 'a', recado: '', salaId: null, expiraEm: 0 }]), pessoa('outro', false, [{ id: 'b', recado: '', salaId: null, expiraEm: 0 }])];
    expect(novasCutucadas(lista, new Set(), prefs('amigos'), 1).map((r) => r.id)).toEqual(['a']);
    expect(novasCutucadas(lista, new Set(), prefs('ninguem'), 1)).toEqual([]);
    expect(novasCutucadas(lista, new Set(), prefs('todos'), 1).map((r) => r.de.id)).toEqual(['amiga', 'outro']);
  });
});
