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
import { sincronizarJanelaQuemFala } from './lib/nucleo';
import { aoMudarPreferencias, lerPreferencias } from './lib/preferencias';

aplicarTema();
// Dev only: ?tema=escuro for review screenshots without touching the saved choice.
const temaDev = import.meta.env.DEV ? new URLSearchParams(location.search).get('tema') : null;
if (temaDev === 'claro' || temaDev === 'escuro') aplicarTema(temaDev);
// The core opens the "quem fala" window on index.html?janela=quemfala: only the list, no app.
const janelaQuemFala = new URLSearchParams(location.search).get('janela') === 'quemfala';
if (janelaQuemFala) {
  document.documentElement.dataset.janela = 'quemfala';
} else {
  iniciarLeveza();
  iniciarAtalhos();
  sincronizarJanelaQuemFala(lerPreferencias, aoMudarPreferencias);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {janelaQuemFala ? <JanelaQuemFala demo={import.meta.env.DEV && new URLSearchParams(location.search).has('demo')} /> : <App />}
  </StrictMode>,
);
mostrarJanela();
