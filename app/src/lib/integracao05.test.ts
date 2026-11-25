import { describe, expect, it } from 'vitest';
import { destinoCs2, salasVisiveis, subSala } from './cs2';
import { apagarClipe, listarClipes, titulo } from './clipes';
import { pedidoFalantes, replay } from './nucleo';
import { PREFERENCIAS_PADRAO } from './preferencias';
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
  const estado = { sala: 'CS', ping: 40, replay: false, pessoas: Array.from({ length: 10 }, (_, n) => ({ id: `p${n}`, nome: `P${n}`, cor: null, falando: n < 2, mudo: false })) };
  it('sends size, visible rows (at most 8) and corner; closed when hidden', () => {
    expect(pedidoFalantes({ ...PREFERENCIAS_PADRAO, quemFalaMostrar: true, quemFalaTamanho: 'g', quemFalaPosicao: 'inf-dir' }, estado))
      .toEqual({ tamanho: 'g', linhas: 8, posicao: 'inf-dir' });
    expect(pedidoFalantes({ ...PREFERENCIAS_PADRAO, quemFalaMostrar: true, quemFalaConteudo: 'falando' }, estado)?.linhas).toBe(2);
    expect(pedidoFalantes({ ...PREFERENCIAS_PADRAO, quemFalaMostrar: true }, null)?.linhas).toBe(0);
    expect(pedidoFalantes({ ...PREFERENCIAS_PADRAO, quemFalaMostrar: false }, estado)).toBeNull();
  });
});

describe('clipes', () => {
  it('lists the fake folder newest first and deletes one (demo)', async () => {
    const antes = await listarClipes();
    expect(antes.map(titulo)[0]).toBe('Clutch 1v3 no B');
    await apagarClipe(antes[0]);
    expect((await listarClipes()).map((c) => c.nome)).not.toContain(antes[0].nome);
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
