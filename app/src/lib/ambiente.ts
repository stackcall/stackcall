import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';

/**
 * Where the interface runs:
 * - "app": the Windows app (Tauri). Everything is available.
 * - "web": the same interface in a browser or phone, served by the porteiro at /app/. The
 *   session is an HttpOnly cookie and the Windows-only parts (core, clips, hotkeys) are hidden.
 * - "demo": dev server with fake data (`?demo=1`).
 */
export type Ambiente = 'app' | 'web' | 'demo';

// Same rule as modoFalso (lib/falso.ts), repeated here so the transport does not import the fake server.
// Unit tests run like the demo (fake answers, no network).
const demo = () => import.meta.env.MODE === 'test' ||
  (import.meta.env.DEV && (import.meta.env.VITE_SERVIDOR_FALSO === '1' || new URLSearchParams(location.search).has('demo')));

export const ambiente = (): Ambiente => (isTauri() ? 'app' : demo() ? 'demo' : 'web');
export const naWeb = () => ambiente() === 'web';
/** The core (stream, clips, game detection, overlay) exists only in the Windows app. */
export const temNucleo = () => ambiente() !== 'web';
/** Screen capture in a browser: desktop browsers have it; phones do not. */
export const podeTransmitirNoNavegador = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
/** Phone or tablet: decides the light screen by default and the compact layout. */
export const ehCelular = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;


const ESTREITA = '(max-width: 767px)';
/** Phone-width layout (one column, controls at the bottom). Follows rotation and resizing. */
export function useCompacto() {
  const [compacto, setCompacto] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(ESTREITA).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(ESTREITA);
    const mudar = () => setCompacto(mq.matches);
    mq.addEventListener('change', mudar);
    return () => mq.removeEventListener('change', mudar);
  }, []);
  return compacto;
}
