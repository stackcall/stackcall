import type { Cutucada } from './cutucar';
import type { Pessoa, Sala } from './servidor';

/**
 * Sending side of "Cutucar" (the receiving side, voice and Windows notice, is lib/cutucar.ts).
 * The porteiro enforces the limits; this mirrors them so the menu can say "em 12 s".
 */
export const LIMITE_RECADO = 80;
export const INTERVALO_MS = 30_000;
export const SUGESTOES = ['a sala tá pronta', 'bora jogar', 'volta pra call'];

const ultimas = new Map<string, number>();
/** Seconds until I can poke `id` again (0 = now). Client side mirror of the server's 30 s limit. */
export const esperaCutucar = (id: string, agora = Date.now()) =>
  Math.max(0, Math.ceil((INTERVALO_MS - (agora - (ultimas.get(id) ?? -Infinity))) / 1000));
export const marcarCutucada = (id: string, agora = Date.now()) => void ultimas.set(id, agora);
let ultimoCutucado: string | null = null;
export const lembrarUltimo = (id: string) => void (ultimoCutucado = id);
export const ultimoAlvo = () => ultimoCutucado;

/**
 * Pokes waiting on my own profile (`GET /api/pessoas`), as lib/cutucar.ts expects them. The
 * porteiro only sends `de` (an id): the name and the room come from that person's presence.
 * Who may poke me is checked on the server ("Receber cutucadas de").
 */
export function cutucadasPendentes(pessoas: Pessoa[], euId: string, salas: Sala[]): Cutucada[] {
  const minhas = pessoas.find((p) => p.id === euId)?.cutucadas ?? [];
  return minhas.map((c) => {
    const de = pessoas.find((p) => p.id === c.de);
    const sala = salas.find((s) => s.id === de?.sala);
    return { id: c.id, de: de?.nome ?? 'Alguém', deId: c.de, recado: c.recado, salaId: sala?.id ?? null, salaNome: sala?.nome ?? null };
  });
}

/** The room tells whether the Stackcall sound is off (deafened), for "tocar mesmo com o som silenciado". */
let silenciado = false;
export const marcarSilenciado = (v: boolean) => void (silenciado = v);
export const somSilenciado = () => silenciado;
