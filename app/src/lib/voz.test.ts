import { aoMudarVoz, capturaDe, lerVoz, salvarVoz, VOZ_PADRAO } from './voz';

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
