import { useEffect, useState } from 'react';
export const PREFERENCIAS_PADRAO = {
    presencaJogo: true,
    replayLigado: false,
    replaySegundos: 60,
    replayQualidade: 'transmissao',
    replayPasta: '',
    cutucarVoz: true,
    cutucarVolume: 70,
    cutucarMesmoSilenciado: true,
    cutucarAvisoWindows: true,
    somEntradaSaida: true,
    somEntradaSaidaVolume: 60,
    quemFalaMostrar: false,
    quemFalaConteudo: 'todos',
    quemFalaOpacidade: 80,
    quemFalaTamanho: 'm',
    quemFalaPosicao: 'meio-esq',
    cs2SalaMapa: false,
    redeRuim: false,
};
export const CHAVE_PREFERENCIAS = 'stackcall.preferencias';
const bool = (v, p) => (typeof v === 'boolean' ? v : p);
const um = (...validos) => (v, p) => (validos.includes(v) ? v : p);
const faixa = (min, max) => (v, p) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : p;
const texto = (max) => (v, p) => (typeof v === 'string' && v.length <= max ? v : p);
const REGRAS = {
    presencaJogo: bool,
    replayLigado: bool,
    replaySegundos: um(30, 60, 120),
    replayQualidade: um('transmissao', '720p'),
    replayPasta: texto(260),
    cutucarVoz: bool,
    cutucarVolume: faixa(0, 100),
    cutucarMesmoSilenciado: bool,
    cutucarAvisoWindows: bool,
    somEntradaSaida: bool,
    somEntradaSaidaVolume: faixa(0, 100),
    quemFalaMostrar: bool,
    quemFalaConteudo: um('todos', 'falando'),
    quemFalaOpacidade: faixa(20, 100),
    quemFalaTamanho: um('p', 'm', 'g'),
    quemFalaPosicao: um('sup-esq', 'sup-dir', 'meio-esq', 'meio-dir', 'inf-esq', 'inf-dir', 'livre'),
    cs2SalaMapa: bool,
    redeRuim: bool,
};
/** Any stored value, cleaned key by key: an invalid field falls back to its default, not the whole object. */
export function validarPreferencias(bruto) {
    const o = bruto && typeof bruto === 'object' ? bruto : {};
    const p = { ...PREFERENCIAS_PADRAO };
    for (const k of Object.keys(REGRAS))
        p[k] = REGRAS[k](o[k], PREFERENCIAS_PADRAO[k]);
    return p;
}
export function lerPreferencias() {
    try {
        return validarPreferencias(JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) ?? '{}'));
    }
    catch {
        return { ...PREFERENCIAS_PADRAO };
    }
}
const ouvintes = new Set();
export function salvarPreferencias(mudanca) {
    const p = validarPreferencias({ ...lerPreferencias(), ...mudanca });
    try {
        localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify(p));
    }
    catch {
        // Storage blocked: the change lasts until the app closes.
    }
    ouvintes.forEach((f) => f(p));
    return p;
}
/** Changes from this window and from the other windows of the app (same origin). */
export function aoMudarPreferencias(f) {
    ouvintes.add(f);
    const outraJanela = (e) => e.key === CHAVE_PREFERENCIAS && f(lerPreferencias());
    window.addEventListener('storage', outraJanela);
    return () => {
        ouvintes.delete(f);
        window.removeEventListener('storage', outraJanela);
    };
}
export function usePreferencias() {
    const [p, setP] = useState(lerPreferencias);
    useEffect(() => aoMudarPreferencias(setP), []);
    return [p, (m) => setP(salvarPreferencias(m))];
}
