import { useEffect, useState } from 'react';
import { Paleta } from './Paleta';
import { Clipes } from '../screens/Clipes';
import { AJUSTES, GRUPOS, paginaDe, paginasVisiveis, type PaginaId } from '../lib/buscaConfig';
import { receberCutucada } from '../lib/cutucar';
import { cutucadasPendentes, somSilenciado } from '../lib/cutucadas';
import { replay } from '../lib/nucleo';
import { aoAbrir, itensSala, type ItemPaleta } from '../lib/paleta';
import type { Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { useTema } from '../lib/tema';

/**
 * 0.5 layer above every screen: the command palette (Ctrl+K and the search on the top bar), the clip
 * gallery, and pokes found on my own profile, handed to lib/cutucar.ts (voice, Windows notice and
 * the strip, which App shows in the lobby and in the room).
 */
export function Camada05({ servidor, eu, pessoas, salas, sala, onSala, onConfig, onCartao }: {
  servidor: Servidor | null; eu: Usuario | null; pessoas: Pessoa[]; salas: Sala[]; sala: string | null;
  onSala(id: string | null): void; onConfig(pagina?: PaginaId): void; onCartao(id: string): void;
}) {
  const [paleta, setPaleta] = useState<string | null>(null);
  const [clipes, setClipes] = useState(false);
  const [tema, setTema] = useTema();

  // Ctrl+K opens the palette from any screen; the top bar search and the film button come through the bus.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.altKey) {
        e.preventDefault();
        setPaleta((p) => (p === null ? '' : null));
      }
    };
    window.addEventListener('keydown', tecla);
    const parar = aoAbrir((o) => (o === 'clipes' ? setClipes(true) : setPaleta('')));
    return () => {
      window.removeEventListener('keydown', tecla);
      parar();
    };
  }, []);

  // The porteiro hands each poke once, on my own profile; receberCutucada also ignores repeated ids.
  useEffect(() => {
    if (!eu) return;
    for (const c of cutucadasPendentes(pessoas, eu.id, salas)) receberCutucada(c, { silenciado: somSilenciado() });
  }, [pessoas, eu, salas]);

  const itens = (): ItemPaleta[] => {
    const admin = eu?.papel === 'dono' || eu?.papel === 'admin';
    const paginas = paginasVisiveis(!!(servidor && eu), admin);
    const grupo = (id: PaginaId) => GRUPOS.find((g) => g.id === paginaDe(id).grupo)?.rotulo ?? '';
    const abrirPagina = (id: PaginaId) => () => onConfig(id);
    return [
      ...itensSala(),
      { id: 'tema', grupo: 'acoes', rotulo: tema === 'escuro' ? 'Tema claro' : 'Tema escuro', onde: 'aparência', icone: 'ajustes', apelidos: ['tema', 'dark', 'claro', 'escuro'],
        executar: () => setTema(tema === 'escuro' ? 'claro' : 'escuro'), configurar: abrirPagina('aparencia') },
      { id: 'clipes', grupo: 'acoes', rotulo: 'Abrir os clipes', onde: 'clipes', icone: 'filme', apelidos: ['galeria', 'replay'],
        executar: () => setClipes(true), configurar: abrirPagina('clipes') },
      ...salas.map((s): ItemPaleta => ({
        id: `sala-${s.id}`, grupo: 'salas', rotulo: s.id === sala ? `${s.nome} (você está aqui)` : `Entrar em ${s.nome}`,
        detalhe: s.noAr ? 'alguém no ar' : s.pessoas ? `${s.pessoas} na sala` : undefined, onde: s.pessoas ? 'sala' : 'vazia', icone: 'chat',
        executar: () => onSala(s.id),
      })),
      ...pessoas.filter((p) => p.id !== eu?.id).map((p): ItemPaleta => ({
        id: `pessoa-${p.id}`, grupo: 'salas', pessoa: true, rotulo: p.nome,
        detalhe: p.jogo ? `jogando ${p.jogo}` : undefined,
        onde: p.online ? (p.sala ? (p.sala === sala ? 'na sala' : salas.find((s) => s.id === p.sala)?.nome ?? 'em outra sala') : 'online') : 'offline',
        icone: 'pessoa', executar: () => onCartao(p.id),
      })),
      // Settings: every page, then every setting of lib/buscaConfig.ts (the same search as the Settings screen).
      ...paginas.map((p): ItemPaleta => ({
        id: `pagina-${p.id}`, grupo: 'config', rotulo: p.rotulo, onde: grupo(p.id), icone: 'ajustes', executar: abrirPagina(p.id), configurar: abrirPagina(p.id),
      })),
      ...AJUSTES.filter((a) => paginas.some((p) => p.id === a.pagina)).map((a): ItemPaleta => ({
        id: `ajuste-${a.id}`, grupo: 'config', rotulo: a.titulo, onde: paginaDe(a.pagina).rotulo, icone: 'ajustes',
        apelidos: [...(a.apelidos ?? []), a.descricao], executar: abrirPagina(a.pagina), configurar: abrirPagina(a.pagina),
      })),
    ];
  };

  return (
    <>
      {clipes && <Clipes onFechar={() => setClipes(false)} onReplay={() => void replay.alternar()} />}
      {paleta !== null && <Paleta itens={itens()} inicial={paleta} onFechar={() => setPaleta(null)} onConfiguracoes={() => onConfig()} />}
    </>
  );
}
