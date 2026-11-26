import { afterEach, describe, expect, it, vi } from 'vitest';
import { podeTransmitirNoNavegador } from './ambiente';

const comToque = (toque: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: toque && q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }));

describe('transmitir pelo navegador', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('celular e tablet só assistem, mesmo com getDisplayMedia (iOS recente)', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia() {} } });
    comToque(true);
    expect(podeTransmitirNoNavegador()).toBe(false);
    comToque(false);
    expect(podeTransmitirNoNavegador()).toBe(true);
  });
});
