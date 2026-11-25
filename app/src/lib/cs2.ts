import type { EventoGsi } from './nucleo';
import type { Sala } from './servidor';

/**
 * "Sala do mapa do CS2" (docs/api-v05.md, "Sub-salas do CS2"). The GSI of this PC says the team;
 * the app moves to the CT or TR sub-room of the room it is in, and back to it when the match ends.
 */
export type Destino = { ir: 'time'; pai: string; time: 'ct' | 'tr' } | { ir: 'pai'; pai: string } | null;

/** In a match: a known team, and the map phase is not over. */
export function destinoCs2(e: EventoGsi, atual: Sala | undefined): Destino {
  if (!atual) return null;
  const pai = atual.paiId ?? atual.id;
  if (e.time && e.fase !== 'gameover') {
    const time = e.time === 'CT' ? 'ct' : 'tr';
    return atual.paiId && atual.time === time ? null : { ir: 'time', pai, time };
  }
  return atual.paiId ? { ir: 'pai', pai } : null;
}

/** The sub-room as a list item, until GET /api/salas lists it (it only lists occupied ones). */
export const subSala = (id: string, pai: Sala, time: 'ct' | 'tr'): Sala =>
  ({ id, nome: `${pai.nome} · ${time.toUpperCase()}`, ordem: pai.ordem, pessoas: 0, noAr: false, paiId: pai.id, time });

/**
 * Rooms to show: the current sub-room even before the server lists it, and never the other team's
 * sub-room while I am in a match (its screens stay hidden until the end, as in the design).
 */
export function salasVisiveis(salas: Sala[], atual: Sala | undefined): Sala[] {
  const lista = atual && !salas.some((s) => s.id === atual.id) ? [...salas, atual] : salas;
  if (!atual?.paiId) return lista;
  return lista.filter((s) => !(s.paiId === atual.paiId && s.time !== atual.time));
}
