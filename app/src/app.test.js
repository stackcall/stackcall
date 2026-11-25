import { jsx as _jsx } from "react/jsx-runtime";
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { App } from './App';
// Captures the deep link handler so the test can "open" an invite link.
let deepLink = null;
vi.mock('./lib/servidores', async (importOriginal) => ({
    ...(await importOriginal()),
    ouvirDeepLinks: async (f) => {
        deepLink = f;
        return () => undefined;
    },
}));
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }) => ({
        getTotalSize: () => count * 64,
        getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64, key: index })),
        scrollToIndex: () => undefined,
        measureElement: () => undefined,
    }),
}));
const convite = { servidor: 'https://outra.turma', codigo: 'abcdef1234', aparelho: false };
beforeEach(() => {
    localStorage.clear();
    deepLink = null;
    history.replaceState(null, '', '/?demo=1');
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    globalThis.ResizeObserver ??= class {
        observe() { }
        unobserve() { }
        disconnect() { }
    };
});
test('an invite link during a call asks first and never drops the room', async () => {
    render(_jsx(App, {}));
    await screen.findByRole('button', { name: 'Sair da sala' });
    await vi.waitFor(() => expect(deepLink).not.toBeNull());
    act(() => deepLink(convite));
    expect(screen.getByText('Convite recebido de outra.turma. Abrir?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(screen.queryByText(/Convite recebido/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
    act(() => deepLink(convite));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(await screen.findByRole('form', { name: 'Entrar no servidor' })).toBeInTheDocument();
    // The room is still mounted under the entry screen, so the voice keeps going.
    expect(screen.getByRole('button', { name: 'Sair da sala', hidden: true })).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para o servidor' }));
    expect(screen.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
});
test('an invite link outside a call opens the entry screen at once', async () => {
    history.replaceState(null, '', '/?demo=1&tela=saguao');
    render(_jsx(App, {}));
    await screen.findByRole('heading', { name: 'Escolha uma sala' });
    await vi.waitFor(() => expect(deepLink).not.toBeNull());
    act(() => deepLink(convite));
    expect(await screen.findByRole('form', { name: 'Entrar no servidor' })).toBeInTheDocument();
});
test('session over: goes to the entry screen with a notice; the call stays only if confirmed', async () => {
    vi.stubGlobal('isTauri', true);
    mockIPC(() => null, { shouldMockEvents: true });
    onTestFinished(() => {
        clearMocks();
        vi.unstubAllGlobals();
    });
    render(_jsx(App, {}));
    await screen.findByRole('button', { name: 'Sair da sala' });
    await act(() => emit('sessao-encerrada'));
    expect(await screen.findByText(/Sua sessão neste aparelho acabou/)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Entrar com convite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair da sala', hidden: true })).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar na voz' }));
    expect(screen.getByText('Você continua na voz, sem sessão neste aparelho.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair da voz' }));
    expect(screen.queryByRole('button', { name: 'Sair da sala', hidden: true })).not.toBeInTheDocument();
});
