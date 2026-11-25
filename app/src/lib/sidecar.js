import { invoke } from '@tauri-apps/api/core';
import { store } from './config';
export const listSources = () => invoke('listar_fontes');
export const testMachine = (force = false) => invoke('testar_maquina', { force });
export const stopTransmission = (id) => invoke('parar_transmissao', { id });
export const setTransmissionPaused = (id, paused) => invoke('mudar_pausa_transmissao', { id, paused });
/** The adapter that encodes: the real one with the most dedicated memory. */
export function gpuOf(report) {
    const main = (report.adapters ?? [])
        .filter((a) => !/basic render/i.test(a.name))
        .sort((a, b) => (b.dedicated_bytes ?? 0) - (a.dedicated_bytes ?? 0))[0];
    return main ? { name: main.name, driver: main.driver_version ?? main.driver ?? null } : null;
}
const sameGpu = (a, b) => a?.name === b?.name && a?.driver === b?.driver;
export function savedProbe() {
    try {
        const saved = JSON.parse(store.get('placa') ?? 'null');
        return saved && Array.isArray(saved.trials) ? saved : null;
    }
    catch {
        return null;
    }
}
/**
 * GPU test with memory. Without `force` the core answers from its own cache, which only
 * probes again when the cache or driver changes; same GPU, driver and rate control keep the result, so the
 * presets do not change between openings of the screen.
 */
export async function probeMachine(force = false) {
    const saved = force ? null : savedProbe();
    const report = await testMachine(force);
    const gpu = gpuOf(report);
    if (saved && sameGpu(saved.gpu, gpu) && saved.cbr === report.cbr)
        return saved;
    const next = { gpu, trials: report.trials, at: Date.now(), cbr: report.cbr };
    store.set('placa', JSON.stringify(next));
    return next;
}
