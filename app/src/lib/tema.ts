import { useState } from 'react';

/**
 * Interface theme, per PC. Light is the default and does not follow the system
 * (skill padrao-pessoal: difference from Fivestack). The script in index.html applies it
 * before the first paint; keep the key in sync.
 */
export type Tema = 'claro' | 'escuro';
const CHAVE = 'stackcall.tema';

export function lerTema(): Tema {
  try {
    return localStorage.getItem(CHAVE) === 'escuro' ? 'escuro' : 'claro';
  } catch {
    return 'claro';
  }
}

export function aplicarTema(tema = lerTema()) {
  document.documentElement.dataset.tema = tema;
}

export function useTema() {
  const [tema, setTema] = useState(lerTema);
  const escolher = (novo: Tema) => {
    setTema(novo);
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {
      // Storage blocked: the choice lasts until the app closes.
    }
    aplicarTema(novo);
  };
  return [tema, escolher] as const;
}
