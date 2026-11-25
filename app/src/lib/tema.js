import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
const CHAVE = 'stackcall.tema';
export function lerTema() {
    try {
        return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro';
    }
    catch {
        return 'claro';
    }
}
export function aplicarTema(tema = lerTema()) {
    document.documentElement.dataset.tema = tema;
    if (isTauri())
        void getCurrentWindow().setTheme(tema === 'escuro' ? 'dark' : 'light').catch(() => undefined);
}
/**
 * Shows the window once the theme is on <html> (it starts hidden). No requestAnimationFrame: a
 * hidden WebView may never fire it. If this never runs, the tray icon still opens the window.
 */
export function mostrarJanela() {
    if (isTauri())
        void getCurrentWindow().show().catch(() => undefined);
}
export function useTema() {
    const [tema, setTema] = useState(lerTema);
    const escolher = (novo) => {
        setTema(novo);
        try {
            localStorage.setItem(CHAVE, novo);
        }
        catch {
            // Storage blocked: the choice lasts until the app closes.
        }
        aplicarTema(novo);
    };
    return [tema, escolher];
}
