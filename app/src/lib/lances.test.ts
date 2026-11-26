import { describe, expect, it } from 'vitest';
import { criarDetectorLances, nomeDoLance, tipoDoClipe, type Lance } from './lances';

describe('lances do CS2', () => {
  it('um clipe por round, no fim do round, com o tipo certo', () => {
    const lances: Lance[] = [];
    const d = criarDetectorLances((l) => lances.push(l));
    d({ time: 'CT', fase: 'freezetime', mapa: 'de_mirage', round: 4, kills: 0 });
    d({ time: 'CT', fase: 'live', mapa: 'de_mirage', round: 4, kills: 1 });
    d({ time: 'CT', fase: 'live', mapa: 'de_mirage', round: 4, kills: 3 });
    // Dead and spectating: kills unknown, the 3 stay.
    d({ time: null, fase: 'live', mapa: 'de_mirage', round: 4, kills: null });
    expect(lances).toHaveLength(0);
    d({ time: 'CT', fase: 'over', mapa: 'de_mirage', round: 4, kills: 3 });
    d({ time: 'CT', fase: 'over', mapa: 'de_mirage', round: 5, kills: 3 });
    expect(lances).toEqual([{ tipo: '3K', mapa: 'de_mirage', round: 4 }]);
    // Next round: 2 kills is not a play; a new round with 4 at the change of round counts.
    d({ time: 'CT', fase: 'live', mapa: 'de_mirage', round: 5, kills: 2 });
    d({ time: 'CT', fase: 'live', mapa: 'de_mirage', round: 6, kills: 0 });
    expect(lances).toHaveLength(1);
    d({ time: 'CT', fase: 'live', mapa: 'de_mirage', round: 6, kills: 4 });
    d({ time: 'CT', fase: 'freezetime', mapa: 'de_mirage', round: 7, kills: 0 });
    expect(lances.at(-1)).toEqual({ tipo: '4K', mapa: 'de_mirage', round: 6 });
  });

  it('o ace sai na hora, uma vez só', () => {
    const lances: Lance[] = [];
    const d = criarDetectorLances((l) => lances.push(l));
    d({ time: 'TR', fase: 'freezetime', mapa: 'de_inferno', round: 0, kills: 0 });
    d({ time: 'TR', fase: 'live', mapa: 'de_inferno', round: 0, kills: 5 });
    d({ time: 'TR', fase: 'over', mapa: 'de_inferno', round: 0, kills: 5 });
    expect(lances).toEqual([{ tipo: 'ACE', mapa: 'de_inferno', round: 0 }]);
  });

  it('dá um nome legível e reconhece o tipo pelo nome', () => {
    const nome = nomeDoLance({ tipo: 'ACE', mapa: 'de_mirage', round: 7 }, new Date(2026, 10, 26, 21, 5));
    expect(nome).toBe('ACE mirage R8 26-11 21h05.mp4');
    expect(tipoDoClipe(nome)).toBe('ACE');
    expect(tipoDoClipe('Stackcall 2026-11-25 08-41.mp4')).toBeNull();
  });
});
