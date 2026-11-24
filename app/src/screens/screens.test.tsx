import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { Login } from './Login';
import { GoLive } from './GoLive';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  // jsdom lacks these browser APIs.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

test('login prefills the server, validates the name and posts the token request', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'wss://x/rtc', token: 't', screen_token: 's' })));
  const onEnter = vi.fn();
  render(<Login onEnter={onEnter} onSettings={() => undefined} />);
  expect(screen.getByLabelText('Servidor')).toHaveValue('https://stackcall.80-190-79-129.sslip.io');

  await userEvent.type(screen.getByLabelText('Nome'), 'João:tela');
  await userEvent.type(screen.getByLabelText('Convite'), 'segredo');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('sem dois-pontos');
  expect(fetchMock).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText('Nome'));
  await userEvent.type(screen.getByLabelText('Nome'), 'João Silva');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(fetchMock).toHaveBeenCalledWith('https://stackcall.80-190-79-129.sslip.io/api/token', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ convite: 'segredo', nome: 'João Silva', sala: 'geral' });
  expect(onEnter).toHaveBeenCalledWith({ server: 'https://stackcall.80-190-79-129.sslip.io', name: 'João Silva', invite: 'segredo' });
  expect(localStorage.getItem('stackcall.nome')).toBe('João Silva');
  expect(JSON.stringify(localStorage)).not.toContain('segredo');
});

test('login shows the porteiro error for a wrong invite', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
  render(<Login onEnter={() => undefined} onSettings={() => undefined} />);
  await userEvent.type(screen.getByLabelText('Nome'), 'Joao');
  await userEvent.type(screen.getByLabelText('Convite'), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Convite não confere');
});

test('demo room: tabs, stage, watch, chat, mute and update banner', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  expect(screen.getByRole('tab', { name: /CS/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByText('RAFA').length).toBeGreaterThan(0);
  expect(screen.getByText(/3 ASSISTINDO/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Stackcall 0.2.0');
  expect(screen.getByRole('button', { name: 'Atualizar ao sair da sala' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Parar de assistir' }));
  expect(screen.getByText(/2 ASSISTINDO/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Assistir' }));

  await userEvent.type(screen.getByLabelText('Mensagem'), 'boa!{Enter}');
  expect(within(screen.getByRole('complementary', { name: 'Chat da sala' })).getByText('boa!')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Mic aberto' }));
  expect(screen.getByRole('button', { name: 'Mudo' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('slider', { name: /Volume de/ })).toHaveLength(4);

  await userEvent.click(screen.getByRole('button', { name: 'Entrar no ar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Entrar no ar' });
  expect(within(dialog).getAllByText('O modo de reserva suporta até 1080p60.')).toHaveLength(2);
});

test('go live shows locked 4K and recommends 1080p60 in demo', async () => {
  render(<GoLive demo server="demo" roomLabel="CS" viewers={4} onCancel={() => undefined} onStart={async () => undefined} />);
  expect(await screen.findByText(/upload 100 Mbps/)).toBeInTheDocument();
  const cards = screen.getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'));
  expect(cards).toHaveLength(6);
  expect(cards.filter((c) => c.hasAttribute('disabled'))).toHaveLength(3);
  expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('1080p60 FPSESCOLHIDO');
  expect(screen.getAllByText('O modo de reserva suporta até 1080p60.')).toHaveLength(2);
});

test('settings shows version, stable channel and history', async () => {
  history.replaceState(null, '', '/?demo=1');
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Configurações' }));
  const dialog = screen.getByRole('dialog', { name: 'Configurações' });
  expect(within(dialog).getByText('SOBRE E ATUALIZAÇÕES')).toBeInTheDocument();
  expect(within(dialog).getByRole('combobox')).toHaveValue('estavel');
  expect(await within(dialog).findByText('5 novidades, 1 ajuste')).toBeInTheDocument();
});
