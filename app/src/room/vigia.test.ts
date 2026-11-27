import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodifica, LEVE_MS, ORIGINAL_MS, vigiar } from './vigia';

describe('vigiar', () => {
  it('waits, then moves Original to Leve and gives up on Leve', () => {
    expect(vigiar(0, true, 60_000, false)).toBe('ok');
    expect(vigiar(null, false, 60_000, false)).toBe('esperar');
    expect(vigiar(0, false, ORIGINAL_MS - 1, false)).toBe('esperar');
    expect(vigiar(0, false, ORIGINAL_MS, false)).toBe('leve');
    expect(vigiar(0, false, ORIGINAL_MS, true)).toBe('esperar');
    expect(vigiar(0, false, LEVE_MS, true)).toBe('falhou');
  });
});

describe('decodifica', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trusts the browser list and assumes yes when it cannot tell', () => {
    expect(decodifica('video/AV1')).toBe(true);
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [{ mimeType: 'video/H264' }] }) });
    expect(decodifica('video/AV1')).toBe(false);
    expect(decodifica('video/h264')).toBe(true);
    expect(decodifica(undefined)).toBe(true);
  });
});
