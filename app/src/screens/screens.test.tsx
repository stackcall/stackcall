import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { App } from '../App';
import { Entrada } from './Entrada';
import { GoLive } from './GoLive';
import { servidorFalso } from '../lib/falso';
import { lerConvite } from '../lib/convite';
import { uploadMedido, type Servidor } from '../lib/servidor';

vi.mock('../lib/servidor', { spy: true });

// jsdom has no layout, so the virtual list would render nothing; show every message.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64, key: index })),
    scrollToIndex: () => undefined,
    measureElement: () => undefined,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  // jsdom lacks these browser APIs.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

test('entrada: pasted link shows the preview, asks only the name and enters', async () => {
  history.replaceState(null, '', '/?tela=entrada');
  const servidor = servidorFalso('https://galera.test');
  const aceitar = vi.spyOn(servidor, 'aceitar');
  const onEntrou = vi.fn();
  const { rerender } = render(<Entrada link={null} servidorDe={() => servidor} onLink={() => undefined} onEntrou={onEntrou} onConfig={() => undefined} />);
  expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();

  const onLink = vi.fn();
  rerender(<Entrada link={null} servidorDe={() => servidor} onLink={onLink} onEntrou={onEntrou} onConfig={() => undefined} />);
  await userEvent.type(screen.getByLabelText('Colar link de convite'), 'bora jogar');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('não parece um link de convite');
  await userEvent.clear(screen.getByLabelText('Colar link de convite'));
  await userEvent.type(screen.getByLabelText('Colar link de convite'), 'https://galera.test/c/abcdef1234');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(onLink).toHaveBeenCalledWith({ servidor: 'https://galera.test', codigo: 'abcdef1234', aparelho: false });

  rerender(<Entrada link={onLink.mock.calls[0][0]} servidorDe={() => servidor} onLink={onLink} onEntrou={onEntrou} onConfig={() => undefined} />);
  expect(await screen.findByText('Filippe chamou você para')).toBeInTheDocument();
  expect(screen.getByText(/não é o oficial/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Seu nome'), 'João:tela');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar em galera.test' }));
  expect(screen.getByRole('alert')).toHaveTextContent('sem dois-pontos');
  expect(aceitar).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText('Seu nome'));
  await userEvent.type(screen.getByLabelText('Seu nome'), 'João');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar em galera.test' }));
  expect(aceitar).toHaveBeenCalledWith('abcdef1234', 'João');
  expect(onEntrou).toHaveBeenCalledWith(servidor, 'Galera', expect.objectContaining({ nome: 'João' }));
  expect(JSON.stringify(localStorage)).not.toContain('abcdef1234');
});

