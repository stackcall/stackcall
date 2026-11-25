import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartaoPerfil } from '../components/CartaoPerfil';
import { recortar } from '../lib/imagem';
import { servidorFalso } from '../lib/falso';
import type { Pessoa } from '../lib/servidor';
import { Perfil } from './Perfil';

const rafa: Pessoa = { id: 'rafa', nome: 'Rafa', papel: 'membro', avatar: null, banner: null, bio: 'clutch ou nada', tema: 'noite', cor: null, online: true, amigo: false, sala: null, jogo: null };

test('cartao shows name, bio, night theme and toggles friend', async () => {
  const onAmigo = vi.fn();
  render(<CartaoPerfil pessoa={rafa} onAmigo={onAmigo} />);
  const dialogo = screen.getByRole('dialog', { name: 'Perfil de Rafa' });
  expect(dialogo).toHaveTextContent('Rafa');
  expect(dialogo).toHaveTextContent('clutch ou nada');
  expect(dialogo.querySelector('.tema-noite')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar amigo' }));
  expect(onAmigo).toHaveBeenCalledWith(true);
});

test('perfil saves bio, theme and color', async () => {
  const servidor = servidorFalso();
  const eu = await servidor.eu();
  const onSalvo = vi.fn();
  render(<Perfil servidor={servidor} eu={eu} onSalvo={onSalvo} onFechar={() => undefined} />);
  await userEvent.clear(screen.getByLabelText('Bio'));
  await userEvent.type(screen.getByLabelText('Bio'), 'nova bio');
  await userEvent.click(screen.getByRole('button', { name: 'Noite' }));
  await userEvent.click(screen.getByRole('button', { name: 'azul' }));
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await vi.waitFor(() => expect(onSalvo).toHaveBeenCalled());
  expect(onSalvo).toHaveBeenCalledWith(expect.objectContaining({ bio: 'nova bio', tema: 'noite', cor: '#1f4fe0' }));
});

test('recortar rejects SVG', async () => {
  const svg = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' });
  await expect(recortar(svg, 256, 256, { zoom: 1, x: 0, y: 0 })).rejects.toThrow('PNG, JPEG ou WebP');
});
