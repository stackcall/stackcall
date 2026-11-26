import { invoke } from '@tauri-apps/api/core';
import { store } from './config';

export type CaptureSource = {
  id: string;
  title: string;
  process_name: string | null;
  pid: number | null;
  width: number | null;
  height: number | null;
  minimized: boolean;
  thumbnail: string | null;
  /** Set by cores that know the main monitor. */
  primary?: boolean;
};

export type Trial = {
  encoder: string;
  resolution: string;
  target_fps: number;
  ok: boolean;
  fps?: number;
  encoder_load_percent?: number;
};

/** `driver_version` comes with the v0.4 core; older cores send only the name. */
export type Adapter = { name: string; dedicated_bytes?: number; driver_version?: string; driver?: string };
export type MachineReport = { trials: Trial[]; adapters?: Adapter[]; cbr?: boolean };

export type StreamEvent = {
  id: string;
  event: 'started' | 'stats' | 'stopped' | 'error' | 'pause_changed' | 'minimized';
  reason?: string;
  paused?: boolean;
  /** `minimized`: the chosen game window is minimized (no frames until it comes back). */
  value?: boolean;
};

export const listSources = () => invoke<CaptureSource[]>('listar_fontes');
export const testMachine = (force = false) => invoke<MachineReport>('testar_maquina', { force });
export const stopTransmission = (id: string) => invoke('parar_transmissao', { id });
export const setTransmissionPaused = (id: string, paused: boolean) => invoke('mudar_pausa_transmissao', { id, paused });

export type Gpu = { name: string; driver: string | null };
export type SavedProbe = { gpu: Gpu | null; trials: Trial[]; at: number; cbr?: boolean };

/** The adapter that encodes: the real one with the most dedicated memory. */
export function gpuOf(report: MachineReport): Gpu | null {
  const main = (report.adapters ?? [])
    .filter((a) => !/basic render/i.test(a.name))
    .sort((a, b) => (b.dedicated_bytes ?? 0) - (a.dedicated_bytes ?? 0))[0];
  return main ? { name: main.name, driver: main.driver_version ?? main.driver ?? null } : null;
}

const sameGpu = (a: Gpu | null, b: Gpu | null) => a?.name === b?.name && a?.driver === b?.driver;

export function savedProbe(): SavedProbe | null {
  try {
    const saved = JSON.parse(store.get('placa') ?? 'null') as SavedProbe | null;
    return saved && Array.isArray(saved.trials) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * GPU test with memory. Without `force` the core answers from its own cache, which only
 * probes again when the cache or driver changes; same GPU, driver and rate control keep the result, so the
 * presets do not change between openings of the screen.
 */
export async function probeMachine(force = false): Promise<SavedProbe> {
  const saved = force ? null : savedProbe();
  const report = await testMachine(force);
  const gpu = gpuOf(report);
  if (saved && sameGpu(saved.gpu, gpu) && saved.cbr === report.cbr) return saved;
  const next = { gpu, trials: report.trials, at: Date.now(), cbr: report.cbr };
  store.set('placa', JSON.stringify(next));
  return next;
}