test('entrada: expired invite shows the reason and a way out', async () => {
  const servidor = servidorFalso('https://galera.test');
  const onLink = vi.fn();
  render(<Entrada link={lerConvite('https://galera.test/c/expirado')} servidorDe={() => servidor} onLink={onLink} onEntrou={() => undefined} onConfig={() => undefined} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('já foi usado ou expirou');
  await userEvent.click(screen.getByRole('button', { name: 'Colar outro link' }));
  expect(onLink).toHaveBeenCalledWith(null);
});

test('real server: every call goes through the Rust proxy, never fetch', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const { servidorReal } = await import('../lib/servidor');
  const s: Servidor = servidorReal('https://galera.test');
  await expect(s.eu()).rejects.toThrow('Abra pelo app do Stackcall.');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('room: tabs with live dot, stage numbers, watch, chat, mic and volume', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  const cs = await screen.findByRole('button', { name: /Sala CS, 4 pessoas, alguém no ar, você está aqui/ });
  expect(cs).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('status', { name: /Ping 142 milissegundos, bom/ })).toBeInTheDocument();
  expect(screen.getByText(/1080p60 · AV1 · 4,2 Mb\/s · 3 assistindo/)).toBeInTheDocument();
  expect(screen.getByText('na voz · CS')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Parar de assistir' }));
  expect(screen.getByText(/2 assistindo/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Assistir' }));

  await userEvent.type(screen.getByLabelText('Mensagem'), 'boa!{Enter}');
  expect(within(screen.getByRole('log', { name: 'Mensagens' })).getByText('boa!')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Desligar microfone' }));
  expect(screen.getByRole('button', { name: 'Ligar microfone' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('slider', { name: /Volume de/ })).toHaveLength(4);

  await userEvent.click(screen.getByRole('button', { name: 'Sair da sala' }));
  expect(await screen.findByRole('heading', { name: 'Escolha uma sala' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Entrar na sala Lobby' }));
  expect(await screen.findByText('Palco livre')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Transmitir/ })).toHaveLength(1);
});

test('room: transmit opens go live with the native layout and the reason of each lock', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Transmitir' }));
  const dialog = await screen.findByRole('dialog', { name: 'Entrar no ar' });
  expect(await within(dialog).findByRole('radio', { name: /Tela 1/ })).toHaveAttribute('aria-checked', 'true');
  expect(within(dialog).getByRole('radio', { name: /^4K.*60 fps/ })).toHaveTextContent('Placa acima de 80% de carga');
  expect(within(dialog).getByRole('radio', { name: /^4K.*30 fps/ })).toBeEnabled();
});

test('go live: Escape closes, Enter on a tile goes live, arrows move the choice', async () => {
  const onCancel = vi.fn();
  render(<GoLive demo server="demo" roomLabel="CS" viewers={0} onCancel={onCancel} onStart={async () => undefined} />);
  expect(screen.getByText(/ninguém na sala ainda/)).toBeInTheDocument();
  const tela1 = await screen.findByRole('radio', { name: /Tela 1/ });
  tela1.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: /Tela 2/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /Tela 2/ })).toHaveFocus();
  // Tela 2 is 1080p: 1440p and 4K stay in the list, locked, with the reason.
  expect(screen.getByRole('radio', { name: /^1440p/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /^1440p/ })).toHaveTextContent('Fonte com 1080 linhas');
  await userEvent.keyboard('{Enter}');
  expect(onCancel).toHaveBeenCalledTimes(1); // demo: going live only closes
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(2);
});

test('go live layout: only the source list scrolls and the action bar is outside it', async () => {
  render(<GoLive demo server="demo" roomLabel="CS" viewers={4} onCancel={() => undefined} onStart={async () => undefined} />);
  const dialog = screen.getByRole('dialog', { name: 'Entrar no ar' });
  // shortcut: jsdom has no layout; real sizes were checked in the browser at 1920x1080, 1366x768 and 1100x700.
  expect(dialog.className).toMatch(/grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
  expect(dialog.className).not.toMatch(/overflow/);
  expect((await screen.findByRole('radiogroup', { name: 'Telas e janelas' })).className).toMatch(/overflow-y-auto/);
  const action = screen.getByRole('button', { name: 'Entrar no ar' });
  expect(action.closest('.overflow-y-auto')).toBeNull();
  await vi.waitFor(() => expect(action).toBeEnabled());
});

test('go live keeps the case of Mb/s inside uppercase labels', async () => {
  render(<GoLive demo server="demo" roomLabel="CS" viewers={4} onCancel={() => undefined} onStart={async () => undefined} />);
  const units = await screen.findAllByText('Mb/s');
  expect(units.length).toBeGreaterThanOrEqual(2);
  for (const unit of units) expect(unit).toHaveClass('normal-case');
});

const nativeSources = [
  { id: 'hmonitor:1', title: 'Tela 1', process_name: null, pid: null, width: 1920, height: 1080, thumbnail: null, minimized: false },
  { id: 'hwnd:123:456', title: 'Counter-Strike 2', process_name: 'cs2.exe', pid: 456, width: 1920, height: 1080, thumbnail: null, minimized: true },
];
const nativeTrials = [
  { encoder: 'av1_nvenc', resolution: '720p', target_fps: 30, ok: true, fps: 30, encoder_load_percent: 50 },
  { encoder: 'av1_nvenc', resolution: '1080p', target_fps: 60, ok: true, fps: 60, encoder_load_percent: 60 },
];

function nativeSetup(core: (command: string) => unknown = () => undefined) {
  vi.stubGlobal('isTauri', true);
  vi.mocked(uploadMedido).mockResolvedValue(26.4);
  onTestFinished(() => {
    clearMocks();
    vi.unstubAllGlobals();
    vi.mocked(uploadMedido).mockRestore();
  });
  const calls: string[] = [];
  mockIPC((command) => {
    calls.push(command);
    const custom = core(command);
    if (custom !== undefined) return custom;
    if (command === 'listar_fontes') return nativeSources;
    if (command === 'testar_maquina') return { trials: nativeTrials, adapters: [{ name: 'NVIDIA GeForce RTX 5060', driver_version: '1' }] };
    throw new Error(`Unexpected Tauri command: ${command}`);
  });
  return calls;
}

const renderNative = (onNativeStart: () => Promise<void> = async () => undefined) => render(
  <GoLive demo={false} server="demo" roomLabel="CS" viewers={4} onCancel={() => undefined} onStart={async () => undefined} onNativeStart={onNativeStart} />,
);

test('go live uses the corrected dimensions of a minimized native source and remembers source and preset', async () => {
  nativeSetup();
  const { unmount } = renderNative();
  expect(await screen.findByRole('radio', { name: /Tela 1/ })).toHaveAttribute('aria-checked', 'true');
  const cs = screen.getByRole('radio', { name: /Counter-Strike 2/ });
  expect(cs).toHaveTextContent('1920×1080');
  expect(cs).toHaveTextContent(/minimizada: volte ao jogo antes de entrar no ar/i);
  await userEvent.click(cs);
  const p1080 = await screen.findByRole('radio', { name: /^1080p.*60 fps/ });
  await vi.waitFor(() => expect(p1080).toBeEnabled());
  await userEvent.click(p1080);
  expect(p1080).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('button', { name: 'Entrar no ar' })).toBeEnabled();
  unmount();

  renderNative();
  expect(await screen.findByRole('radio', { name: /Counter-Strike 2/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /^1080p.*60 fps/ })).toHaveAttribute('aria-checked', 'true');
});

test('go live shows the saved GPU test at once and probes only after the thumbnails', async () => {
  localStorage.setItem('stackcall.placa', JSON.stringify({ gpu: { name: 'NVIDIA GeForce RTX 5060', driver: '1' }, trials: nativeTrials, at: Date.now() }));
  let release = () => undefined as void;
  const gate = new Promise<void>((r) => { release = r; });
  const calls = nativeSetup((command) => (command === 'listar_fontes' ? gate.then(() => nativeSources) : undefined));
  renderNative();
  expect(await screen.findByRole('radio', { name: /^720p/ })).toBeInTheDocument();
  expect(screen.getByText(/NVIDIA GeForce RTX 5060/)).toBeInTheDocument();
  expect(calls).toEqual(['listar_fontes']);
  release();
  await screen.findByRole('radio', { name: /Tela 1/ });
  await vi.waitFor(() => expect(calls).toEqual(['listar_fontes', 'testar_maquina']));
});

test('go live keeps the native mode on a server error and offers to retry', async () => {
  nativeSetup();
  const onNativeStart = vi.fn().mockRejectedValueOnce(new Error('Já existe uma transmissão em andamento.')).mockResolvedValue(undefined);
  renderNative(onNativeStart);
  await screen.findByRole('radio', { name: /Tela 1/ });
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Entrar no ar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Entrar no ar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma transmissão em andamento');
  expect(screen.queryByText('Modo de reserva (WebView2)')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  expect(onNativeStart).toHaveBeenCalledTimes(2);
});

test('go live falls back to WebView2 with the reason when the core is missing', async () => {
  nativeSetup((command) => {
    if (command === 'listar_fontes') return Promise.reject('O núcleo de transmissão não está disponível nesta máquina.');
  });
  renderNative();
  const banner = await screen.findByText('Modo de reserva (WebView2)');
  expect(banner.parentElement).toHaveTextContent('O núcleo não listou as telas: O núcleo de transmissão não está disponível nesta máquina.');
  expect(screen.getByRole('button', { name: /Escolher tela ou janela/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tentar o modo nativo' })).toBeInTheDocument();
});

test('settings: admin generates, copies and revokes an invite; creates a room', async () => {
  history.replaceState(null, '', '/?demo=1');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Configurações' }));
  const dialog = screen.getByRole('dialog', { name: 'Configurações' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar convite' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/galera\.exemplo\/c\//));
  const revogar = await within(dialog).findAllByRole('button', { name: 'Revogar' });
  expect(revogar).toHaveLength(2);
  await userEvent.click(revogar[0]);
  expect(within(dialog).getAllByRole('button', { name: 'Revogar' })).toHaveLength(1);

  await userEvent.type(within(dialog).getByLabelText('Nome da nova sala'), 'Filme');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Criar sala' }));
  expect(within(dialog).getByText('Filme')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Sobre e atualizações' }));
  expect(within(dialog).getByRole('combobox')).toHaveValue('estavel');
  expect(await within(dialog).findByText('5 novidades, 1 ajuste')).toBeInTheDocument();
});

test('friends: add and remove from the side panel', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  await userEvent.click(await screen.findByRole('tab', { name: /Pessoas/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar Léo aos amigos' }));
  expect(screen.getByRole('button', { name: 'Remover Léo dos amigos' })).toBeInTheDocument();
});

test('lobby, small group with nobody in voice: rooms, invite and people outside voice, no room columns', async () => {
  history.replaceState(null, '', '/?demo=1&tela=saguao&grupo=pequeno');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Escolha uma sala' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entrar na sala Geral' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /^Sala / })).not.toBeInTheDocument();
  const fora = screen.getByRole('region', { name: 'Fora da voz' });
  expect(within(fora).getByText('Caio')).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('region', { name: 'Chame a galera' })).getByRole('button', { name: 'Convidar' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/c\//));
  expect(await screen.findByText('Link copiado.')).toBeInTheDocument();
});
