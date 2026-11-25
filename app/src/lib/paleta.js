export const TITULO_GRUPO = { acoes: 'Ações', salas: 'Salas e pessoas', config: 'Configurações' };
const ORDEM = ['acoes', 'salas', 'config'];
const sem = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Filtered items in group order. Matches every word of the query in the label, detail, place or aliases. */
export function filtrarPaleta(itens, consulta) {
    let q = consulta.trimStart();
    let filtro = null;
    if (q.startsWith('>')) {
        filtro = (i) => i.grupo === 'acoes';
        q = q.slice(1);
    }
    else if (q.startsWith('@')) {
        filtro = (i) => !!i.pessoa;
        q = q.slice(1);
    }
    const palavras = sem(q).split(/\s+/).filter(Boolean);
    const achou = (i) => {
        const texto = sem([i.rotulo, i.detalhe, i.onde, ...(i.apelidos ?? [])].filter(Boolean).join(' '));
        return palavras.every((p) => texto.includes(p));
    };
    const lista = itens.filter((i) => (!filtro || filtro(i)) && achou(i));
    return ORDEM.flatMap((g) => lista.filter((i) => i.grupo === g));
}
/** Next highlighted index with the arrows, wrapping around. */
export const moverFoco = (atual, total, passo) => (total === 0 ? 0 : (atual + passo + total) % total);
/**
 * The room registers its live actions (bad internet mode, poke someone, watch…) so the palette,
 * which lives above every screen, can list them. One room at a time.
 */
let fonteSala = null;
export function registrarItensSala(f) {
    fonteSala = f;
    return () => {
        if (fonteSala === f)
            fonteSala = null;
    };
}
export const itensSala = () => fonteSala?.() ?? [];
/** The top bar search box and the film button open the palette and the clips from any screen. */
const ouvintesAbrir = new Set();
export function aoAbrir(f) {
    ouvintesAbrir.add(f);
    return () => void ouvintesAbrir.delete(f);
}
export const abrir = (o) => ouvintesAbrir.forEach((f) => f(o));
