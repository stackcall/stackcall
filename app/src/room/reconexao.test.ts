import { act, renderHook } from '@testing-library/react';
import type { RoomModel } from './model';
import { useReconexao } from './reconexao';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const montar = (autoRetry = true) => {
  const tentar = vi.fn();
  const hook = renderHook(({ state }: { state: RoomModel['state'] }) => useReconexao(state, autoRetry, tentar), {
    initialProps: { state: 'error' as RoomModel['state'] },
  });
  return { tentar, ...hook };
};

test('retries after 2 s, 5 s and 10 s, then hands over to the button', () => {
  const { tentar, result, rerender } = montar();
  act(() => vi.advanceTimersByTime(1999));
  expect(tentar).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(tentar).toHaveBeenCalledTimes(1);
  // Each attempt goes through "connecting" and fails again.
  rerender({ state: 'connecting' });
  rerender({ state: 'error' });
  act(() => vi.advanceTimersByTime(5000));
  expect(tentar).toHaveBeenCalledTimes(2);
  rerender({ state: 'connecting' });
  rerender({ state: 'error' });
  act(() => vi.advanceTimersByTime(10000));
  expect(tentar).toHaveBeenCalledTimes(3);
  rerender({ state: 'connecting' });
  rerender({ state: 'error' });
  act(() => vi.advanceTimersByTime(60000));
  expect(tentar).toHaveBeenCalledTimes(3);
  expect(result.current.esgotou).toBe(true);

  act(() => result.current.reconectar());
  expect(tentar).toHaveBeenCalledTimes(4);
  expect(result.current.esgotou).toBe(false);
});

test('waits for the network to come back instead of burning attempts offline', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const { tentar } = montar();
  act(() => vi.advanceTimersByTime(30000));
  expect(tentar).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => void window.dispatchEvent(new Event('online')));
  expect(tentar).toHaveBeenCalledTimes(1);
});

test('does not retry a disconnect that would repeat (removed, duplicate login)', () => {
  const { tentar, result } = montar(false);
  act(() => vi.advanceTimersByTime(30000));
  expect(tentar).not.toHaveBeenCalled();
  expect(result.current.esgotou).toBe(true);
});

test('a successful connection resets the count', () => {
  const { tentar, result, rerender } = montar();
  act(() => vi.advanceTimersByTime(2000));
  rerender({ state: 'connected' });
  expect(result.current.falhas).toBe(0);
  rerender({ state: 'error' });
  act(() => vi.advanceTimersByTime(2000));
  expect(tentar).toHaveBeenCalledTimes(2);
});
