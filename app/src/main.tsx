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
import { aplicarTema } from './lib/tema';
import { iniciarLeveza } from './lib/leveza';
import { App } from './App';

aplicarTema();
iniciarLeveza();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
