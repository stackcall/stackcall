import { describe, expect, it } from 'vitest';
import { destinoCs2, salasVisiveis, subSala } from './cs2';
import { guardarClipe, lerClipes, tirarClipe, titulo } from './clipes';
import { posicaoFalantes, replay } from './nucleo';
import type { Sala } from './servidor';

const cs: Sala = { id: 'cs', nome: 'CS', ordem: 1, pessoas: 3, noAr: false, paiId: null, time: null };
const ct = subSala('cs:cs:ct', cs, 'ct');
const tr = subSala('cs:cs:tr', cs, 'tr');

describe('sala do mapa do CS2', () => {
  it('goes to the team sub-room during the match and back at the end', () => {
    expect(destinoCs2({ time: 'CT', fase: 'live' }, cs)).toEqual({ ir: 'time', pai: 'cs', time: 'ct' });
    expect(destinoCs2({ time: 'CT', fase: 'freezetime' }, ct)).toBeNull();
    expect(destinoCs2({ time: 'TR', fase: 'live' }, ct)).toEqual({ ir: 'time', pai: 'cs', time: 'tr' });
    expect(destinoCs2({ time: 'CT', fase: 'gameover' }, ct)).toEqual({ ir: 'pai', pai: 'cs' });
    expect(destinoCs2({ time: null, fase: null }, tr)).toEqual({ ir: 'pai', pai: 'cs' });
    expect(destinoCs2({ time: null, fase: null }, cs)).toBeNull();
    expect(destinoCs2({ time: 'CT', fase: 'live' }, undefined)).toBeNull();
  });

  it('hides the other team sub-room and keeps mine before the server lists it', () => {
    expect(ct.nome).toBe('CS · CT');
    expect(salasVisiveis([cs, tr], ct).map((s) => s.id)).toEqual(['cs', 'cs:cs:ct']);
    expect(salasVisiveis([cs, ct, tr], undefined).map((s) => s.id)).toEqual(['cs', 'cs:cs:ct', 'cs:cs:tr']);
  });
});

describe('janela quem fala', () => {
  const m = { x: -1920, y: 0, largura: 1920, altura: 1080, escala: 1.5 };
  it('puts the 320 × 96 window in a corner of the monitor, in physical pixels', () => {
    expect(posicaoFalantes('sup-esq', m)).toEqual({ x: -1884, y: 36 });
    expect(posicaoFalantes('meio-dir', m)).toEqual({ x: -516, y: 468 });
    expect(posicaoFalantes('inf-dir', m)).toEqual({ x: -516, y: 900 });
    expect(posicaoFalantes('livre', m)).toBeNull();
  });
});

describe('clipes', () => {
  it('keeps the clips the core saved, newest first, and "tirar da lista" hides one', async () => {
    localStorage.clear();
    guardarClipe({ caminho: 'C:\\V\\a.mp4', duracao: 30, tamanho: 1, em: 1 });
    guardarClipe({ caminho: 'C:\\V\\b.mp4', duracao: 60, tamanho: 2, em: 2 });
    expect(lerClipes().map(titulo)).toEqual(['b', 'a']);
    tirarClipe('C:\\V\\b.mp4');
    expect(lerClipes().map(titulo)).toEqual(['a']);
    localStorage.clear();
  });

  it('the fake replay saves only while on (demo and tests)', async () => {
    const eventos: string[] = [];
    const parar = replay.aoEvento((e) => eventos.push(e.event));
    await expect(replay.salvar()).rejects.toThrow('desligado');
    await replay.definir({ segundos: 60, sempre: false });
    expect(await replay.atual()).toBe(true);
    await replay.salvar();
    await replay.definir(null);
    parar();
    expect(eventos).toEqual(['state', 'saved', 'state']);
  });
});
