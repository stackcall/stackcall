import { useEffect, useState } from 'react';
import { QuemFalaLista } from '../components/QuemFalaLista';
import { LARGURA_FALANTES } from '../lib/nucleo';
import { usePreferencias } from '../lib/preferencias';
import { ESTADO_EXEMPLO, ouvirQuemFala, type EstadoQuemFala } from '../lib/quemfala';

/**
 * Page of the "falantes" window (index.html?falantes=1, docs/api-v05-app.md). The core creates it:
 * borderless, transparent, always on top, clicks pass through, sized for the rows. This page only draws the list.
 * Out of voice it draws nothing. `demo` shows a sample room over a dark backdrop.
 */
export function JanelaQuemFala({ demo = false }: { demo?: boolean }) {
  const [prefs] = usePreferencias();
  const [estado, setEstado] = useState<EstadoQuemFala | null>(demo ? ESTADO_EXEMPLO : null);
  useEffect(() => {
    document.documentElement.dataset.janela = 'quemfala';
    return demo ? undefined : ouvirQuemFala(setEstado);
  }, [demo]);
  return (
    <main className={`h-full ${demo ? 'bg-palco p-5' : ''}`}>
      <QuemFalaLista estado={estado} prefs={prefs} largura={LARGURA_FALANTES[prefs.quemFalaTamanho]} />
    </main>
  );
}
