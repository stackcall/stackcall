import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Slider from '@radix-ui/react-slider';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { measureRtt } from '../lib/api';
import { ROOMS, demoScreen, store, type RoomId } from '../lib/config';
import { colorFor, initials, type Attachable, type ChatMessage, type Person, type RoomActions, type RoomModel, type Stream } from '../room/model';
import { useDemoRoom } from '../room/demo';
import { useLiveRoom, type Session } from '../room/useLiveRoom';
import { GoLive } from './GoLive';

type Props = { session: Session; room: RoomId; onRoom(room: RoomId): void; onSettings(): void; onLeave(): void };

export function LiveRoom(props: Props) {
  const [session, setSession] = useState(props.session);
  const model = useLiveRoom(session, props.room);
  return <RoomView {...props} model={model} demo={false} onRetry={() => setSession({ ...session })} />;
}

export function DemoRoom(props: Props) {
  const model = useDemoRoom(props.room, props.session.name);
  return <RoomView {...props} model={model} demo onRetry={() => undefined} />;
}

const tagOf = (p: Person) => (p.live ? 'NO AR' : p.speaking ? 'FALANDO' : p.muted ? 'MUDO' : '');
const pad = (n: number) => String(n).padStart(2, '0');
const fmtMbps = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export function RoomView({ model, demo, session, room, onRoom, onSettings, onLeave, onRetry }: Props & {
  model: RoomModel & RoomActions; demo: boolean; onRetry(): void;
}) {
  const [goLive, setGoLive] = useState(() => demo && demoScreen() === 'ar');
  const [fallback, setFallback] = useState(false);
  const [ping, setPing] = useState<number | null>(demo ? 142 : null);
  const [stageId, setStageId] = useState<string | null>(null);
  const upload = demo ? 100 : Number(store.get('uploadMbps')) || null;
  const me = model.people.find((p) => p.isLocal);
  const imLive = !!me?.live;
  const stage = model.streams.find((s) => s.owner.id === stageId) ?? model.streams[0];
  const others = model.people.filter((p) => p.id !== stage?.owner.id);

  useEffect(() => {
    if (demo) return;
    const tick = () => void measureRtt(session.server).then(setPing);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [demo, session.server]);

  const roomLabel = ROOMS.find((r) => r.id === room)?.label ?? room;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-5 border-b border-line bg-panel px-5">
        <span className="font-cond text-[20px] font-bold tracking-[0.04em]">STACKCALL</span>
        <Tabs.Root value={room} onValueChange={(v) => onRoom(v as RoomId)} activationMode="manual">
          <Tabs.List aria-label="Salas" className="flex gap-1">
            {ROOMS.map((r) => (
              <Tabs.Trigger
                key={r.id}
                value={r.id}
                className="flex h-[34px] items-center gap-2 rounded-[6px] border border-transparent bg-transparent px-3.5 font-cond text-[15px] font-semibold uppercase tracking-[0.03em] text-[#c5c8ce] data-[state=active]:border-live data-[state=active]:bg-active-strong data-[state=active]:text-on-active"
              >
                {r.label}
                {r.id === room && <span className="font-sans text-[12px] font-medium text-muted">{model.people.length}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <div className="ml-auto flex items-center gap-4 font-cond text-[14px] tracking-[0.04em] text-muted">
          {model.state !== 'connected' && (
            <span className="text-danger-text">{model.state === 'connecting' ? 'CONECTANDO…' : model.state === 'reconnecting' ? 'RECONECTANDO…' : 'SEM CONEXÃO'}</span>
          )}
          <span>PING <b className="text-text">{ping === null ? '—' : `${ping} MS`}</b></span>
          <span>UPLOAD <b className="text-text">{upload === null ? 'NÃO MEDIDO' : `${fmtMbps(upload)} MBPS`}</b></span>
          <button type="button" onClick={onSettings} aria-label="Configurações" title="Configurações"
            className="flex size-8 items-center justify-center rounded-full border-0 font-sans font-semibold text-bg" style={{ background: colorFor(session.name) }}>
            {initials(session.name)}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px]">
        <main className="grid min-w-0 grid-cols-4 grid-rows-[minmax(0,1fr)_150px] gap-2.5 p-4">
          <Stage model={model} stage={stage} onPick={setStageId} onGoLive={() => setGoLive(true)} onRetry={onRetry} />
          <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            {others.map((p) => (
              <PersonTile key={p.id} person={p} num={model.people.indexOf(p) + 1} />
            ))}
          </div>
          <Mixer model={model} />
        </main>
        <Chat room={roomLabel} chat={model.chat} onSend={model.sendChat} />
      </div>

      {model.streamError && !goLive && (
        <div role="alert" className="flex items-center gap-3 px-5 py-2 text-danger-text">
          <span>{model.streamError}</span>
          <button type="button" className="btn" disabled={model.state !== 'connected'} onClick={() => {
            model.clearStreamError?.();
            setFallback(true);
            setGoLive(true);
          }}>Transmitir pelo WebView2</button>
        </div>
      )}
      <footer className="flex h-[72px] shrink-0 items-center gap-2.5 border-t border-line bg-panel px-5">
        <button type="button" className="btn" aria-pressed={!model.micOn} onClick={model.toggleMic}>
          {model.micOn ? 'Mic aberto' : 'Mudo'}
        </button>
        <button type="button" className={`btn ${model.deafened ? 'border-live text-on-active' : ''}`} aria-pressed={model.deafened} onClick={model.toggleDeafen}>
          {model.deafened ? 'Fone desligado' : 'Fone'}
        </button>
        <button type="button" className="btn" aria-pressed={model.cameraOn} onClick={model.toggleCamera}>
          {model.cameraOn ? 'Desligar câmera' : 'Câmera'}
        </button>
        {model.micError && <span role="alert" className="text-[13px] text-danger-text">{model.micError}</span>}
        {imLive ? (
          <button type="button" onClick={model.stopLive} className="btn ml-auto h-11 border-live bg-live px-[22px] text-[16px] font-bold tracking-[0.08em] text-bg">
            Sair do ar
          </button>
        ) : (
          <button type="button" disabled={model.state !== 'connected'} onClick={() => setGoLive(true)}
            className="btn ml-auto border-live bg-active-strong px-[22px] text-[16px] font-bold tracking-[0.08em] text-on-active">
            Entrar no ar
          </button>
        )}
        <button type="button" onClick={onLeave} className="btn border-danger-line bg-danger-bg text-danger-text">
          Sair
        </button>
      </footer>

      {goLive && (
        <GoLive
          demo={demo}
          fallback={fallback}
          server={session.server}
          roomLabel={roomLabel}
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
    </div>
  );
}

export function TrackVideo({ track, className, muted = true }: { track?: Attachable; className?: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => void track.detach(el);
  }, [track]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

async function toggleFullscreen(el: HTMLElement) {
  const on = !document.fullscreenElement;
  if (on) await el.requestFullscreen().catch(() => undefined);
  else await document.exitFullscreen().catch(() => undefined);
  // WebView2 fullscreens the element only inside the window; make the window follow.
  if (isTauri()) await getCurrentWindow().setFullscreen(on).catch(() => undefined);
}

function Stage({ model, stage, onPick, onGoLive, onRetry }: {
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

  const hatch = 'repeating-linear-gradient(135deg, #1a1d22 0 22px, #181b20 22px 44px)';
  if (model.state === 'error') {
    return (
      <div className="col-span-3 flex flex-col items-center justify-center gap-3 rounded-[6px] border border-danger-line" style={{ background: hatch }}>
        <p role="alert" className="m-0 max-w-[480px] text-center text-danger-text">{model.error}</p>
        <button type="button" className="btn" onClick={onRetry}>Tentar de novo</button>
      </div>
    );
  }
  if (!stage) {
    return (
      <div className="col-span-3 flex flex-col items-center justify-center gap-3 rounded-[6px] border border-line" style={{ background: hatch }}>
        <span className="label-caps text-[16px] text-[#5d6470]">Ninguém no ar</span>
        <span className="text-muted">O palco está livre. Mostra o teu jogo pra galera.</span>
        <button type="button" className="btn" disabled={model.state !== 'connected'} onClick={onGoLive}>Entrar no ar</button>
      </div>
    );
  }
  const name = stage.owner.isLocal ? 'VOCÊ' : stage.owner.name.toUpperCase();
  return (
    <div ref={ref} className="relative col-span-3 overflow-hidden rounded-[6px] border-2 border-live bg-black" style={stage.track ? undefined : { background: hatch }}>
      {stage.track ? (
        <TrackVideo track={stage.track} className="absolute inset-0 size-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="font-cond text-[16px] tracking-[0.06em] text-[#5d6470]">[ TELA DE {name} ]</span>
          {!stage.watching && (
            <button type="button" className="btn btn-primary h-12 px-7 text-[18px]" onClick={() => model.watch(stage.owner.id)}>
              Assistir
            </button>
          )}
        </div>
      )}
      <div className="absolute top-0 left-0 flex">
        <span className="label-caps bg-live px-3 py-1.5 text-[14px] text-bg">No ar</span>
        <span className="bg-[rgba(15,16,18,0.85)] px-3 py-1.5 font-cond text-[14px] font-semibold tracking-[0.04em]">{name}</span>
      </div>
      <div className="absolute top-2.5 right-3 flex items-center gap-2">
        <span className="rounded bg-[rgba(15,16,18,0.85)] px-2.5 py-1 font-cond text-[14px] tracking-[0.04em] text-[#c5c8ce]">
          {[stage.info, `${stage.watchers} ASSISTINDO`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="absolute right-3 bottom-3 flex gap-2">
        {model.streams.length > 1 && model.streams.map((s) => (
          <button key={s.owner.id} type="button" onClick={() => onPick(s.owner.id)} aria-pressed={s === stage}
            className={`btn h-8 px-3 text-[13px] ${s === stage ? 'border-live text-on-active' : ''}`}>
            {s.owner.isLocal ? 'Você' : s.owner.name}
          </button>
        ))}
        {stage.watching && !stage.owner.isLocal && (
          <button type="button" className="btn h-8 px-3 text-[13px]" onClick={() => model.unwatch(stage.owner.id)}>Parar de assistir</button>
        )}
        {stage.track && (
          <button type="button" className="btn h-8 px-3 text-[13px]" onClick={() => ref.current && void toggleFullscreen(ref.current)}>Tela cheia</button>
        )}
      </div>
    </div>
  );
}

function PersonTile({ person, num }: { person: Person; num: number }) {
  const tag = tagOf(person);
  return (
    <div className={`relative flex min-h-[110px] flex-1 items-center justify-center overflow-hidden rounded-[6px] border-2 bg-surface ${person.speaking ? 'border-live' : 'border-line'}`}>
      {person.camera ? (
        <TrackVideo track={person.camera} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="flex size-14 items-center justify-center rounded-full text-[18px] font-semibold text-bg" style={{ background: colorFor(person.name) }}>
          {initials(person.name)}
        </span>
      )}
      <span className="absolute top-1.5 left-2 font-cond text-[13px] font-bold text-[#7d818a]">{pad(num)}</span>
      <span className="absolute bottom-1.5 left-2 font-cond text-[14px] font-semibold tracking-[0.03em]">
        {person.isLocal ? 'VOCÊ' : person.name.toUpperCase()}
      </span>
      {tag && <span className={`absolute right-2 bottom-1.5 font-cond text-[12px] font-semibold tracking-[0.06em] ${tag === 'MUDO' ? 'text-muted' : 'text-live-soft'}`}>{tag}</span>}
    </div>
  );
}

function Meter({ level, name }: { level: number; name: string }) {
  const lit = Math.round(level * 8);
  return (
    <div className="flex flex-col-reverse gap-[3px]" role="meter" aria-label={`Nível de áudio de ${name}`} aria-valuemin={0} aria-valuemax={8} aria-valuenow={lit}>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="h-2" style={{ background: i < lit ? (i >= 6 ? '#b9a8ff' : '#7c5cff') : '#2a2d33' }} />
      ))}
    </div>
  );
}

function Mixer({ model }: { model: RoomModel & RoomActions }) {
  return (
    <div className="col-span-4 flex items-stretch gap-2.5 overflow-x-auto rounded-[6px] border border-line bg-panel p-3" aria-label="Mesa de som">
      {model.people.map((p) => {
        const tag = tagOf(p);
        const name = p.isLocal ? 'VOCÊ' : p.name.toUpperCase();
        const pct = Math.round(p.volume * 100);
        return (
          <div key={p.id} className={`grid min-w-[170px] flex-1 grid-cols-[22px_minmax(0,1fr)] gap-2.5 rounded-[6px] border bg-surface px-2.5 py-2 ${p.speaking ? 'border-live' : 'border-line'}`}>
            <Meter level={p.level} name={name} />
            <div className="flex min-w-0 flex-col justify-between">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-cond text-[16px] font-bold tracking-[0.03em]">{name}</span>
                {tag && <span className={`ml-auto font-cond text-[12px] tracking-[0.05em] ${tag === 'MUDO' ? 'text-muted' : 'text-live-soft'}`}>{tag}</span>}
              </div>
              {p.isLocal ? (
                <span className="text-[12px] text-muted">{model.micOn ? 'Seu microfone' : 'Microfone mudo'}</span>
              ) : (
                <div className="flex flex-col gap-1 text-[12px] text-muted">
                  <span>Volume {pct}%</span>
                  <Slider.Root className="relative flex h-4 w-full touch-none items-center select-none" min={0} max={200} step={5}
                    value={[pct]} onValueChange={([v]) => model.setVolume(p.id, v / 100)}>
                    <Slider.Track className="relative h-1 grow rounded bg-[#2a2d33]">
                      <Slider.Range className="absolute h-full rounded bg-live" />
                    </Slider.Track>
                    <Slider.Thumb aria-label={`Volume de ${name}`} className="block size-3.5 rounded-full border-2 border-live bg-text" />
                  </Slider.Root>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Chat({ room, chat, onSend }: { room: string; chat: ChatMessage[]; onSend(text: string): void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(text);
    setText('');
  };
  return (
    <aside aria-label="Chat da sala" className="flex min-h-0 flex-col border-l border-line bg-panel">
      <div className="label-caps flex h-11 shrink-0 items-center border-b border-line px-4 text-[15px]">Chat · {room}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4" aria-live="polite">
        {chat.length === 0 && <p className="m-0 mt-auto text-faint">Sala quieta. Manda um oi.</p>}
        <div className="mt-auto" />
        {chat.map((m) => (
          <div key={m.id} className="leading-[1.45]">
            <b className="font-semibold" style={{ color: colorFor(m.who) }}>{m.who}</b>{' '}
            <span className="text-[12px] text-faint">{hhmm(m.at)}</span>
            <br />
            <span className="break-words text-[#c9ccd2]">{m.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="border-t border-line p-3">
        <label htmlFor="msg" className="sr-only">Mensagem</label>
        <input id="msg" className="field" placeholder="Mensagem para a sala" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </form>
    </aside>
  );
}
