import { useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Avatar } from '../../components/Avatar';
import { Icone, type NomeIcone } from '../../components/Icone';
import type { Pessoa, Sala, Usuario } from '../../lib/servidor';
import type { Person } from '../../room/model';
import { opcoesMenuPessoa } from '../../room/sala05';
import { navegarMenu, Popover, type Ancora } from './Popover';

export type AcoesMenuPessoa = {
  onVolume(v: number): void;
  onPerfil(): void;
  onAssistir(): void;
  onCutucar(): void;
  onSilenciarParaMim(): void;
  onMover(destinoId: string): void;
  onTirar(): void;
};

/**
 * Right click (or the menu key) on a person: volume, profile, watch, poke, silence for me and, for
 * the owner and admins, moderation below a strong line with the role label. "Tirar da sala…" confirms.
 */
export function MenuPessoa({ ancora, person, perfil, eu, salas, salaAtual, esperaCutucar, silenciadoParaMim, onFechar, ...a }: AcoesMenuPessoa & {
  ancora: Ancora; person: Person; perfil?: Pessoa; eu: Usuario; salas: Sala[]; salaAtual: string; esperaCutucar: number; silenciadoParaMim: boolean; onFechar(): void;
}) {
  const [sub, setSub] = useState<'mover' | 'tirar' | null>(null);
  const opcoes = opcoesMenuPessoa({ meuPapel: eu.papel, papelDela: perfil?.papel, noAr: person.live });
  const pct = Math.round(person.volume * 100);
  const rede = person.rede;
  const cab = [perfil?.jogo, rede?.ms !== undefined && `${rede.ms} ms`, rede?.perda !== undefined && `${Math.round(rede.perda * 100)}% perda`].filter(Boolean).join(' · ');
  const fazer = (f: () => void) => () => {
    f();
    onFechar();
  };
  const item = (icone: NomeIcone, texto: string, onClick: () => void, extra?: { dica?: string; perigo?: boolean; desligado?: boolean; temSub?: boolean }) => (
    <button type="button" role="menuitem" aria-label={texto} aria-disabled={extra?.desligado || undefined} aria-haspopup={extra?.temSub || undefined}
      onClick={extra?.desligado ? undefined : onClick}
      className={`flex h-[34px] w-full items-center gap-2.5 border-0 bg-transparent px-3 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none
        ${extra?.perigo ? 'font-bold text-perigo' : ''} ${extra?.desligado ? 'cursor-not-allowed text-texto-fraco hover:bg-transparent hover:text-texto-fraco' : ''}`}>
      <Icone nome={icone} tamanho={16} />{texto}
      {extra?.dica && <span className="rotulo ml-auto text-[11px] normal-case">{extra.dica}</span>}
      {extra?.temSub && <span className="ml-auto"><Icone nome="dir" tamanho={14} /></span>}
    </button>
  );

  return (
    <Popover ancora={ancora} onFechar={onFechar} rotulo={person.name} role="menu" className="w-[268px] pb-1">
      <div onKeyDown={navegarMenu}>
        <div className="flex items-center gap-2.5 border-b border-texto bg-superficie-alta px-3 py-2.5">
          <Avatar pessoa={{ nome: person.name, avatar: perfil?.avatar ?? null }} tamanho={40} />
          <span className="flex min-w-0 flex-col">
            <b className="truncate text-[15px]">{person.name}</b>
            {cab && <span className="rotulo text-[11px]">{cab}</span>}
          </span>
        </div>
        {opcoes.includes('volume') && (
          <div className="flex items-center gap-2.5 border-b border-borda px-3 py-2.5">
            <Icone nome="volume" tamanho={16} />
            <Slider.Root className="relative flex h-6 flex-1 touch-none items-center select-none" min={0} max={200} step={5}
              value={[pct]} onValueChange={([v]) => a.onVolume(v / 100)}>
              <Slider.Track className="relative h-1 grow bg-superficie-topo"><Slider.Range className="absolute h-full bg-texto" /></Slider.Track>
              <Slider.Thumb aria-label={`Volume de ${person.name}`} aria-valuetext={`${pct}%`} className="block h-4 w-3 border border-texto bg-superficie" />
            </Slider.Root>
            <span className="w-10 text-right font-mono text-[12px] tabular-nums">{pct}%</span>
          </div>
        )}
        {item('pessoa', 'Ver perfil', fazer(a.onPerfil))}
        {opcoes.includes('assistir') && item('tela', 'Assistir tela', fazer(a.onAssistir), { dica: 'clique duplo' })}
        {item('cutuca', esperaCutucar > 0 ? `Cutucar… em ${esperaCutucar} s` : 'Cutucar…', a.onCutucar, { dica: 'voz alta', desligado: esperaCutucar > 0 })}
        {item('mudo', silenciadoParaMim ? 'Ouvir de novo' : 'Silenciar para mim', fazer(a.onSilenciarParaMim))}
        {opcoes.includes('mover') && (
          <>
            <div className="mt-1 flex items-center gap-2 border-t border-texto px-3 pt-2 pb-1.5 font-mono text-[11px] font-bold tracking-[0.05em] text-texto-fraco uppercase">
              <Icone nome="escudo" tamanho={14} />Moderação · você é {eu.papel}
            </div>
            <div className="relative">
            {item('mover', 'Mover para', () => setSub(sub === 'mover' ? null : 'mover'), { temSub: true })}
            {sub === 'mover' && (
              <div role="group" aria-label="Mover para" className={`janela absolute top-0 z-10 w-[190px] py-1 ${ancora.x > innerWidth / 2 ? 'right-full -mr-px' : 'left-full -ml-px'}`}>
                {salas.filter((s) => s.id !== salaAtual).map((s) => (
                  <button key={s.id} type="button" role="menuitem" onClick={fazer(() => a.onMover(s.id))}
                    className="flex h-8 w-full items-center border-0 bg-transparent px-2.5 text-left text-[14px] hover:bg-texto hover:text-superficie focus-visible:bg-texto focus-visible:text-superficie focus-visible:outline-none">
                    {s.nome}<span className="rotulo ml-auto text-[11px]">{s.pessoas ? s.pessoas : 'vazia'}</span>
                  </button>
                ))}
              </div>
            )}
            </div>
            {sub === 'tirar' ? (
              <div role="alertdialog" aria-label={`Tirar ${person.name} da sala`} className="mx-2 my-1 flex flex-col gap-2 border border-perigo p-2.5">
                <span className="text-[13px]">Tirar <b>{person.name}</b> da sala? A pessoa continua no grupo e pode voltar.</span>
                <span className="flex gap-2">
                  <button type="button" role="menuitem" className="btn btn-sm border-perigo text-perigo" onClick={fazer(a.onTirar)}>Tirar da sala</button>
                  <button type="button" role="menuitem" className="btn btn-sm" onClick={() => setSub(null)}>Cancelar</button>
                </span>
              </div>
            ) : item('sair', 'Tirar da sala…', () => setSub('tirar'), { perigo: true })}
          </>
        )}
      </div>
    </Popover>
  );
}
