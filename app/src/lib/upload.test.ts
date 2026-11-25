import { medirUpload, taxaUpload } from './servidor';

test('upload rate ignores the requests under 1 MB', () => {
  const mb = 1024 * 1024;
  // 256 KB in 500 ms would drag the average down; only the 1 MB and 2 MB requests count.
  expect(taxaUpload([{ bytes: mb / 4, ms: 500 }, { bytes: mb, ms: 400 }, { bytes: 2 * mb, ms: 600 }]))
    .toBeCloseTo((3 * mb * 8) / 1e6, 5);
  expect(taxaUpload([{ bytes: mb / 4, ms: 1000 }])).toBeCloseTo((mb / 4 * 8) / 1e6, 5);
  expect(taxaUpload([])).toBe(0);
});

test('upload test keeps two requests in flight', async () => {
  let open = 0;
  let most = 0;
  vi.stubGlobal('fetch', async () => {
    most = Math.max(most, ++open);
    await new Promise((r) => setTimeout(r, 20));
    open--;
    return new Response(null, { status: 204 });
  });
  onTestFinished(() => { vi.unstubAllGlobals(); });
  expect(await medirUpload('https://srv.test/', 0.1)).toBeGreaterThan(0);
  expect(most).toBe(2);
});

test('upload test returns null when the server refuses', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));
  onTestFinished(() => { vi.unstubAllGlobals(); });
  expect(await medirUpload('https://srv.test', 0.1)).toBeNull();
});
