import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import type { Usuario } from '../../lib/servidor';
import type { Person } from '../../room/model';
import { MenuPessoa } from './MenuPessoa';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

const usuario =(papel: Usuario['papel']): Usuario => ({ id: 'eu', nome: 'Eu', papel, avatar: null, banner: null, bio: '', tema: 'papel', cor: null });
const leo: Person = { id: 'leo', name: 'Léo', isLocal: false, speaking: false, muted: false, level: 0, volume: 0.6, live: false, rede: { qualidade: 'ruim', ms: 210, perda: 0.03 } };

function abrir(papel: Usuario['papel']) {
  const acoes = { onVolume: vi.fn(), onPerfil: vi.fn(), onAssistir: vi.fn(), onCutucar: vi.fn(), onSilenciarParaMim: vi.fn(), onMover: vi.fn(), onTirar: vi.fn(), onFechar: vi.fn() };
  render(<MenuPessoa {...acoes} ancora={{ x: 10, y: 10 }} person={leo} eu={usuario(papel)} salas={[{ id: 'cs', nome: 'CS', ordem: 1, pessoas: 3, noAr: false }, { id: 'lobby', nome: 'Lobby', ordem: 2, pessoas: 0, noAr: false }]}
    salaAtual="cs" esperaCutucar={0} silenciadoParaMim={false} />);
  return acoes;
}

describe('menu da pessoa (item 5)', () => {
  it('a member sees no moderation', () => {
    abrir('membro');
    expect(screen.getByRole('menuitem', { name: 'Silenciar para mim' })).toBeInTheDocument();
    expect(screen.queryByText(/Moderação/)).toBeNull();
    expect(screen.getByText('210 ms · 3% perda')).toBeInTheDocument();
  });

  it('the owner confirms before taking someone out of the room', async () => {
    const a = abrir('dono');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tirar da sala…' }));
    expect(a.onTirar).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Tirar Léo da sala' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tirar da sala' }));
    expect(a.onTirar).toHaveBeenCalledOnce();
    expect(a.onFechar).toHaveBeenCalled();
  });

  it('moves to another room, never to the current one', async () => {
    const a = abrir('admin');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mover para' }));
    expect(screen.queryByRole('menuitem', { name: /^CS/ })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: /Lobby/ }));
    expect(a.onMover).toHaveBeenCalledWith('lobby');
  });

  it('poke stays open (no close) so the poke panel can take over', async () => {
    const a = abrir('membro');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cutucar…' }));
    expect(a.onCutucar).toHaveBeenCalledOnce();
    expect(a.onFechar).not.toHaveBeenCalled();
  });
});

describe('modo internet ruim (item 8)', () => {
  it('is remembered between sessions', () => {
    salvarPreferencias({ redeRuim: true });
    expect(lerPreferencias().redeRuim).toBe(true);
    salvarPreferencias({ redeRuim: false });
    expect(lerPreferencias().redeRuim).toBe(false);
  });
});
