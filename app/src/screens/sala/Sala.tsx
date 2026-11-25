import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Avatar } from '../../components/Avatar';
import { Faixa } from '../../components/Faixa';
import { Icone } from '../../components/Icone';
import { useInterfaceAtiva } from '../../lib/leveza';
import { demoScreen } from '../../lib/config';
import type { Pessoa, Sala, Usuario } from '../../lib/servidor';
import type { Attachable, ChatMessage, Person, RoomActions, RoomModel, Stream } from '../../room/model';
import { RECUO_MS } from '../../room/reconexao';
import { GoLive } from '../GoLive';
import { ACOES, aoAtalho, aoMudarAtalhos, bipe, criarControleVoz, lerAtalhos, type AcaoId } from '../../lib/atalhos';
import type { ComSala } from '../Room';

/**
 * The room (0.5 interface, docs/design/v05-interface.md section 4). Moved out of Room.tsx so the
 * lobby (another thread) and the room can change without touching the same file.
 */
export type Reconexao = { falhas: number; esgotou: boolean };

const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const qualidadePing = (ms: number) => (ms <= 150 ? 'bom' : ms <= 250 ? 'ok' : 'alto');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function RoomView(props: ComSala & { model: RoomModel & RoomActions; reconexao: Reconexao; onRetry(): void }) {
  const { model, sala, salas, pessoas, eu, demo, onSala, onCartao, onConvidar } = props;
  const [goLive, setGoLive] = useState(() => demo && demoScreen() === 'ar');
  const [fallback, setFallback] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [convite, setConvite] = useState<'' | 'gerando' | 'copiado' | { erro: string }>('');
  const [confirmarAr, setConfirmarAr] = useState(0);
  const me = model.people.find((p) => p.isLocal);
  const imLive = !!me?.live;
  const stage = model.streams.find((s) => s.owner.id === stageId) ?? model.streams[0];
  const others = model.people.filter((p) => !p.isLocal);
  const porId = new Map(pessoas.map((p) => [p.id, p] as const));
  const conectada = model.state === 'connected';
  const linha = stage ? `${stage.owner.isLocal ? 'você' : stage.owner.name} no ar` : 'ninguém no ar';

  // Keyboard: M mic, S sound, T transmit (app in focus). Never while typing or with a dialog open.
  // The same voice actions answer the global shortcuts (lib/atalhos), which beep because the game hides the app.
  const atual = useRef({ model, conectada, imLive, goLive, stage });
  atual.current = { model, conectada, imLive, goLive, stage };
  const voz = useMemo(() => criarControleVoz({
    micAberto: () => atual.current.model.micOn,
    abrirMic: (on) => (atual.current.model.setMic ? atual.current.model.setMic(on) : on !== atual.current.model.micOn && atual.current.model.toggleMic()),
    silenciado: () => atual.current.model.deafened,
    alternarSilencio: () => atual.current.model.toggleDeafen(),
  }), []);
  useEffect(() => () => voz.parar(), [voz]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (alvo?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"]')) return;
      const a = atual.current;
      const k = e.key.toLowerCase();
      if (k === 'm') voz.executar('mic', 'pressionado', false);
      else if (k === 's') voz.executar('silenciar', 'pressionado', false);
      else if (k === 't' && a.conectada && !a.imLive && !a.goLive) setGoLive(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', tecla);
    const parar = aoAtalho((id: AcaoId, estado) => {
      if (voz.executar(id, estado) || estado !== 'pressionado') return;
      const a = atual.current;
      const tela = a.stage && !a.stage.owner.isLocal ? a.stage : undefined;
      if (id === 'arEntrar' && a.conectada && !a.imLive) {
        // First press opens with the last choice; a second press while open confirms it.
        if (a.goLive) setConfirmarAr((n) => n + 1);
        else setGoLive(true);
        bipe('liga');
      } else if (id === 'arSair' && a.imLive) {
        a.model.stopLive();
        bipe('desliga');
      } else if (id === 'assistir' && tela && !tela.watching) {
        a.model.watch(tela.owner.id);
        bipe('liga');
      } else if (id === 'pararAssistir' && tela?.watching) {
        a.model.unwatch(tela.owner.id);
        bipe('desliga');
      }
    });
    return () => {
      window.removeEventListener('keydown', tecla);
      parar();
    };
  }, [voz]);

  async function convidar() {
    setConvite('gerando');
    try {
      await onConvidar();
      setConvite('copiado');
    } catch (e) {
      setConvite({ erro: e instanceof Error ? e.message : String(e) });
    }
  }

  const abrirGoLive = () => setGoLive(true);
  const vivo = model.state === 'connected' || model.state === 'reconnecting';

  return (
    <>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
        <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="sr-only">Sala {sala.nome}</h1>
              <span className="text-[15px]"><b>{plural(model.people.length, 'pessoa', 'pessoas')} na sala</b> <span className="text-texto-fraco">· {linha}</span></span>
              <div className="ml-auto flex items-center gap-2">
                {convite === 'copiado' && <span role="status" className="text-[13px] text-texto-fraco">Link copiado. Vale 7 dias e 1 uso.</span>}
                <button type="button" className="btn" disabled={convite === 'gerando'} onClick={() => void convidar()}>
                  <Icone nome="link" />{convite === 'gerando' ? 'Gerando…' : 'Convidar'}
                </button>
              </div>
              {typeof convite === 'object' && (
                <Faixa className="basis-full" acoes={[{ rotulo: 'Tentar de novo', onClick: () => void convidar() }]} onFechar={() => setConvite('')}>
                  Não deu para gerar o convite. {convite.erro}
                </Faixa>
              )}
            </div>
            {stage || !vivo ? (
              <Palco model={model} stage={stage} reconexao={props.reconexao} onPick={(id) => {
                if (stage?.watching && !stage.owner.isLocal && stage.owner.id !== id) model.unwatch(stage.owner.id);
                setStageId(id);
              }} onRetry={props.onRetry} />
            ) : (
              <SalaLivre model={model} others={others} porId={porId} pessoas={pessoas} salas={salas} sala={sala} conectada={conectada}
                onGoLive={abrirGoLive} onCartao={onCartao} />
            )}
          </section>
          <Lateral sala={sala.nome} model={model} pessoas={pessoas} salas={salas} eu={eu} onCartao={onCartao} onAmigo={props.onAmigo} />
        </main>

        <footer className="grid min-w-0 grid-cols-[340px_minmax(0,1fr)] gap-4">
          <Voce model={model} nome={eu.nome} sala={sala.nome} imLive={imLive} temPalco={!!stage}
            onGoLive={abrirGoLive} onSair={() => onSala(null)} onFallback={() => { model.clearStreamError?.(); setFallback(true); setGoLive(true); }} />
          {stage ? (
            <ul aria-label="Pessoas na sala" className="m-0 flex min-w-0 list-none gap-3 overflow-x-auto p-0 pb-1">
              {others.map((p) => (
                <Canal key={p.id} person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)} />
              ))}
              {others.length === 0 && <li className="flex items-center px-2 text-[14px] text-texto-fraco">Só você na sala.</li>}
            </ul>
          ) : (
            <Atalhos />
          )}
        </footer>
      </div>

      {goLive && (
        <GoLive
          demo={demo}
          fallback={fallback}
          server={props.servidor.url}
          roomLabel={sala.nome}
          viewers={Math.max(0, model.people.length - 1)}
          confirmar={confirmarAr}
          onCancel={() => { setGoLive(false); setFallback(false); setConfirmarAr(0); }}
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

/** Local keys (app in focus) and the global shortcuts the person configured in Settings > Atalhos. */
export function Atalhos() {
  const [cfg, setCfg] = useState(lerAtalhos);
  useEffect(() => aoMudarAtalhos(setCfg), []);
  const locais: [string, string][] = [['M', 'microfone'], ['S', 'silencia tudo'], ['T', 'transmite']];
  const globais = ACOES.flatMap((a) => (cfg.teclas[a.id] ? [[cfg.teclas[a.id]!, a.rotulo.toLowerCase()] as [string, string]] : []));
  const item = ([k, t]: [string, string]) => (
    <li key={k + t} className="flex items-center gap-2 text-[14px]">
      <kbd className="inline-flex h-8 min-w-8 items-center justify-center border border-texto bg-superficie-alta px-1.5 font-mono text-[13px] font-bold">{k}</kbd>
      <span className="text-texto-fraco">{t}</span>
    </li>
  );
  return (
    <section className="janela flex min-w-0 flex-col" aria-label="Atalhos do teclado">
      <div className="barra">Atalhos<span className="ml-auto font-medium">{globais.length ? `${globais.length} globais` : 'com o app em foco'}</span></div>
      <ul className="m-0 flex flex-1 list-none flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        {locais.map(item)}
        {globais.length > 0 ? (
          <>
            <li aria-hidden="true" className="h-6 w-px bg-borda" />
            {globais.map(item)}
          </>
        ) : (
          <li className="text-[13px] text-texto-fraco">Atalhos com o jogo na frente: Configurações &gt; Atalhos.</li>
        )}
      </ul>
    </section>
  );
}

/** Empty stage: a slim strip with the one Transmit button, and the room's people get the space. */
function SalaLivre({ model, others, porId, pessoas, salas, sala, conectada, onGoLive, onCartao }: {
  model: RoomModel & RoomActions; others: Person[]; porId: Map<string, Pessoa>; pessoas: Pessoa[]; salas: Sala[]; sala: Sala;
  conectada: boolean; onGoLive(): void; onCartao(id: string): void;
}) {
  const nomeSala = new Map(salas.map((s) => [s.id, s.nome] as const));
  const naVoz = new Set(model.people.map((p) => p.id));
  const fora = pessoas.filter((p) => p.online && !naVoz.has(p.id) && p.sala !== sala.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="janela flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pr-3 pl-4">
        <b className="font-display text-[28px]">Palco livre</b>
        <span className="text-texto-fraco">Ninguém transmitindo. Mostre seu jogo para a sala.</span>
        <button type="button" className="btn btn-prim btn-lg ml-auto" disabled={!conectada} onClick={onGoLive}>
          <Icone nome="tela" />Transmitir
        </button>
      </div>
      <section className="janela flex min-h-0 flex-1 flex-col" aria-label="Pessoas na sala">
        <div className="barra">Na sala<span className="ml-auto font-medium">{plural(model.people.length, 'pessoa', 'pessoas')}</span></div>
        {others.length > 0 ? (
          <ul className="m-0 grid min-h-0 flex-1 list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-y-auto p-3">
            {others.map((p) => (
              <Canal key={p.id} largo person={p} perfil={porId.get(p.id)} onVolume={(v) => model.setVolume(p.id, v)} onCartao={() => onCartao(p.id)} />
            ))}
          </ul>
        ) : (
          <Vazio titulo="Só você por aqui" texto="Chame a galera em Convidar. O link vale 7 dias e 1 uso.">
            {fora.length > 0 && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <span className="rotulo">Online em outro lugar · {fora.length}</span>
                <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
                  {fora.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="btn btn-fant gap-2 px-2" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                        <Avatar pessoa={p} tamanho={28} />
                        <span className="text-[13px]">{p.nome}<span className="text-texto-fraco"> · {p.sala ? nomeSala.get(p.sala) ?? 'outra sala' : 'fora da voz'}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Vazio>
        )}
      </section>
    </div>
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
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} disablePictureInPicture />;
}

async function toggleFullscreen(el: HTMLElement) {
  const on = !document.fullscreenElement;
  if (on) await el.requestFullscreen().catch(() => undefined);
  else await document.exitFullscreen().catch(() => undefined);
  // WebView2 fullscreens the element only inside the window; make the window follow.
  if (isTauri()) await getCurrentWindow().setFullscreen(on).catch(() => undefined);
}

function Palco({ model, stage, reconexao, onPick, onRetry }: {
  model: RoomModel & RoomActions; stage?: Stream; reconexao: Reconexao; onPick(id: string): void; onRetry(): void;
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
    const proxima = RECUO_MS[reconexao.falhas] / 1000;
    return (
      <div className="janela flex min-h-0 flex-1 flex-col">
        <div className="barra barra-ar">Palco<span className="ml-auto font-medium">sem conexão</span></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <b className="font-display text-[32px]">Sem conexão com a sala</b>
          <p role="alert" className="m-0 max-w-[480px]">{model.error}</p>
          <p role="status" className="m-0 text-[14px] text-texto-fraco">
            {reconexao.esgotou ? 'Toque em Reconectar quando a internet voltar.'
              : !navigator.onLine ? 'Sem internet. Reconecta sozinho quando a rede voltar.'
                : `Reconectando sozinho em ${proxima} s (tentativa ${reconexao.falhas + 1} de ${RECUO_MS.length}).`}
          </p>
          <button type="button" className="btn btn-prim btn-lg" onClick={onRetry}>Reconectar</button>
        </div>
      </div>
    );
  }
  if (model.state === 'connecting' || !stage) {
    return (
      <div className="janela flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className="barra">Palco<span className="ml-auto font-medium">conectando</span></div>
        <div className="skeleton m-4 flex-1" />
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
        <span className="ml-auto truncate font-medium normal-case">{[numeros, `${stage.watchers} assistindo`].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-palco">
        {stage.track ? (
          <TrackVideo track={stage.track} className="absolute inset-0 size-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="font-pincel -rotate-6 text-[40px] text-lima">ao vivo!</span>
            <span className="text-[14px] text-sobre-palco">Tela de {nome}. Assistir gasta internet só de quem assiste.</span>
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

function Voce({ model, nome, sala, imLive, temPalco, onGoLive, onSair, onFallback }: {
  model: RoomModel & RoomActions; nome: string; sala: string; imLive: boolean; temPalco: boolean; onGoLive(): void; onSair(): void; onFallback(): void;
}) {
  const ativa = useInterfaceAtiva();
  const me = model.people.find((p) => p.isLocal);
  const estado = { connecting: 'conectando…', connected: `na voz · ${sala}`, reconnecting: 'reconectando…', error: 'fora da voz' }[model.state];
  const ping = model.ping;
  return (
    <div className="janela flex flex-col">
      <div className="barra">
        <span className="truncate">Você · {nome}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-medium" role="status">
          <span aria-hidden="true" className={`size-[7px] ${model.state === 'connected' ? 'bg-lima' : 'bg-superficie-topo'}`} />{estado}
        </span>
        {ping !== null && (
          <span role="status" aria-label={`Ping ${ping} milissegundos, ${qualidadePing(ping)}`} title="Ida e volta até o servidor de voz"
            className={`font-medium tabular-nums normal-case ${ping > 250 ? 'text-destaque' : ''}`}>· {ping} ms</span>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2 px-3 py-2">
        <button type="button" className={`btn btn-lg btn-icone ${model.micOn ? '' : 'btn-off'}`} aria-pressed={!model.micOn}
          aria-label={model.micOn ? 'Desligar microfone' : 'Ligar microfone'} title={model.micOn ? 'Microfone ligado (M)' : 'Microfone desligado (M)'} onClick={model.toggleMic}>
          <Icone nome={model.micOn ? 'mic' : 'mic-off'} tamanho={20} />
        </button>
        <button type="button" className={`btn btn-lg btn-icone ${model.deafened ? 'btn-off' : ''}`} aria-pressed={model.deafened}
          aria-label={model.deafened ? 'Ligar o som' : 'Silenciar tudo'} title={model.deafened ? 'Som desligado (S)' : 'Silenciar tudo (S)'} onClick={model.toggleDeafen}>
          <Icone nome={model.deafened ? 'fone-off' : 'fone'} tamanho={20} />
        </button>
        {imLive ? (
          <button type="button" className="btn btn-lg flex-1" onClick={model.stopLive}><Icone nome="tela" />Sair do ar</button>
        ) : temPalco ? (
          <button type="button" className="btn btn-lg flex-1" disabled={model.state !== 'connected'} onClick={onGoLive}><Icone nome="tela" />Transmitir</button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 px-1" title="Nível do seu microfone">
            <span className="text-[12px] text-texto-fraco">{model.micOn ? 'seu mic' : 'mudo'}</span>
            {me && <Medidor person={me} ativo={ativa && model.micOn} className="h-3 flex-1 !flex-row" />}
          </span>
        )}
        <button type="button" className="btn btn-lg btn-icone text-perigo" aria-label="Sair da sala" title="Sair da sala" onClick={onSair}>
          <Icone nome="sair" tamanho={20} />
        </button>
      </div>
      {imLive && model.videoPaused && (
        <p role="status" className="m-0 px-3 pb-2 text-[12px] text-texto-fraco">Ninguém assistindo · vídeo pausado</p>
      )}
      {(model.micError || model.streamError) && (
        <div role="alert" className="flex flex-col gap-2 border-t border-texto px-3 py-2 text-[13px] text-perigo">
          {model.micError && <span>{model.micError}</span>}
          {model.streamError && (
            <>
              <span>{model.streamError}</span>
              <button type="button" className="btn btn-sm self-start" disabled={model.state !== 'connected'} onClick={onFallback}>Transmitir pelo modo de reserva</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Voice meter outside React state: while the person speaks and the window is visible, a
 * requestAnimationFrame loop reads the level and flips the lit cells in the DOM. Silence = no loop.
 */
export function Medidor({ person, ativo, className = 'h-14 w-2.5' }: { person: Pick<Person, 'level' | 'nivel' | 'speaking'>; ativo: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { nivel, speaking, level } = person;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let aceso = -1;
    const pintar = (v: number) => {
      const n = Math.round(v * 8);
      if (n === aceso) return;
      aceso = n;
      Array.from(el.children).forEach((c, i) => c.toggleAttribute('data-aceso', i < n));
    };
    if (!ativo) return pintar(0);
    if (!nivel) return pintar(level); // demo room: fixed level
    if (!speaking) return pintar(0);
    let id = requestAnimationFrame(function quadro() {
      pintar(nivel());
      id = requestAnimationFrame(quadro);
    });
    return () => cancelAnimationFrame(id);
  }, [ativo, speaking, nivel, level]);
  return (
    <span ref={ref} aria-hidden="true" className={`medidor flex flex-col-reverse gap-0.5 ${className}`}>
      {Array.from({ length: 8 }, (_, i) => <i key={i} />)}
    </span>
  );
}

const TEMA_CLASSE = { papel: '', noite: 'tema-noite', lima: 'tema-lima' } as const;

type CanalProps = { person: Person; perfil?: Pessoa; largo?: boolean; onVolume(v: number): void; onCartao(): void };
const mesmaPessoa = (a: Person, b: Person) =>
  a.id === b.id && a.name === b.name && a.speaking === b.speaking && (a.nivel ? true : a.level === b.level)
  && a.muted === b.muted && a.live === b.live && a.volume === b.volume;
/**
 * Memoized: a speaker event re-renders only the channels whose voice data changed.
 * The callbacks are skipped on purpose; they only forward the person's id to stable actions.
 */
const Canal = memo(CanalView, (a: CanalProps, b: CanalProps) => mesmaPessoa(a.person, b.person) && a.perfil === b.perfil && a.largo === b.largo);

function CanalView({ person, perfil, largo, onVolume, onCartao }: CanalProps) {
  const ativa = useInterfaceAtiva();
  const pct = Math.round(person.volume * 100);
  const status = person.speaking ? 'falando' : person.muted ? 'mic desligado' : 'ouvindo';
  return (
    <li className={`janela flex flex-col ${largo ? 'w-full' : 'w-[184px] shrink-0'} ${perfil ? TEMA_CLASSE[perfil.tema] : ''}`}>
      <div className={`barra ${person.live ? 'barra-ar' : ''}`}>
        <span className="truncate">{person.name}</span>{person.live && <span className="ml-auto font-medium">no ar</span>}
      </div>
      <div className="flex items-end gap-2.5 px-3 pt-2.5 pb-1">
        <button type="button" className="border-0 bg-transparent p-0" aria-label={`Ver perfil de ${person.name}`} onClick={onCartao}>
          <Avatar pessoa={{ nome: person.name, avatar: perfil?.avatar ?? null }} tamanho={largo ? 56 : 44} />
        </button>
        <Medidor person={person} ativo={ativa} className={largo ? 'h-14 w-2.5' : 'h-11 w-2.5'} />
        <span className={`ml-auto self-start text-right text-[12px] leading-tight font-bold ${person.muted ? 'text-perigo' : person.speaking ? 'text-texto' : 'text-texto-fraco'}`}>{status}</span>
      </div>
      <div className="flex items-center gap-2 px-3 pb-1.5">
        <Slider.Root className="relative flex h-11 flex-1 touch-none items-center select-none" min={0} max={200} step={5}
          value={[pct]} onValueChange={([v]) => onVolume(v / 100)}>
          <Slider.Track className="relative h-1 grow bg-superficie-topo">
            <Slider.Range className="absolute h-full bg-texto" />
          </Slider.Track>
          <Slider.Thumb aria-label={`Volume de ${person.name}`} aria-valuetext={`${pct}%`} className="block h-4 w-3 border border-texto bg-superficie" />
        </Slider.Root>
        <span className="rotulo tabular-nums w-10 text-right text-[11px]">{pct}%</span>
      </div>
    </li>
  );
}

function Lateral({ sala, model, pessoas, salas, eu, onCartao, onAmigo }: {
  sala: string; model: RoomModel & RoomActions; pessoas: Pessoa[]; salas: Sala[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void;
}) {
  const [aba, setAba] = useState<'conversa' | 'pessoas'>('conversa');
  return (
    <aside className="janela flex min-h-0 flex-col" aria-label={aba === 'conversa' ? 'Conversa da sala' : 'Pessoas do servidor'}>
      <div className="flex border-b border-texto" role="tablist" aria-label="Painel lateral">
        {(['conversa', 'pessoas'] as const).map((a) => (
          <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`min-h-11 flex-1 border-0 font-mono text-[11px] font-bold tracking-[0.04em] uppercase [&+&]:border-l [&+&]:border-texto ${aba === a ? 'bg-texto text-superficie' : 'bg-transparent text-texto-fraco hover:bg-superficie-alta'}`}>
            {a === 'conversa' ? 'Conversa' : `Pessoas · ${pessoas.filter((p) => p.online).length} on`}
          </button>
        ))}
      </div>
      {aba === 'conversa'
        ? <Conversa sala={sala} chat={model.chat} onSend={model.sendChat} />
        : <Pessoas pessoas={pessoas} salas={salas} eu={eu} onCartao={onCartao} onAmigo={onAmigo} />}
    </aside>
  );
}

/** Memoized: a new message or a voice event does not redraw the messages already on screen. */
const Mensagem = memo(function Mensagem({ m }: { m: ChatMessage }) {
  return (
    <>
      <Avatar pessoa={{ nome: m.who, avatar: null }} tamanho={30} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-2"><b className="text-[14px]">{m.who}</b><span className="rotulo text-[11px]">{m.hora}</span></span>
        <span className="text-[14px] leading-[1.45] break-words">{m.text}</span>
      </div>
    </>
  );
});

/** Memoized on the messages: voice events and stats do not redraw the chat (sendChat reads the room itself). */
const Conversa = memo(ConversaView, (a, b) => a.sala === b.sala && a.chat === b.chat);
function ConversaView({ sala, chat, onSend }: { sala: string; chat: ChatMessage[]; onSend(text: string): void }) {
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
                  <Mensagem m={m} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="mx-3.5 mb-3.5 flex items-center gap-2 rounded-[2px] border border-texto bg-superficie py-1 pr-1 pl-3 focus-within:outline-2 focus-within:outline-destaque">
        <label htmlFor="msg" className="sr-only">Mensagem</label>
        <input id="msg" className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-[14px] text-texto outline-none" placeholder={`Mensagem para ${sala}`}
          value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn btn-prim btn-icone" aria-label="Enviar" disabled={!text.trim()}><Icone nome="enviar" tamanho={16} /></button>
      </form>
    </>
  );
}

function Pessoas({ pessoas, salas, eu, onCartao, onAmigo }: { pessoas: Pessoa[]; salas: Sala[]; eu: Usuario; onCartao(id: string): void; onAmigo(id: string, sim: boolean): void }) {
  const nomeSala = new Map(salas.map((s) => [s.id, s.nome] as const));
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
              <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-1">
                <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left" onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                  <Avatar pessoa={p} tamanho={32} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <b className="truncate text-[14px]">{p.nome}</b>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-texto-fraco">
                      <span aria-hidden="true" className={`size-1.5 shrink-0 ${p.online ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda'}`} />
                      <span className="truncate">{p.online ? (p.sala ? `em ${nomeSala.get(p.sala) ?? 'outra sala'}` : 'online') : 'offline'}</span>
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
