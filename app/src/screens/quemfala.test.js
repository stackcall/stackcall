import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { QuemFalaLista } from '../components/QuemFalaLista';
import { JanelaQuemFala } from './QuemFala';
import { ESTADO_EXEMPLO, publicarQuemFala } from '../lib/quemfala';
import { PREFERENCIAS_PADRAO, salvarPreferencias } from '../lib/preferencias';
beforeEach(() => localStorage.clear());
test('lista: opacidade, ping, aviso de replay e quem fala dito em texto', () => {
    render(_jsx(QuemFalaLista, { estado: ESTADO_EXEMPLO, prefs: { ...PREFERENCIAS_PADRAO, quemFalaOpacidade: 40 } }));
    const lista = screen.getByLabelText('Quem está falando');
    expect(lista).toHaveStyle({ opacity: '0.4' });
    expect(screen.getAllByText('falando')).toHaveLength(2);
    expect(screen.getByText('mudo')).toBeInTheDocument();
    expect(screen.getByText('CS · 142 ms')).toBeInTheDocument();
    expect(screen.getByText('● replay')).toBeInTheDocument();
});
test('lista: "só quem fala" com ninguém falando não desenha nada', () => {
    const calada = { ...ESTADO_EXEMPLO, pessoas: ESTADO_EXEMPLO.pessoas.map((p) => ({ ...p, falando: false })) };
    const { container } = render(_jsx(QuemFalaLista, { estado: calada, prefs: { ...PREFERENCIAS_PADRAO, quemFalaConteudo: 'falando' } }));
    expect(container).toBeEmptyDOMElement();
});
test('janela: recebe o estado da sala pelo canal e segue a preferência salva em outra janela', async () => {
    salvarPreferencias({ quemFalaConteudo: 'falando' });
    render(_jsx(JanelaQuemFala, {}));
    expect(screen.queryByLabelText('Quem está falando')).not.toBeInTheDocument();
    publicarQuemFala(ESTADO_EXEMPLO);
    expect(await screen.findByText('Duda')).toBeInTheDocument();
    expect(screen.queryByText('Léo')).not.toBeInTheDocument();
});
