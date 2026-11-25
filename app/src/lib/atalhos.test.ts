import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import {
  aoAtalho, comboDeEvento, conflitos, criarControleVoz, dispararAtalho, lerAtalhos, listaParaRust, salvarAtalhos, semModificador,
} from './atalhos';

beforeEach(() => localStorage.clear());

function alvo() {
  const estado = { mic: true, mudo: false };
  return {
    estado,
    micAberto: () => estado.mic,
    abrirMic: vi.fn((on: boolean) => void (estado.mic = on)),
    silenciado: () => estado.mudo,
    alternarSilencio: vi.fn(() => void (estado.mudo = !estado.mudo)),
  };
}

describe('voice actions', () => {
  test('toggle mic and silence; only the global shortcut beeps', () => {
    const a = alvo();
    const som = vi.fn();
    const c = criarControleVoz(a, () => ({ modo: 'voz', soltura: 200 }), som);
    c.executar('mic', 'pressionado');
    expect(a.estado.mic).toBe(false);
    expect(som).toHaveBeenLastCalledWith('desliga');
    c.executar('mic', 'pressionado', false);
    expect(a.estado.mic).toBe(true);
    expect(som).toHaveBeenCalledTimes(1);
    c.executar('mic', 'solto');
    expect(a.estado.mic).toBe(true); // releasing a toggle does nothing
    c.executar('silenciar', 'pressionado');
    expect(a.estado.mudo).toBe(true);
    expect(som).toHaveBeenLastCalledWith('silenciou');
    c.executar('silenciar', 'pressionado');
    expect(som).toHaveBeenLastCalledWith('liga');
  });

  test('push to talk opens while held and closes after the release delay', () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const a = alvo();
    a.estado.mic = false;
    const c = criarControleVoz(a, () => ({ modo: 'ptt', soltura: 200 }), vi.fn());
    c.executar('falar', 'pressionado');
    expect(a.estado.mic).toBe(true);
    c.executar('falar', 'solto');
    vi.advanceTimersByTime(199);
    expect(a.estado.mic).toBe(true);
    // Pressing again inside the delay keeps it open.
    c.executar('falar', 'pressionado');
    vi.advanceTimersByTime(500);
    expect(a.estado.mic).toBe(true);
    c.executar('falar', 'solto');
    vi.advanceTimersByTime(200);
    expect(a.estado.mic).toBe(false);
  });

  test('push to talk does nothing in voice detection mode or while silenced', () => {
    const a = alvo();
    a.estado.mic = false;
    criarControleVoz(a, () => ({ modo: 'voz', soltura: 200 }), vi.fn()).executar('falar', 'pressionado');
    expect(a.abrirMic).not.toHaveBeenCalled();
    a.estado.mudo = true;
    criarControleVoz(a, () => ({ modo: 'ptt', soltura: 200 }), vi.fn()).executar('falar', 'pressionado');
    expect(a.abrirMic).not.toHaveBeenCalled();
  });

  test('room actions are left to the room', () => {
    expect(criarControleVoz(alvo(), () => ({ modo: 'voz', soltura: 0 }), vi.fn()).executar('arEntrar', 'pressionado')).toBe(false);
  });
});

test('conflicts: the same combination on two actions, case and spaces ignored', () => {
  expect(conflitos({ mic: 'Ctrl+Shift+M', silenciar: 'ctrl + shift + m', arSair: 'F13' })).toEqual({ mic: ['silenciar'], silenciar: ['mic'] });
  expect(conflitos({ mic: 'Ctrl+Shift+M', silenciar: 'Ctrl+Shift+D' })).toEqual({});
  expect(semModificador('M')).toBe(true);
  expect(semModificador('Mouse4')).toBe(false);
  expect(semModificador('F13')).toBe(false);
  expect(semModificador('Ctrl+M')).toBe(false);
});

test('nothing on by default; saved per PC; unknown actions dropped', () => {
  expect(lerAtalhos()).toEqual({ teclas: {}, som: true });
  salvarAtalhos({ teclas: { mic: 'Ctrl+Shift+M', falar: 'Mouse4' }, som: false });
  expect(lerAtalhos()).toEqual({ teclas: { mic: 'Ctrl+Shift+M', falar: 'Mouse4' }, som: false });
  localStorage.setItem('stackcall.atalhos', JSON.stringify({ teclas: { mic: 'F13', hack: 'F1' } }));
  expect(lerAtalhos().teclas).toEqual({ mic: 'F13' });
  localStorage.setItem('stackcall.atalhos', '{nope');
  expect(lerAtalhos()).toEqual({ teclas: {}, som: true });
});

test('saving sends the whole list to Rust in the contract format', async () => {
  vi.stubGlobal('isTauri', true);
  const definir = vi.fn();
  mockIPC((cmd, args) => {
    if (cmd === 'atalhos_definir') definir(args);
    return null;
  });
  onTestFinished(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });
  salvarAtalhos({ teclas: { silenciar: 'Ctrl+Shift+D', mic: 'Ctrl+Shift+M' } });
  await vi.waitFor(() => expect(definir).toHaveBeenCalled());
  expect(definir).toHaveBeenLastCalledWith({ atalhos: [{ id: 'mic', teclas: 'Ctrl+Shift+M' }, { id: 'silenciar', teclas: 'Ctrl+Shift+D' }] });
  expect(listaParaRust({ teclas: {}, som: true })).toEqual([]);
});

test('combination text from a key event, in the Rust format', () => {
  const ev = (p: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...p });
  expect(comboDeEvento(ev({ key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+M');
  expect(comboDeEvento(ev({ key: 'F13', code: 'F13' }))).toBe('F13');
  expect(comboDeEvento(ev({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1');
  expect(comboDeEvento(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull();
});

test('shortcut events reach the room listener', () => {
  const f = vi.fn();
  const parar = aoAtalho(f);
  dispararAtalho('falar', 'pressionado');
  dispararAtalho('mostrar', 'pressionado'); // handled by the app itself, not the room
  expect(f).toHaveBeenCalledTimes(1);
  expect(f).toHaveBeenCalledWith('falar', 'pressionado');
  parar();
});
