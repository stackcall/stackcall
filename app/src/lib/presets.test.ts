import { evaluatePresets } from './presets';

const base = { codec: 'av1' as const, uploadMbps: 100, sourceHeight: 1080, encoding: {} };

test('recommends the largest open preset up to 1080p60 and locks 1440p and 4K', () => {
  const cards = evaluatePresets(base);
  const open = cards.filter((c) => !c.locked).map((c) => c.id);
  expect(open).toEqual(['720p30', '1080p30', '1080p60']);
  expect(cards.find((c) => c.recommended)?.id).toBe('1080p60');
  expect(cards.find((c) => c.id === '4k60')?.reason).toMatch(/v0\.2/);
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
