import { evaluatePresets } from './presets';

const base = { codec: 'av1' as const, uploadMbps: 100, sourceHeight: 1080, encoding: {} };

test('recommends the largest open preset up to 1080p60 and locks 1440p and 4K', () => {
  const cards = evaluatePresets(base);
  const open = cards.filter((c) => !c.locked).map((c) => c.id);
  expect(open).toEqual(['720p30', '1080p30', '1080p60']);
  expect(cards.find((c) => c.recommended)?.id).toBe('1080p60');
  expect(cards.find((c) => c.id === '4k60')?.reason).toMatch(/reserva/);
});

test('locks by upload with headroom', () => {
  const cards = evaluatePresets({ ...base, uploadMbps: 20 });
  expect(cards.filter((c) => !c.locked).map((c) => c.id)).toEqual(['720p30']);
  expect(cards[1].reason).toMatch(/20 Mbps/);
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
  const input = { ...base, sourceHeight: 2160, uploadMbps: 130 as number | null, trials: [trial] };
  const card = (overrides: Partial<typeof input>) =>
    evaluatePresets({ ...input, ...overrides }).find((preset) => preset.id === '4k60')!;
  expect(card({}).locked).toBe(false);
  expect(card({ uploadMbps: 129 }).locked).toBe(true);
  expect(card({ uploadMbps: null }).locked).toBe(true);
  expect(card({ trials: [{ ...trial, fps: 56 }] }).locked).toBe(true);
  expect(card({ trials: [{ ...trial, encoder_load_percent: 81 }] }).locked).toBe(true);
});
