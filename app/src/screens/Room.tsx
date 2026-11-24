import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Avatar } from '../components/Avatar';
import { Icone } from '../components/Icone';
import { useInterfaceAtiva } from '../lib/leveza';
import { demoScreen } from '../lib/config';
import type { Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { useTema } from '../lib/tema';
import type { Attachable, ChatMessage, Person, RoomActions, RoomModel, Stream } from '../room/model';
import { useDemoRoom } from '../room/demo';
import { useLiveRoom } from '../room/useLiveRoom';
import { GoLive } from './GoLive';

export type RoomProps = {
  servidor: Servidor;
  nomeServidor: string;
  eu: Usuario;
  salas: Sala[];
  pessoas: Pessoa[];
  sala: string | null;
  demo: boolean;
  onSala(id: string | null): void;
  onConfig(): void;
  onPerfil(): void;
  onCartao(id: string): void;
  onConvidar(): Promise<void>;
  onAmigo(id: string, sim: boolean): void;
};

type ComSala = Omit<RoomProps, 'sala'> & { sala: Sala };

/** Top bar, then either the lobby (not in voice) or the live room. */
export function RoomScreen(props: RoomProps) {
  const ativa = props.salas.find((s) => s.id === props.sala);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-5 pt-4 pb-5">
      <Topo {...props} />
      {ativa ? (
        props.demo ? <DemoRoom key={ativa.id} {...props} sala={ativa} /> : <LiveRoom key={ativa.id} {...props} sala={ativa} />
      ) : (
        <Saguao {...props} />
      )}
    </div>
  );
}

function LiveRoom(props: ComSala) {
  const [tentativa, setTentativa] = useState(0);
  const session = useMemo(() => ({ servidor: props.servidor }), [props.servidor, tentativa]);
  const model = useLiveRoom(session, props.sala.id);
  return <RoomView {...props} model={model} onRetry={() => setTentativa((n) => n + 1)} />;
}

function DemoRoom(props: ComSala) {
  const model = useDemoRoom(props.sala.id, { id: props.eu.id, name: props.eu.nome });
  return <RoomView {...props} model={model} onRetry={() => undefined} />;
}

const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const qualidadePing = (ms: number) => (ms <= 150 ? 'bom' : ms <= 250 ? 'ok' : 'alto');

