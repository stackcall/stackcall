import { useEffect, useRef, useState } from 'react';
import type { RoomModel } from './model';

/** Waits between automatic reconnect attempts; after the last one the person decides. */
export const RECUO_MS = [2000, 5000, 10000];

/**
 * Reconnects by itself after a dropped room: 2 s, 5 s, 10 s, only while the PC has network
 * (going back online counts as the next attempt). `reconectar()` is the manual button and
 * restarts the sequence.
 */
export function useReconexao(state: RoomModel['state'], autoRetry: boolean, tentar: () => void) {
  const [falhas, setFalhas] = useState(0);
  const tentarRef = useRef(tentar);
  tentarRef.current = tentar;

  useEffect(() => {
    if (state === 'connected') setFalhas(0);
  }, [state]);

  useEffect(() => {
    if (state !== 'error' || !autoRetry || falhas >= RECUO_MS.length) return;
    const ir = () => {
      setFalhas((n) => n + 1);
      tentarRef.current();
    };
    if (!navigator.onLine) {
      window.addEventListener('online', ir, { once: true });
      return () => window.removeEventListener('online', ir);
    }
    const t = setTimeout(ir, RECUO_MS[falhas]);
    return () => clearTimeout(t);
  }, [state, autoRetry, falhas]);

  return {
    /** Automatic attempts already made (0..3). */
    falhas,
    /** No more automatic attempts: show the "Reconectar" button as the way out. */
    esgotou: !autoRetry || falhas >= RECUO_MS.length,
    reconectar: () => {
      setFalhas(0);
      tentarRef.current();
    },
  };
}
