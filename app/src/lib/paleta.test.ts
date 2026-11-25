import { describe, expect, it } from 'vitest';
import { filtrarPaleta, moverFoco, type ItemPaleta } from './paleta';

const item = (id: string, grupo: ItemPaleta['grupo'], rotulo: string, extra: Partial<ItemPaleta> = {}): ItemPaleta =>
  ({ id, grupo, rotulo, onde: '', icone: 'busca', executar: () => {}, ...extra });

const itens = [
  item('voz', 'config', 'Voz e microfone', { apelidos: ['ptt'] }),
  item('leo', 'salas', 'Léo', { pessoa: true, detalhe: 'na CS' }),
  item('cs', 'salas', 'Entrar na CS'),
  item('rede', 'acoes', 'Modo internet ruim', { detalhe: 'desligado' }),
];

describe('paleta (item 7)', () => {
  it('keeps the group order: actions, rooms and people, settings', () => {
    expect(filtrarPaleta(itens, '').map((i) => i.id)).toEqual(['rede', 'leo', 'cs', 'voz']);
  });
  it('ignores accents and case, and needs every word', () => {
    expect(filtrarPaleta(itens, 'LEO').map((i) => i.id)).toEqual(['leo']);
    expect(filtrarPaleta(itens, 'internet ruim').map((i) => i.id)).toEqual(['rede']);
    expect(filtrarPaleta(itens, 'internet boa')).toEqual([]);
    expect(filtrarPaleta(itens, 'ptt').map((i) => i.id)).toEqual(['voz']);
  });
  it('> keeps only actions and @ only people', () => {
    expect(filtrarPaleta(itens, '>').map((i) => i.id)).toEqual(['rede']);
    expect(filtrarPaleta(itens, '> cs')).toEqual([]);
    expect(filtrarPaleta(itens, '@').map((i) => i.id)).toEqual(['leo']);
    expect(filtrarPaleta(itens, '@ cs').map((i) => i.id)).toEqual(['leo']);
  });
  it('moves the highlight around with the arrows', () => {
    expect(moverFoco(0, 3, -1)).toBe(2);
    expect(moverFoco(2, 3, 1)).toBe(0);
    expect(moverFoco(0, 0, 1)).toBe(0);
  });
});
