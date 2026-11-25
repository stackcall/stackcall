import { useEffect, useRef, useState } from 'react';
import { Icone } from './Icone';
import { Paleta } from './Paleta';
import { Clipes } from '../screens/Clipes';
import { anunciarCutucada, esperaCutucar, marcarCutucada, novasCutucadas, somSilenciado, type Recebida } from '../lib/cutucadas';
import { nucleo } from '../lib/nucleo';
import { aoAbrir, itensSala, type ItemPaleta } from '../lib/paleta';
import type { Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { useTema } from '../lib/tema';

export type SecaoConfig = 'servidor' | 'servidores' | 'voz' | 'atalhos' | 'sobre';

/**
 * 0.5 layer above every screen: the command palette (Ctrl+K and the search on the top bar), the clip
 * gallery and the poke received (voice, Windows notice and the strip with "Entrar na sala").
 * Kept out of App.tsx, which another thread edits for the presence refresh.
 */
export function Camada05({ servidor, eu, pessoas, salas, sala, onSala, onConfig, onCartao }: {
  servidor: Servidor | null; eu: Usuario | null; pessoas: Pessoa[]; salas: Sala[]; sala: string | null;
  onSala(id: string | null): void; onConfig(secao?: SecaoConfig): void; onCartao(id: string): void;
}) {
  const [paleta, setPaleta] = useState<string | null>(null);
  const [clipes, setClipes] = useState(false);
  const [cutucada, setCutucada] = useState<Recebida | null>(null);
  const [tema, setTema] = useTema();
  const vistas = useRef(new Set<string>());

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

  // Pokes arrive in the presence list; each id is announced once.
  useEffect(() => {
    for (const r of novasCutucadas(pessoas, vistas.current)) {
      anunciarCutucada(r, somSilenciado(), undefined, () => r.salaId && onSala(r.salaId));
      setCutucada(r);
    }
  }, [pessoas]);
  // The strip stays until closed or until the person enters the room.
  useEffect(() => {
    if (cutucada?.salaId && cutucada.salaId === sala) setCutucada(null);
  }, [sala, cutucada]);

  const itens = (): ItemPaleta[] => {
    const config = (id: string, rotulo: string, secao: SecaoConfig, onde: string, apelidos: string[] = []): ItemPaleta =>
      ({ id, grupo: 'config', rotulo, onde, icone: 'ajustes', apelidos, executar: () => onConfig(secao), configurar: () => onConfig(secao) });
    return [
      ...itensSala(),
      { id: 'tema', grupo: 'acoes', rotulo: tema === 'escuro' ? 'Tema claro' : 'Tema escuro', onde: 'aparência', icone: 'ajustes', apelidos: ['tema', 'dark', 'claro', 'escuro'],
        executar: () => setTema(tema === 'escuro' ? 'claro' : 'escuro'), configurar: () => onConfig('voz') },
      { id: 'clipes', grupo: 'acoes', rotulo: 'Abrir os clipes', onde: 'clipes', icone: 'filme', apelidos: ['galeria', 'replay'], executar: () => setClipes(true) },
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
      config('cfg-voz', 'Microfone e saída de som', 'voz', 'Voz e tema', ['mic', 'microfone', 'mute', 'fone', 'saida']),
      config('cfg-ruido', 'Redução de ruído', 'voz', 'Voz e tema', ['ruido', 'rnnoise', 'teclado']),
      config('cfg-ptt', 'Apertar para falar', 'voz', 'Voz e tema', ['ptt', 'push to talk', 'modo de voz']),
      config('cfg-rede', 'Teste de rede e microfone', 'voz', 'Voz e tema', ['teste', 'ping', 'perda']),
      config('cfg-atalhos', 'Atalhos', 'atalhos', 'Atalhos', ['tecla', 'global', 'hotkey']),
      ...(eu?.papel === 'dono' || eu?.papel === 'admin' ? [config('cfg-servidor', 'Convites, salas e pessoas', 'servidor', 'Servidor', ['convite', 'admin', 'moderacao'])] : []),
      config('cfg-sobre', 'Sobre e atualizações', 'sobre', 'Sobre', ['versao', 'atualizar', 'update']),
    ];
  };

  const deVolta = async (r: Recebida) => {
    if (!servidor?.cutucar || esperaCutucar(r.de.id) > 0) return;
    await servidor.cutucar(r.de.id, '').then(() => marcarCutucada(r.de.id), () => undefined);
  };
  const salaCutucada = cutucada?.salaId ? salas.find((s) => s.id === cutucada.salaId) : undefined;

  return (
    <>
      {cutucada && (
        <div role="alert" className="absolute inset-x-5 top-[76px] z-30 flex min-h-12 items-center gap-3 border border-texto bg-superficie py-1.5 pr-1.5 pl-3">
          <span className="text-destaque"><Icone nome="volume" tamanho={20} /></span>
          <span className="min-w-0 flex-1 text-[14px]">
            <b>{cutucada.de.nome}</b> te cutucou{cutucada.recado ? <>: “{cutucada.recado}”</> : '.'}
          </span>
          {salaCutucada && salaCutucada.id !== sala && (
            <button type="button" className="btn btn-sm btn-prim" onClick={() => { onSala(salaCutucada.id); setCutucada(null); }}>Entrar na sala {salaCutucada.nome}</button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void deVolta(cutucada)}><Icone nome="cutuca" tamanho={16} />Cutucar de volta</button>
          <button type="button" className="btn btn-sm btn-fant btn-icone" aria-label="Fechar aviso de cutucada" onClick={() => setCutucada(null)}><Icone nome="fechar" tamanho={16} /></button>
        </div>
      )}
      {clipes && <Clipes onFechar={() => setClipes(false)} onReplay={() => void nucleo.replayAlternar()} />}
      {paleta !== null && <Paleta itens={itens()} inicial={paleta} onFechar={() => setPaleta(null)} onConfiguracoes={() => onConfig()} />}
    </>
  );
}
