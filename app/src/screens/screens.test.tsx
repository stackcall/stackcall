import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { Entrada } from './Entrada';
import { GoLive } from './GoLive';
import { servidorFalso } from '../lib/falso';
import { lerConvite } from '../lib/convite';
import type { Servidor } from '../lib/servidor';

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
  const cs = await screen.findByRole('button', { name: /Sala CS, 5 pessoas, alguém no ar, você está aqui/ });
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
  expect(await screen.findByText('Ninguém no ar')).toBeInTheDocument();
});

test('room: transmit opens go live with locked presets', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Transmitir' }));
  const dialog = await screen.findByRole('dialog', { name: 'Entrar no ar' });
  expect(within(dialog).getAllByText('O modo de reserva suporta até 1080p60.')).toHaveLength(2);
});

test('go live shows locked 4K and recommends 1080p60 in demo', async () => {
  render(<GoLive demo server="demo" roomLabel="CS" viewers={4} onCancel={() => undefined} onStart={async () => undefined} />);
  expect(await screen.findByText(/upload 100 Mb\/s/)).toBeInTheDocument();
  const radios = screen.getAllByRole('radio');
  expect(radios).toHaveLength(6);
  expect(radios.filter((c) => c.hasAttribute('disabled'))).toHaveLength(3);
  expect(screen.getByRole('radio', { checked: true })).toHaveTextContent('1080p60 fps');
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
