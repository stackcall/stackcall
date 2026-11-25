import { aoMudarVoz, aplicarForte, capturaDe, lerVoz, salvarVoz, VOZ_PADRAO } from './voz';

beforeEach(() => localStorage.clear());

test('defaults keep the browser processing on and the Windows devices', () => {
  expect(lerVoz()).toEqual(VOZ_PADRAO);
  expect(capturaDe(lerVoz())).toMatchObject({ deviceId: undefined, echoCancellation: true, autoGainControl: true, noiseSuppression: true, sampleRate: 48000 });
});

test('a change is saved and reaches the room listener with the previous value', () => {
  const ouvinte = vi.fn();
  const parar = aoMudarVoz(ouvinte);
  salvarVoz({ entrada: 'mic-usb', eco: false });
  expect(lerVoz()).toMatchObject({ entrada: 'mic-usb', eco: false, ganho: true });
  expect(ouvinte).toHaveBeenCalledWith(expect.objectContaining({ entrada: 'mic-usb' }), expect.objectContaining({ entrada: '' }));
  // An unplugged device must fall back to the default, never fail the microphone.
  expect(capturaDe(lerVoz()).deviceId).toEqual({ ideal: 'mic-usb' });
  parar();
});

test('garbage in storage falls back to the defaults', () => {
  localStorage.setItem('stackcall.voz', '{nope');
  expect(lerVoz()).toEqual(VOZ_PADRAO);
});

test('strong suppression turns the browser one off, and only then', () => {
  expect(capturaDe({ ...VOZ_PADRAO, forte: true }).noiseSuppression).toBe(false);
  expect(capturaDe({ ...VOZ_PADRAO, forte: false }).noiseSuppression).toBe(true);
  expect(lerVoz().forte).toBe(false);
});

describe('aplicarForte', () => {
  const mic = () => ({ setProcessor: vi.fn().mockResolvedValue(undefined), stopProcessor: vi.fn().mockResolvedValue(undefined) });
  const processador = { name: 'teste', init: async () => undefined, restart: async () => undefined, destroy: async () => undefined };
  const carregar = vi.fn(async () => ({ processadorForte: () => processador }));

  test('on loads the processor lazily and puts it on the mic; off removes it', async () => {
    const m = mic();
    expect(await aplicarForte(m, true, carregar)).toBe('ligado');
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(m.setProcessor).toHaveBeenCalledWith(processador);
    expect(await aplicarForte(m, false, carregar)).toBe('desligado');
    expect(m.stopProcessor).toHaveBeenCalledTimes(1);
    expect(carregar).toHaveBeenCalledTimes(1); // turning off never downloads anything
  });

  test('a failing processor falls back to the plain microphone', async () => {
    const m = mic();
    m.setProcessor.mockRejectedValue(new Error('WebAssembly.instantiate: CSP'));
    expect(await aplicarForte(m, true, carregar)).toBe('falhou');
    expect(m.stopProcessor).toHaveBeenCalled();
  });

  test('a failing download falls back too', async () => {
    const m = mic();
    expect(await aplicarForte(m, true, () => Promise.reject(new Error('offline')))).toBe('falhou');
    expect(m.setProcessor).not.toHaveBeenCalled();
    expect(m.stopProcessor).toHaveBeenCalled();
  });
});
