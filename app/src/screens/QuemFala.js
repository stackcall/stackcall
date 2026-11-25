import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { QuemFalaLista } from '../components/QuemFalaLista';
import { LARGURA_QUEM_FALA } from '../lib/nucleo';
import { usePreferencias } from '../lib/preferencias';
import { ESTADO_EXEMPLO, ouvirQuemFala } from '../lib/quemfala';
/**
 * Page of the second Tauri window (index.html?janela=quemfala). The core creates the window:
 * borderless, transparent, always on top, clicks pass through. This page only draws the list.
 * Out of voice it draws nothing. `demo` shows a sample room over a dark backdrop.
 */
export function JanelaQuemFala({ demo = false }) {
    const [prefs] = usePreferencias();
    const [estado, setEstado] = useState(demo ? ESTADO_EXEMPLO : null);
    useEffect(() => {
        document.documentElement.dataset.janela = 'quemfala';
        return demo ? undefined : ouvirQuemFala(setEstado);
    }, [demo]);
    return (_jsx("main", { className: `h-full ${demo ? 'bg-palco p-5' : ''}`, children: _jsx(QuemFalaLista, { estado: estado, prefs: prefs, largura: LARGURA_QUEM_FALA[prefs.quemFalaTamanho] }) }));
}
