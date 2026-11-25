import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { probeMachine, savedProbe, type MachineReport } from './sidecar';
import { uploadMedido } from './servidor';

const trial = (fps: number) => ({ encoder: 'av1_nvenc', resolution: '1080p', target_fps: 60, ok: true, fps, encoder_load_percent: 50 });
const rtx = (driver: string, fps: number): MachineReport => ({
  adapters: [
    { name: 'Microsoft Basic Render Driver', dedicated_bytes: 0 },
    { name: 'NVIDIA GeForce RTX 5060', dedicated_bytes: 8e9, driver_version: driver },
  ],
  trials: [trial(fps)],
});

beforeEach(() => localStorage.clear());
afterEach(() => clearMocks());

function core(report: () => MachineReport) {
  const calls: unknown[] = [];
  mockIPC((command, args) => {
    if (command !== 'testar_maquina') throw new Error(command);
    calls.push((args as { force: boolean }).force);
    return report();
  });
  return calls;
}

test('same GPU and driver keep the saved probe; a new driver takes the new result', async () => {
  let report = rtx('32.0.15.6094', 60);
  const calls = core(() => report);
  const first = await probeMachine();
  expect(first.gpu).toEqual({ name: 'NVIDIA GeForce RTX 5060', driver: '32.0.15.6094' });

  // The core answers again (from its cache) with a noisier number: the saved one stays.
  report = rtx('32.0.15.6094', 52);
  expect((await probeMachine()).trials[0].fps).toBe(60);
  expect(calls).toEqual([false, false]);

  report = rtx('32.0.15.7000', 58);
  const updated = await probeMachine();
  expect(updated.trials[0].fps).toBe(58);
  expect(savedProbe()?.gpu?.driver).toBe('32.0.15.7000');
});

test('redo forces the core probe and replaces the saved result', async () => {
  let report = rtx('1', 60);
  const calls = core(() => report);
  await probeMachine();
  report = rtx('1', 45);
  expect((await probeMachine(true)).trials[0].fps).toBe(45);
  expect(calls).toEqual([false, true]);
});

test('old core without adapters still keeps the saved probe', async () => {
  core(() => ({ trials: [trial(60)] }));
  await probeMachine();
  core(() => ({ trials: [trial(40)] }));
  expect((await probeMachine()).trials[0].fps).toBe(60);
});

test('upload is reused for 24 h on the same server and measured once at a time', async () => {
  const fetch = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  onTestFinished(() => { vi.unstubAllGlobals(); });
  localStorage.setItem('stackcall.upload', JSON.stringify({ mbps: 26.4, at: Date.now() - 60_000, servidor: 'https://a.test' }));
  expect(await uploadMedido('https://a.test')).toBe(26.4);
  expect(fetch).not.toHaveBeenCalled();

  localStorage.setItem('stackcall.upload', JSON.stringify({ mbps: 26.4, at: Date.now() - 25 * 3600_000, servidor: 'https://a.test' }));
  const [a, b] = [uploadMedido('https://a.test'), uploadMedido('https://a.test')];
  expect(a).toBe(b);
  expect(await a).toBeGreaterThan(0);
  expect(uploadMedido('https://a.test')).not.toBe(a);
}, 15000);