function Topo({ nomeServidor, salas, sala, pessoas, onSala, onConfig, onPerfil, eu }: RoomProps) {
  const [tema, setTema] = useTema();
  const online = pessoas.filter((p) => p.online).length;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-3">
      <div className="janela flex h-[52px] items-center gap-3 pr-1 pl-3">
        <span className="font-display text-[26px] leading-none">stack<span className="text-destaque">call</span></span>
        <span aria-hidden="true" className="h-[26px] w-px bg-texto" />
        <button type="button" onClick={onConfig} className="flex h-11 flex-col items-start justify-center border-0 bg-transparent px-2 text-left leading-[1.15] hover:bg-superficie-alta"
          aria-label={`Servidor ${nomeServidor}, ${pessoas.length} membros. Abrir configurações do servidor`}>
          <b className="text-[14px]">{nomeServidor}</b>
          <span className="rotulo text-[10px]">{pessoas.length} membros · {online} online</span>
        </button>
      </div>

      <nav aria-label="Salas" className="janela flex min-w-0 flex-wrap">
        {salas.map((r, i) => {
          const ativa = r.id === sala;
          const ponto = r.noAr ? 'bg-destaque' : r.pessoas > 0 ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda';
          const dica = r.noAr ? 'alguém no ar' : r.pessoas > 0 ? 'tem gente' : 'vazia';
          return (
            <button key={r.id} type="button" aria-current={ativa ? 'true' : undefined} onClick={() => onSala(r.id)}
              aria-label={`Sala ${r.nome}, ${r.pessoas} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}, ${dica}${ativa ? ', você está aqui' : ''}`}
              className={`flex h-[50px] min-w-[112px] flex-col items-start justify-center gap-px border-0 px-3 text-left [&+&]:border-l [&+&]:border-texto ${ativa ? 'bg-texto text-superficie' : 'bg-transparent hover:bg-superficie-alta'}`}>
              <span className="flex w-full items-center gap-2">
                <span className={`rotulo text-[10px] ${ativa ? 'text-superficie opacity-70' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                <span aria-hidden="true" title={dica} className={`ml-auto inline-block size-2 ${ponto}`} />
              </span>
              <span className="flex items-baseline gap-1.5">
                <b className="text-[14px]">{r.nome}</b>
                <span className="tabular-nums text-[12px] opacity-70">{r.pessoas}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2.5">
        <PingJanela />
        <div className="abas" role="group" aria-label="Tema">
          <button type="button" aria-pressed={tema === 'claro'} onClick={() => setTema('claro')}>Claro</button>
          <button type="button" aria-pressed={tema === 'escuro'} onClick={() => setTema('escuro')}>Escuro</button>
        </div>
        <button type="button" className="btn btn-icone" aria-label="Configurações" title="Configurações" onClick={onConfig}><Icone nome="ajustes" /></button>
        <button type="button" className="border-0 bg-transparent p-0" aria-label="Seu perfil" title="Seu perfil" onClick={onPerfil}>
          <Avatar pessoa={eu} tamanho={44} />
        </button>
      </div>
    </header>
  );
}

/** The ping lives in the room model; outside a room the top bar shows a dash. */
let pingAtual: number | null = null;
const ouvintesPing = new Set<(v: number | null) => void>();
function publicarPing(v: number | null) {
  pingAtual = v;
  ouvintesPing.forEach((f) => f(v));
}
function PingJanela() {
  const [ping, setPing] = useState(pingAtual);
  useEffect(() => {
    ouvintesPing.add(setPing);
    return () => void ouvintesPing.delete(setPing);
  }, []);
  const rotulo = ping === null ? 'Ping ainda não medido' : `Ping ${ping} milissegundos, ${qualidadePing(ping)}`;
  return (
    <div className="janela flex h-[52px] min-w-[116px] flex-col" role="status" aria-label={rotulo}>
      <span className="barra barra-lima min-h-[18px] px-2 text-[10px]">Ping<span className="ml-auto font-medium">{ping === null ? '—' : qualidadePing(ping)}</span></span>
      <span className="flex flex-1 items-center gap-1 px-2.5 whitespace-nowrap">
        <b className="font-display tabular-nums text-[22px] leading-none">{ping ?? '—'}</b>
        <span className="rotulo text-[10px]">ms</span>
      </span>
    </div>
  );
}

function Saguao({ nomeServidor, salas, onSala, pessoas }: RoomProps) {
  return (
    <main className="flex min-h-0 flex-col gap-5 overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        <span className="rotulo">/ {nomeServidor} · fora da voz</span>
        <h1 className="text-[64px]">Escolha uma sala</h1>
        <p className="m-0 text-texto-fraco">Você não está em nenhuma sala. Entre numa para falar, assistir e conversar.</p>
      </div>
      {salas.length === 0 ? (
        <Vazio titulo="Nenhuma sala ainda" texto="O dono ou um admin cria as salas em Configurações > Servidor." />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 p-0">
          {salas.map((s) => {
            const nela = pessoas.filter((p) => p.sala === s.id);
            return (
              <li key={s.id} className="janela flex flex-col">
                <div className={`barra ${s.noAr ? 'barra-ar' : ''}`}>{s.nome}<span className="ml-auto font-medium">{s.noAr ? 'no ar' : `${s.pessoas} na sala`}</span></div>
                <div className="flex flex-1 flex-col gap-3 p-3.5">
                  <div className="flex min-h-11 items-center gap-1.5">
                    {nela.length === 0 && <span className="text-[14px] text-texto-fraco">Vazia agora.</span>}
                    {nela.slice(0, 6).map((p) => <Avatar key={p.id} pessoa={p} tamanho={36} />)}
                  </div>
                  <button type="button" className="btn btn-prim" onClick={() => onSala(s.id)}>Entrar na sala {s.nome}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function RoomView(props: ComSala & { model: RoomModel & RoomActions; onRetry(): void }) {
  const { model, sala, nomeServidor, salas, pessoas, eu, demo, onSala, onCartao, onConvidar } = props;
  const [goLive, setGoLive] = useState(() => demo && demoScreen() === 'ar');
  const [fallback, setFallback] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [convite, setConvite] = useState<'' | 'gerando' | 'copiado' | string>('');
  const me = model.people.find((p) => p.isLocal);
  const imLive = !!me?.live;
  const stage = model.streams.find((s) => s.owner.id === stageId) ?? model.streams[0];
  const others = model.people.filter((p) => !p.isLocal);
  const porId = new Map(pessoas.map((p) => [p.id, p] as const));
  const numero = String(salas.findIndex((s) => s.id === sala.id) + 1).padStart(2, '0');
  const linha = [`${model.people.length} na sala`, stage && `${stage.owner.isLocal ? 'você' : stage.owner.name} transmitindo`].filter(Boolean).join(' · ');

  useEffect(() => publicarPing(model.ping), [model.ping]);
  useEffect(() => () => publicarPing(null), []);

  async function convidar() {
    setConvite('gerando');
    try {
      await onConvidar();
      setConvite('copiado');
    } catch (e) {
      setConvite(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
        <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="rotulo">/ {nomeServidor} · sala {numero}</span>
                <h1 className="truncate text-[64px]">{sala.nome}</h1>
              </div>
              <span className="pb-2 text-[14px] text-texto-fraco">{linha}</span>
              <div className="ml-auto flex items-center gap-2 pb-1">
                {convite && convite !== 'gerando' && (
                  <span role="status" className={`text-[13px] ${convite === 'copiado' ? 'text-texto-fraco' : 'text-perigo'}`}>
                    {convite === 'copiado' ? 'Link copiado. Vale 7 dias, 1 uso.' : convite}
                  </span>
                )}
                <button type="button" className="btn" disabled={convite === 'gerando'} onClick={() => void convidar()}>
                  <Icone nome="link" />{convite === 'gerando' ? 'Gerando…' : 'Convidar'}
                </button>
              </div>
            </div>
            <Palco model={model} stage={stage} onPick={setStageId} onGoLive={() => setGoLive(true)} onRetry={props.onRetry} />
          </section>
          <Lateral sala={sala.nome} model={model} pessoas={pessoas} eu={eu} onCartao={onCartao} onAmigo={props.onAmigo} />
        </main>

        <footer className="grid min-w-0 grid-cols-[340px_minmax(0,1fr)] gap-4">
          <Voce model={model} nome={eu.nome} sala={sala.nome} imLive={imLive}
            onGoLive={() => setGoLive(true)} onSair={() => onSala(null)} onFallback={() => { model.clearStreamError?.(); setFallback(true); setGoLive(true); }} />
          <ul aria-label="Pessoas na sala" className="m-0 flex min-w-0 list-none gap-3 overflow-x-auto p-0 pb-1">
            {others.map((p) => (
              <Canal key={p.id} person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)} />
            ))}
            <li className="flex min-w-[140px] flex-1 items-center justify-center border border-dashed border-texto bg-superficie px-3 text-center text-[13px] text-texto-fraco">
              {others.length === 0 ? 'Só você por aqui. Chame alguém com o link de convite.' : 'Canal livre para mais um'}
            </li>
          </ul>
        </footer>
      </div>

      {goLive && (
        <GoLive
          demo={demo}
          fallback={fallback}
          server={props.servidor.url}
          roomLabel={sala.nome}
          viewers={Math.max(0, model.people.length - 1)}
          onCancel={() => { setGoLive(false); setFallback(false); }}
          onStart={async (track, preset, codec) => {
            await model.goLive(track, preset, codec);
            setGoLive(false);
            setFallback(false);
          }}
          onNativeStart={model.goLiveNative && (async (...args) => {
            await model.goLiveNative!(...args);
            setGoLive(false);
          })}
        />
      )}
    </>
  );
}

export function TrackVideo({ track, className, muted = true }: { track?: Attachable; className?: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const ativa = useInterfaceAtiva();
  // Detached while nobody sees the window: the decoder stops drawing (leveza).
  useEffect(() => {
    const el = ref.current;
    if (!track || !el || !ativa) return;
    track.attach(el);
    return () => void track.detach(el);
  }, [track, ativa]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

async function toggleFullscreen(el: HTMLElement) {
  const on = !document.fullscreenElement;
  if (on) await el.requestFullscreen().catch(() => undefined);
  else await document.exitFullscreen().catch(() => undefined);
  // WebView2 fullscreens the element only inside the window; make the window follow.
  if (isTauri()) await getCurrentWindow().setFullscreen(on).catch(() => undefined);
}

function Palco({ model, stage, onPick, onGoLive, onRetry }: {
  model: RoomModel & RoomActions; stage?: Stream; onPick(id: string): void; onGoLive(): void; onRetry(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement && isTauri()) void getCurrentWindow().setFullscreen(false).catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  if (model.state === 'error') {
    return (
      <div className="janela flex min-h-0 flex-1 flex-col">
        <div className="barra">Palco<span className="ml-auto font-medium">sem conexão</span></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="m-0 max-w-[480px] text-perigo">{model.error}</p>
          <button type="button" className="btn" onClick={onRetry}>Tentar de novo</button>
        </div>
      </div>
    );
  }
  if (model.state === 'connecting') {
    return (
      <div className="janela flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className="barra">Palco<span className="ml-auto font-medium">conectando</span></div>
        <div className="skeleton m-4 flex-1" />
      </div>
    );
  }
  if (!stage) {
    return (
      <div className="janela flex min-h-0 flex-1 flex-col">
        <div className="barra">Palco<span className="ml-auto font-medium">livre</span></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <b className="font-display text-[40px]">Ninguém no ar</b>
          <span className="text-texto-fraco">O palco está livre. Mostra o teu jogo pra galera.</span>
          <button type="button" className="btn btn-prim btn-lg" disabled={model.state !== 'connected'} onClick={onGoLive}>
            <Icone nome="tela" />Transmitir
          </button>
        </div>
      </div>
    );
  }
  const nome = stage.owner.isLocal ? 'Você' : stage.owner.name;
  const s = model.stageStats;
  const numeros = stage.owner.isLocal || !s
    ? stage.info
    : [`${s.height}p${s.fps}`, s.codec, s.mbps !== null && `${fmt(s.mbps)} Mb/s`].filter(Boolean).join(' · ');
  return (
    <div ref={ref} className="janela flex min-h-0 flex-1 flex-col">
      <div className="barra barra-ar">
        <span aria-hidden="true" className="size-[7px] bg-sobre-destaque" />No ar · {nome}
        <span className="ml-auto truncate font-medium">{[numeros, `${stage.watchers} assistindo`].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-palco">
        {stage.track ? (
          <TrackVideo track={stage.track} className="absolute inset-0 size-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="font-pincel -rotate-6 text-[40px] text-lima">ao vivo!</span>
            <span className="text-[13px] text-[#b3b3ab]">Tela de {nome}. Assistir gasta internet só de quem assiste.</span>
            {!stage.watching && (
              <button type="button" className="btn btn-prim btn-lg" onClick={() => model.watch(stage.owner.id)}>Assistir</button>
            )}
          </div>
        )}
        <div className="absolute right-3 bottom-3 flex flex-wrap justify-end gap-2">
          {model.streams.length > 1 && model.streams.map((x) => (
            <button key={x.owner.id} type="button" onClick={() => onPick(x.owner.id)} aria-pressed={x === stage} className={`btn ${x === stage ? 'bg-texto text-superficie' : ''}`}>
              {x.owner.isLocal ? 'Você' : x.owner.name}
            </button>
          ))}
          {stage.watching && !stage.owner.isLocal && (
            <button type="button" className="btn" onClick={() => model.unwatch(stage.owner.id)}>Parar de assistir</button>
          )}
          {stage.track && (
            <button type="button" className="btn btn-icone" aria-label="Tela cheia" title="Tela cheia" onClick={() => ref.current && void toggleFullscreen(ref.current)}>
              <Icone nome="cheia" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Voce({ model, nome, sala, imLive, onGoLive, onSair, onFallback }: {
  model: RoomModel & RoomActions; nome: string; sala: string; imLive: boolean; onGoLive(): void; onSair(): void; onFallback(): void;
}) {
  const estado = { connecting: 'conectando…', connected: `na voz · ${sala}`, reconnecting: 'reconectando…', error: 'fora da voz' }[model.state];
  return (
    <div className="janela flex flex-col">
      <div className="barra">
        Você · {nome}
        <span className="ml-auto inline-flex items-center gap-1.5 font-medium" role="status">
          <span aria-hidden="true" className={`size-[7px] ${model.state === 'connected' ? 'bg-lima' : 'bg-superficie-topo'}`} />{estado}
        </span>
      </div>
      <div className="flex items-center gap-2 p-3">
        <button type="button" className={`btn btn-lg btn-icone ${model.micOn ? '' : 'btn-off'}`} aria-pressed={!model.micOn}
          aria-label={model.micOn ? 'Desligar microfone' : 'Ligar microfone'} title={model.micOn ? 'Microfone ligado' : 'Microfone desligado'} onClick={model.toggleMic}>
          <Icone nome={model.micOn ? 'mic' : 'mic-off'} tamanho={20} />
        </button>
        <button type="button" className={`btn btn-lg btn-icone ${model.deafened ? 'btn-off' : ''}`} aria-pressed={model.deafened}
          aria-label={model.deafened ? 'Ligar o som' : 'Silenciar tudo'} title={model.deafened ? 'Som desligado' : 'Silenciar tudo'} onClick={model.toggleDeafen}>
          <Icone nome={model.deafened ? 'fone-off' : 'fone'} tamanho={20} />
        </button>
        {imLive ? (
          <button type="button" className="btn btn-lg flex-1" onClick={model.stopLive}><Icone nome="tela" />Sair do ar</button>
        ) : (
          <button type="button" className="btn btn-lg btn-prim flex-1" disabled={model.state !== 'connected'} onClick={onGoLive}><Icone nome="tela" />Transmitir</button>
        )}
        <button type="button" className="btn btn-lg btn-icone text-perigo" aria-label="Sair da sala" title="Sair da sala" onClick={onSair}>
          <Icone nome="sair" tamanho={20} />
        </button>
      </div>
      {(model.micError || model.streamError) && (
        <div role="alert" className="flex flex-col gap-2 border-t border-texto px-3 py-2 text-[13px] text-perigo">
          {model.micError && <span>{model.micError}</span>}
          {model.streamError && (
            <>
              <span>{model.streamError}</span>
              <button type="button" className="btn self-start" disabled={model.state !== 'connected'} onClick={onFallback}>Transmitir pelo modo de reserva</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Medidor({ level, ativo }: { level: number; ativo: boolean }) {
  const lit = ativo ? Math.round(level * 8) : 0;
  return (
    <span aria-hidden="true" className="flex h-14 w-2.5 flex-col-reverse gap-0.5">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className={`flex-1 ${i < lit ? (i === 7 ? 'bg-destaque' : 'bg-lima outline outline-1 -outline-offset-1 outline-texto') : 'bg-superficie-topo'}`} />
      ))}
    </span>
  );
}

const TEMA_CLASSE = { papel: '', noite: 'tema-noite', lima: 'tema-lima' } as const;

function Canal({ person, perfil, onVolume, onCartao }: { person: Person; perfil?: Pessoa; onVolume(v: number): void; onCartao(): void }) {
  const ativa = useInterfaceAtiva();
  const pct = Math.round(person.volume * 100);
  const status = person.speaking ? 'falando' : person.muted ? 'mic desligado' : 'ouvindo';
  return (
    <li className={`janela flex w-[184px] shrink-0 flex-col ${perfil ? TEMA_CLASSE[perfil.tema] : ''}`}>
      <div className={`barra ${person.live ? 'barra-ar' : ''}`}>
        <span className="truncate">{person.name}</span>{person.live && <span className="ml-auto font-medium">no ar</span>}
      </div>
      <div className="flex items-end gap-2.5 px-3 pt-2.5 pb-2">
        <button type="button" className="border-0 bg-transparent p-0" aria-label={`Ver perfil de ${person.name}`} onClick={onCartao}>
          <Avatar pessoa={{ nome: person.name, avatar: perfil?.avatar ?? null }} tamanho={56} />
        </button>
        <Medidor level={person.level} ativo={ativa} />
        <span className={`ml-auto self-start text-right text-[12px] leading-tight font-bold ${person.muted ? 'text-perigo' : person.speaking ? 'text-texto' : 'text-texto-fraco'}`}>{status}</span>
      </div>
      <div className="flex items-center gap-2 px-3 pb-3">
        <Slider.Root className="relative flex h-11 flex-1 touch-none items-center select-none" min={0} max={200} step={5}
          value={[pct]} onValueChange={([v]) => onVolume(v / 100)}>
          <Slider.Track className="relative h-1 grow bg-superficie-topo">
            <Slider.Range className="absolute h-full bg-texto" />
          </Slider.Track>
          <Slider.Thumb aria-label={`Volume de ${person.name}`} aria-valuetext={`${pct}%`} className="block h-4 w-3 border border-texto bg-superficie" />
        </Slider.Root>
        <span className="rotulo tabular-nums w-9 text-right text-[10px]">{pct}%</span>
      </div>
    </li>
  );
}

function Lateral({ sala, model, pessoas, eu, onCartao, onAmigo }: {
  sala: string; model: RoomModel & RoomActions; pessoas: Pessoa[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void;
}) {
  const [aba, setAba] = useState<'conversa' | 'pessoas'>('conversa');
  return (
    <aside className="janela flex min-h-0 flex-col" aria-label={aba === 'conversa' ? 'Conversa da sala' : 'Pessoas do servidor'}>
      <div className="flex border-b border-texto" role="tablist" aria-label="Painel lateral">
        {(['conversa', 'pessoas'] as const).map((a) => (
          <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`min-h-11 flex-1 border-0 font-mono text-[11px] font-bold tracking-[0.04em] uppercase [&+&]:border-l [&+&]:border-texto ${aba === a ? 'bg-texto text-superficie' : 'bg-transparent text-texto-fraco hover:bg-superficie-alta'}`}>
            {a === 'conversa' ? `Conversa · ${sala}` : `Pessoas · ${pessoas.filter((p) => p.online).length} on`}
          </button>
        ))}
      </div>
      {aba === 'conversa' ? <Conversa sala={sala} chat={model.chat} onSend={model.sendChat} /> : <Pessoas pessoas={pessoas} eu={eu} onCartao={onCartao} onAmigo={onAmigo} />}
    </aside>
  );
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Conversa({ sala, chat, onSend }: { sala: string; chat: ChatMessage[]; onSend(text: string): void }) {
  const [text, setText] = useState('');
  const lista = useRef<HTMLDivElement>(null);
  // Virtualized: only the visible messages are in the DOM (leveza).
  const v = useVirtualizer({ count: chat.length, getScrollElement: () => lista.current, estimateSize: () => 64, overscan: 6, initialRect: { width: 340, height: 600 } });
  useEffect(() => {
    if (chat.length) v.scrollToIndex(chat.length - 1, { align: 'end' });
  }, [chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(text);
    setText('');
  };
  return (
    <>
      <div ref={lista} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" aria-live="polite" role="log" aria-label="Mensagens">
        {chat.length === 0 ? (
          <p className="m-0 flex h-full items-end text-texto-fraco">Sala quieta. Manda um oi.</p>
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((item) => {
              const m = chat[item.index];
              return (
                <div key={m.id} data-index={item.index} ref={v.measureElement} className="absolute left-0 grid w-full grid-cols-[30px_minmax(0,1fr)] gap-2.5 pb-3.5"
                  style={{ transform: `translateY(${item.start}px)` }}>
                  <Avatar pessoa={{ nome: m.who, avatar: null }} tamanho={30} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2"><b className="text-[14px]">{m.who}</b><span className="rotulo text-[10px]">{hhmm(m.at)}</span></span>
                    <span className="text-[14px] leading-[1.45] break-words">{m.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="mx-3.5 mb-3.5 flex min-h-11 items-center gap-2 rounded-[2px] border border-texto bg-superficie py-1 pr-1 pl-3 focus-within:outline-2 focus-within:outline-destaque">
        <label htmlFor="msg" className="sr-only">Mensagem</label>
        <input id="msg" className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none" placeholder={`Mensagem para ${sala}`}
          value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn btn-prim btn-icone min-h-9 w-9" aria-label="Enviar"><Icone nome="enviar" tamanho={16} /></button>
      </form>
    </>
  );
}

function Pessoas({ pessoas, eu, onCartao, onAmigo }: { pessoas: Pessoa[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void }) {
  const outras = pessoas.filter((p) => p.id !== eu.id);
  const grupos: [string, Pessoa[]][] = [
    ['Amigos', outras.filter((p) => p.amigo)],
    ['Outros no servidor', outras.filter((p) => !p.amigo)],
  ];
  if (outras.length === 0) return <Vazio titulo="Só você aqui" texto="Gere um convite e mande para a galera." />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {grupos.map(([titulo, lista]) => (
        <section key={titulo}>
          <h3 className="rotulo m-0 border-b border-borda px-3.5 py-2">{titulo} · {lista.length}</h3>
          {lista.length === 0 && <p className="m-0 px-3.5 py-2 text-[13px] text-texto-fraco">{titulo === 'Amigos' ? 'Adicione amigos para vê-los aqui em cima.' : 'Todo mundo já é seu amigo.'}</p>}
          <ul className="m-0 list-none p-0">
            {[...lista].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-1.5">
                <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                  <Avatar pessoa={p} tamanho={32} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <b className="truncate text-[14px]">{p.nome}</b>
                    <span className="rotulo inline-flex items-center gap-1.5 text-[10px]">
                      <span aria-hidden="true" className={`size-1.5 ${p.online ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda'}`} />
                      {p.online ? (p.sala ? 'online · numa sala' : 'online') : 'offline'}
                    </span>
                  </span>
                </button>
                <button type="button" className="btn btn-fant btn-icone" aria-label={p.amigo ? `Remover ${p.nome} dos amigos` : `Adicionar ${p.nome} aos amigos`}
                  title={p.amigo ? 'Remover amigo' : 'Adicionar amigo'} onClick={() => onAmigo(p.id, !p.amigo)}>
                  <Icone nome={p.amigo ? 'amigo-off' : 'amigo'} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Vazio({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <b className="font-display text-[28px]">{titulo}</b>
      <span className="max-w-[44ch] text-[14px] text-texto-fraco">{texto}</span>
      {children}
    </div>
  );
}
