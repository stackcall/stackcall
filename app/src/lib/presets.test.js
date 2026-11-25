import { evaluatePresets } from './presets';
const base = { codec: 'av1', uploadMbps: 100, sourceHeight: 1080, encoding: {} };
test('recommends the largest open preset up to 1080p60 and locks 1440p and 4K', () => {
    const cards = evaluatePresets(base);
    const open = cards.filter((c) => !c.locked).map((c) => c.id);
    expect(open).toEqual(['720p30', '1080p30', '1080p60']);
    expect(cards.find((c) => c.recommended)?.id).toBe('1080p60');
    expect(cards.find((c) => c.id === '4k60')?.reason).toMatch(/reserva/);
});
const nativeTrials = [
    { resolution: '720p', target_fps: 30 },
    { resolution: '1080p', target_fps: 30 },
    { resolution: '1080p', target_fps: 60 },
    { resolution: '1440p', target_fps: 60 },
].map((preset) => ({
    ...preset, encoder: 'av1_nvenc', ok: true, fps: preset.target_fps, encoder_load_percent: 70,
}));
test('unlocks AV1 through 1440p60 at 26.4 Mbps when the source and GPU support it', () => {
    const cards = evaluatePresets({ ...base, sourceHeight: 1440, uploadMbps: 26.4, trials: nativeTrials });
    expect(cards.filter((c) => !c.locked).map((c) => c.id)).toEqual(['720p30', '1080p30', '1080p60', '1440p60']);
    expect(cards.find((c) => c.recommended)?.id).toBe('1080p60');
});
test('shows higher native presets locked by the height of a 1080p source', () => {
    const cards = evaluatePresets({ ...base, sourceWidth: 1920, uploadMbps: 26.4, trials: nativeTrials });
    const higher = cards.filter((c) => c.height > 1080);
    expect(higher.map((c) => c.id)).toEqual(['1440p60', '4k30', '4k60']);
    for (const card of higher) {
        expect(card.locked).toBe(true);
        expect(card.reason).toMatch(/A fonte escolhida tem 1080 linhas/);
    }
});
test('only unlocks 720p30 at 5 Mbps and reports the chosen codec requirement', () => {
    const cards = evaluatePresets({ ...base, uploadMbps: 5, trials: nativeTrials });
    expect(cards.filter((c) => !c.locked).map((c) => c.id)).toEqual(['720p30']);
    expect(cards[1].reason).toMatch(/\(5,0 Mb\/s\).*pede cerca de 5,1 Mb\/s/);
    expect(cards[1].short).toBe('Pede 6,4 Mb/s · seu upload 5,0');
});
test('locks by source size and by encoder', () => {
    const cards = evaluatePresets({ ...base, sourceHeight: 800, encoding: { '720p30': { supported: true, smooth: false } } });
    expect(cards[0].reason).toMatch(/não segura/);
    expect(cards[1].reason).toMatch(/800 linhas/);
    expect(cards.some((c) => c.recommended)).toBe(false);
});
test('unknown upload does not lock', () => {
    expect(evaluatePresets({ ...base, uploadMbps: null }).find((c) => c.recommended)?.id).toBe('1080p60');
});
test('unlocks native 4K only when throughput, encoder load and upload pass', () => {
    const trial = { encoder: 'av1_nvenc', resolution: '4k', target_fps: 60, ok: true, fps: 75, encoder_load_percent: 80 };
    const input = { ...base, sourceHeight: 2160, uploadMbps: 34.2, trials: [trial] };
    const card = (overrides) => evaluatePresets({ ...input, ...overrides }).find((preset) => preset.id === '4k60');
    expect(card({}).locked).toBe(false);
    expect(card({ uploadMbps: 34.1 }).locked).toBe(true);
    expect(card({ uploadMbps: null }).locked).toBe(true);
    expect(card({ trials: [{ ...trial, fps: 56 }] }).locked).toBe(true);
    expect(card({ trials: [{ ...trial, encoder_load_percent: 81 }] }).locked).toBe(true);
});
test('RTX-class GPU with good upload unlocks 4K30 on a 4K screen and keeps the reason of each lock', () => {
    const trials = ['720p', '1080p', '1440p', '4k'].flatMap((resolution) => [30, 60].map((target_fps) => ({
        encoder: 'av1_nvenc', resolution, target_fps, ok: true, fps: target_fps, encoder_load_percent: resolution === '4k' && target_fps === 60 ? 92 : 50,
    })));
    const cards = evaluatePresets({ ...base, sourceHeight: 2160, sourceWidth: 3840, uploadMbps: 30, trials });
    expect(cards.find((c) => c.id === '4k30')?.locked).toBe(false);
    expect(cards.find((c) => c.id === '4k60')?.short).toBe('Placa acima de 80% de carga');
    expect(evaluatePresets({ ...base, sourceHeight: 2160, sourceWidth: 3840, uploadMbps: 15, trials }).find((c) => c.id === '4k30')?.short)
        .toBe('Pede 20,1 Mb/s · seu upload 15,0');
});
