import type { NomeIcone } from '../components/Icone';

/**
 * Command palette (Ctrl+K and the search box on the top bar). Fixed groups, in this order:
 * actions, rooms and people, settings. `>` keeps only actions; `@` only people.
 */
export type GrupoPaleta = 'acoes' | 'salas' | 'config';
export type ItemPaleta = {
  id: string;
  grupo: GrupoPaleta;
  rotulo: string;
  /** After the label, smaller: current state ("ligado") or a detail ("rede ruim, 210 ms"). */
  detalhe?: string;
  /** Right column: where it lives or what Enter does ("desligar", "Voz e rede"). */
  onde: string;
  icone: NomeIcone;
  /** Extra words that also find it ("ptt", "mute"). */
  apelidos?: string[];
  /** A person (for the `@` filter). */
  pessoa?: boolean;
  /** Shortcut the person defined, shown only when there is one. */
  teclas?: string;
  executar(): void;
  /** Tab: open this setting's page instead of changing it now. */
  configurar?(): void;
};

export const TITULO_GRUPO: Record<GrupoPaleta, string> = { acoes: 'Ações', salas: 'Salas e pessoas', config: 'Configurações' };
const ORDEM: GrupoPaleta[] = ['acoes', 'salas', 'config'];

const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtered items in group order. Matches every word of the query in the label, detail, place or aliases. */
export function filtrarPaleta(itens: ItemPaleta[], consulta: string): ItemPaleta[] {
  let q = consulta.trimStart();
  let filtro: ((i: ItemPaleta) => boolean) | null = null;
  if (q.startsWith('>')) {
    filtro = (i) => i.grupo === 'acoes';
    q = q.slice(1);
  } else if (q.startsWith('@')) {
    filtro = (i) => !!i.pessoa;
    q = q.slice(1);
  }
  const palavras = sem(q).split(/\s+/).filter(Boolean);
  const achou = (i: ItemPaleta) => {
    const texto = sem([i.rotulo, i.detalhe, i.onde, ...(i.apelidos ?? [])].filter(Boolean).join(' '));
    return palavras.every((p) => texto.includes(p));
  };
  const lista = itens.filter((i) => (!filtro || filtro(i)) && achou(i));
  return ORDEM.flatMap((g) => lista.filter((i) => i.grupo === g));
}

/** Next highlighted index with the arrows, wrapping around. */
export const moverFoco = (atual: number, total: number, passo: 1 | -1) => (total === 0 ? 0 : (atual + passo + total) % total);

/**
 * The room registers its live actions (bad internet mode, poke someone, watch…) so the palette,
 * which lives above every screen, can list them. One room at a time.
 */
let fonteSala: (() => ItemPaleta[]) | null = null;
export function registrarItensSala(f: () => ItemPaleta[]) {
  fonteSala = f;
  return () => {
    if (fonteSala === f) fonteSala = null;
  };
}
export const itensSala = () => fonteSala?.() ?? [];

/** The top bar search box and the film button open the palette and the clips from any screen. */
const ouvintesAbrir = new Set<(o: 'paleta' | 'clipes') => void>();
export function aoAbrir(f: (o: 'paleta' | 'clipes') => void) {
  ouvintesAbrir.add(f);
  return () => void ouvintesAbrir.delete(f);
}
export const abrir = (o: 'paleta' | 'clipes') => ouvintesAbrir.forEach((f) => f(o));
