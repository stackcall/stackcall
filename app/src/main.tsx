import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Only the weights the interface uses (docs/PLANO-ABERTO.md, leveza).
import '@fontsource/anton/400.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/permanent-marker/400.css';
import './index.css';
import { aplicarTema, mostrarJanela } from './lib/tema';
import { iniciarLeveza } from './lib/leveza';
import { iniciarAtalhos } from './lib/atalhos';
import { App } from './App';
import { JanelaQuemFala } from './screens/QuemFala';
import { sincronizarJanelaQuemFala, sincronizarReplay } from './lib/nucleo';
import { iniciarClipes } from './lib/clipes';
import { listSources } from './lib/sidecar';
import { isTauri } from '@tauri-apps/api/core';
import { aoMudarPreferencias, lerPreferencias } from './lib/preferencias';

aplicarTema();
// Dev only: ?tema=escuro for review screenshots without touching the saved choice.
const temaDev = import.meta.env.DEV ? new URLSearchParams(location.search).get('tema') : null;
if (temaDev === 'claro' || temaDev === 'escuro') aplicarTema(temaDev);
// The core opens the "falantes" window on index.html?falantes=1: only the list, no app.
const janelaQuemFala = new URLSearchParams(location.search).has('falantes');
if (janelaQuemFala) {
  document.documentElement.dataset.janela = 'quemfala';
} else {
  iniciarLeveza();
  iniciarAtalhos();
  sincronizarJanelaQuemFala(lerPreferencias, aoMudarPreferencias);
  iniciarClipes();
  // "Replay sempre ligado" records the primary monitor outside the air (the core needs a source).
  sincronizarReplay(lerPreferencias, aoMudarPreferencias, async () => {
    if (!isTauri()) return null;
    const fontes = await listSources();
    return (fontes.find((f) => !f.pid && f.primary) ?? fontes.find((f) => !f.pid))?.id ?? null;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {janelaQuemFala ? <JanelaQuemFala demo={import.meta.env.DEV && new URLSearchParams(location.search).has('demo')} /> : <App />}
  </StrictMode>,
);
mostrarJanela();
