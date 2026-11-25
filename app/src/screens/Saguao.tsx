import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Faixa } from '../components/Faixa';
import { FaixaCutucada } from '../components/FaixaCutucada';
import { Icone } from '../components/Icone';
import { Topo } from '../components/Topo';
import type { Cutucada } from '../lib/cutucar';
import { desdeQuando, duracaoJogo } from '../lib/jogo';
import type { Pessoa, Sala, Usuario } from '../lib/servidor';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

type Props = {
  nomeServidor: string;
  eu: Usuario;
  salas: Sala[];
  pessoas: Pessoa[];
  cutucada: Cutucada | null;
  onSala(id: string): void;
  onConfig(): void;
  onPerfil(): void;
  onCartao(id: string): void;
  onConvidar(): Promise<void>;
  onFecharCutucada(): void;
};

/** The game most people in the room are playing, if any. */
function jogoDaSala(nela: Pessoa[]) {
  const conta = new Map<string, number>();
  for (const p of nela) if (p.jogo) conta.set(p.jogo, (conta.get(p.jogo) ?? 0) + 1);
  return [...conta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Re-renders once a minute so "jogando CS2 · 40 min" moves on; nothing else ticks. */
function useMinuto() {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

/**
 * Lobby, out of voice (prototype v05, #saguao): the poke strip, rooms with who is there and
 * what they play, then the whole group with the detected game.
 */
export function Saguao(props: Props) {
  const { salas, pessoas, eu, onSala, onCartao } = props;
  const agora = useMinuto();
  const porSala = new Map<string, Pessoa[]>();
  for (const p of pessoas) if (p.online && p.sala && p.id !== eu.id) porSala.set(p.sala, [...(porSala.get(p.sala) ?? []), p]);
  const contagem = (s: Sala) => Math.max(s.pessoas, porSala.get(s.id)?.length ?? 0);
  const sugerida = salas.reduce<Sala | undefined>((m, s) => (!m || contagem(s) > contagem(m) ? s : m), undefined)?.id;
  const emVoz = salas.reduce((n, s) => n + contagem(s), 0);
  const galera = pessoas.filter((p) => p.id !== eu.id)
    .sort((a, b) => Number(b.online) - Number(a.online) || Number(!!b.jogo) - Number(!!a.jogo) || a.nome.localeCompare(b.nome));
  const nomeSala = (id: string | null) => salas.find((s) => s.id === id)?.nome;

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-5 pt-4 pb-5">
      <Topo nomeServidor={props.nomeServidor} salas={salas} sala={null} pessoas={pessoas} eu={eu}
        onSala={onSala} onConfig={props.onConfig} onPerfil={props.onPerfil} />
      <main className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {props.cutucada && (
          <FaixaCutucada cutucada={props.cutucada} silenciado={false} onFechar={props.onFecharCutucada}
            onEntrar={props.cutucada.salaId ? () => onSala(props.cutucada!.salaId!) : undefined} />
        )}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-1">
            <span className="rotulo">/ {props.nomeServidor} · fora da voz</span>
            <h1 className="text-[56px]">Escolha uma sala</h1>
            <p className="m-0 text-texto-fraco">
              {emVoz ? `${plural(emVoz, 'pessoa', 'pessoas')} em voz agora. Entre numa sala para falar, assistir e conversar.` : 'Ninguém em voz agora. Entre numa sala e chame a galera.'}
            </p>
          </div>
          <Convidar podeConvidar={eu.papel === 'dono' || eu.papel === 'admin'} onConvidar={props.onConvidar} />
        </header>

        {salas.length === 0 ? (
          <div className="janela p-5"><b className="font-display text-[28px]">Nenhuma sala ainda</b><p className="m-0 text-texto-fraco">O dono ou um admin cria as salas em Configurações › Servidor › Salas.</p></div>
        ) : (
          <section aria-label="Salas" className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {salas.map((s) => {
              const nela = porSala.get(s.id) ?? [];
              const n = contagem(s);
              const jogo = jogoDaSala(nela);
              return (
                <article key={s.id} aria-label={`Sala ${s.nome}`} className="janela flex flex-col">
                  <div className={`barra ${s.noAr ? 'barra-ar' : ''}`}>
                    <span className="truncate">{s.nome}</span>
                    <span className="ml-auto font-medium">{s.noAr ? `no ar · ${n}` : n ? `${n} na sala` : 'vazia'}</span>
                  </div>
                  {n ? (
                    <>
                      <ul className="m-0 flex list-none flex-wrap gap-1.5 px-3 pt-3 pb-0" aria-label={`Quem está na sala ${s.nome}`}>
                        {nela.slice(0, 8).map((p) => (
                          <li key={p.id}>
                            <button type="button" className="border-0 bg-transparent p-0" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`} title={p.nome}>
                              <Avatar pessoa={p} tamanho={36} />
                            </button>
                          </li>
                        ))}
                        {nela.length > 8 && <li className="self-center text-[13px] text-texto-fraco">+{nela.length - 8}</li>}
                      </ul>
                      <p className="m-0 px-3 pt-2 pb-3 text-[13px] text-texto-fraco">
                        {jogo ? <b className="text-texto">{jogo}</b> : 'só conversa'}{s.noAr && ' · tem tela no ar'}
                      </p>
                    </>
                  ) : (
                    <p className="m-0 min-h-[76px] p-3 text-[13px] text-texto-fraco">Ninguém aqui. Quem entra primeiro abre a conversa.</p>
                  )}
                  <div className="mt-auto px-3 pb-3">
                    <button type="button" className={`btn w-full ${s.id === sugerida ? 'btn-prim' : ''}`} onClick={() => onSala(s.id)}>Entrar na sala {s.nome}</button>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <section aria-label="Galera" className="janela flex shrink-0 flex-col">
          <div className="barra">{props.nomeServidor} · {plural(galera.filter((p) => p.online).length, 'online', 'online')}<span className="ml-auto font-medium">{plural(pessoas.length, 'membro', 'membros')}</span></div>
          {galera.length === 0 ? (
            <p className="m-0 p-4 text-[14px] text-texto-fraco">Só você por aqui. Gere um convite e mande no grupo.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-2 content-start gap-x-6 p-0 px-3 py-1 max-[900px]:grid-cols-1">
              {galera.map((p) => {
                const local = p.online ? (p.sala ? `na sala ${nomeSala(p.sala) ?? ''}` : 'fora da voz') : '—';
                return (
                  <li key={p.id} className="border-b border-borda">
                    <button type="button" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}
                      className={`flex min-h-[52px] w-full items-center gap-2.5 border-0 bg-transparent px-1 text-left text-texto hover:bg-superficie-alta ${p.online ? '' : 'opacity-55'}`}>
                      <Avatar pessoa={p} tamanho={28} />
                      <b className="shrink-0 text-[14px]">{p.nome}</b>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-texto-fraco">
                        {p.online && p.jogo ? (
                          <><span aria-hidden="true" className="mr-1.5 inline-block size-[7px] bg-lima outline outline-1 outline-texto align-[1px]" />jogando {p.jogo} · {duracaoJogo(agora - desdeQuando(p.id, p.jogo, agora))}</>
                        ) : p.online ? 'online' : 'offline'}
                      </span>
                      <span className="rotulo shrink-0">{local}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

/** Invite button for the owner and admins (the porteiro answers 403 to the others). */
function Convidar({ podeConvidar, onConvidar }: { podeConvidar: boolean; onConvidar(): Promise<void> }) {
  const [estado, setEstado] = useState<'' | 'gerando' | 'copiado' | { erro: string }>('');
  if (!podeConvidar) return null;
  async function convidar() {
    setEstado('gerando');
    try {
      await onConvidar();
      setEstado('copiado');
    } catch (e) {
      setEstado({ erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="flex items-center gap-3">
        {estado === 'copiado' && <span role="status" className="text-[14px] text-texto-fraco">Link copiado.</span>}
        <button type="button" className="btn" disabled={estado === 'gerando'} onClick={() => void convidar()}><Icone nome="link" />{estado === 'gerando' ? 'Gerando…' : 'Convidar'}</button>
      </span>
      {typeof estado === 'object' && (
        <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: () => void convidar() }]} onFechar={() => setEstado('')}>Não deu para gerar o convite. {estado.erro}</Faixa>
      )}
    </div>
  );
}
