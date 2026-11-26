import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { uploadGuardado, uploadMedido } from '../lib/servidor';
import { store } from '../lib/config';
import { checkPresets, pickCodec } from '../lib/encoder';
import { evaluatePresets, gbPerHour, presetLabel, type Codec, type Encoding, type Preset, type PresetCard } from '../lib/presets';
import { listSources, probeMachine, savedProbe, type CaptureSource, type Gpu, type Trial } from '../lib/sidecar';
import { Fontes, initialSource, type SavedSource } from './golive/Fontes';
import { demoSources, demoTrials } from './golive/demo';

type Props = {
  demo: boolean;
  server: string;
  roomLabel: string;
  viewers: number;
  onCancel(): void;
  onStart(track: MediaStreamTrack, preset: Preset, codec: Codec): Promise<void>;
  onNativeStart?(source: CaptureSource, preset: PresetCard, codec: Codec, audio: boolean): Promise<void>;
  /** The native stream failed in this session (Room opens the screen again in the WebView2 mode). */
  fallback?: boolean;
  /** Bumped by the "Entrar no ar" global shortcut while this screen is open: confirms the saved choice. */
  confirmar?: number;
};

/** Same text as `UNAVAILABLE` in app/src-tauri/src/sidecar.rs: the core is missing on this machine. */
const CORE_MISSING = 'O núcleo de transmissão não está disponível nesta máquina.';
const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
const SURFACE: Record<string, string> = { monitor: 'tela inteira', window: 'janela', browser: 'aba' };
const fmtRes = (p: Preset) => (p.height === 2160 ? '4K' : `${p.height}p`);
/** The probe must hold 720p30 by hardware before the native mode is offered. */
const baseline = (trials: Trial[]) => trials.filter((t) => t.ok && t.resolution === '720p'
  && (t.fps ?? 0) >= 28.5 && (t.encoder_load_percent ?? Infinity) <= 80);

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(store.get(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export function GoLive({ demo, server, roomLabel, viewers, onCancel, onStart, onNativeStart, fallback, confirmar = 0 }: Props) {
  const canNative = demo || (isTauri() && !!onNativeStart);
  const [reserva, setReserva] = useState<string | null>(() =>
    fallback ? 'A transmissão nativa falhou nesta sessão.' : canNative ? null : '');
  const native = canNative && reserva === null;
  const [upload, setUpload] = useState<number | null | 'testing'>(() => (demo ? 50 : uploadGuardado(server) ?? 'testing'));
  const [webCodec, setWebCodec] = useState<{ codec: Codec; hardware: boolean }>({ codec: 'h264', hardware: false });
  const [encoding, setEncoding] = useState<Record<string, Encoding>>({});
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [picked, setPicked] = useState<string | null>(() => store.get('preset'));
  const [error, setError] = useState<{ text: string; retry?(): void }>();
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<CaptureSource[]>();
  const [loadingSources, setLoadingSources] = useState(false);
  const [source, setSource] = useState<CaptureSource>();
  // Saved GPU test: shown at once, checked against the core after the sources load.
  const [trials, setTrials] = useState<Trial[] | undefined>(() => (demo ? demoTrials : savedProbe()?.trials));
  const [gpu, setGpu] = useState<{ gpu: Gpu | null; at: number } | undefined>(() => (demo ? undefined : savedProbe() ?? undefined));
  const [testing, setTesting] = useState(false);
  const [audio, setAudio] = useState(() => store.get('somDoJogo') !== '0');
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function runUpload(refazer = false) {
    if (demo) return;
    setUpload('testing');
    setUpload(await uploadMedido(server, refazer));
  }

  async function loadSources() {
    setLoadingSources(true);
    try {
      const next = demo ? demoSources() : await listSources();
      setSources(next);
      setSource((current) => next.find((s) => s.id === current?.id)
        ?? initialSource(next, current ?? readJson<SavedSource>('fonte')));
    } finally {
      setLoadingSources(false);
    }
  }

  async function runProbe(force: boolean) {
    if (demo) return;
    setTesting(true);
    try {
      const result = await probeMachine(force);
      if (!baseline(result.trials).length) throw new Error('a placa não sustentou 720p30 por hardware');
      setTrials(result.trials);
      setGpu({ gpu: result.gpu, at: result.at });
    } catch (e) {
      setReserva(`O teste da placa falhou: ${message(e)}.`);
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    dialog.current?.focus();
    if (upload === 'testing') void runUpload();
  }, []);

  // Native: list the sources (thumbnails) first, then check the GPU; never both at once.
  useEffect(() => {
    if (!native) return;
    let current = true;
    void (async () => {
      try {
        await loadSources();
      } catch (e) {
        if (current) setReserva(`O núcleo não listou as telas: ${message(e)}.`);
        return;
      }
      if (current) await runProbe(false);
    })();
    return () => { current = false; };
  }, [native]);

  useEffect(() => {
    if (demo || native) return;
    let current = true;
    void pickCodec().then(async (c) => {
      const supported = await checkPresets(c.codec);
      if (current) {
        setWebCodec(c);
        setEncoding(supported);
      }
    }).catch(() => undefined); // no codec info: presets stay open and WebView2 picks H.264

    return () => { current = false; };
  }, [demo, native]);

  // Stop the capture if the user leaves without going live.
  useEffect(() => () => {
    if (!started.current) stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  const nativeCodec: Codec = trials && baseline(trials).some((t) => t.encoder.startsWith('av1_')) ? 'av1' : 'h264';
  const codec = native ? { codec: nativeCodec, hardware: true } : demo ? { codec: 'av1' as const, hardware: true } : webCodec;
  const sourceHeight = native ? source?.height ?? null
    : demo ? 1080 : caps?.height?.max && Number.isFinite(caps.height.max) ? caps.height.max : null;
  const cards = native && !trials ? [] : evaluatePresets({
    codec: codec.codec,
    uploadMbps: typeof upload === 'number' ? upload : null,
    sourceHeight,
    sourceWidth: native ? source?.width ?? undefined : undefined,
    encoding,
    trials: native ? trials : undefined,
  });
  const chosen = cards.find((c) => c.id === picked && !c.locked) ?? cards.find((c) => c.recommended);
  const codecLabel = codec.codec === 'av1' ? 'AV1' : 'H.264';
  const surface = SURFACE[track?.getSettings().displaySurface ?? ''] ?? 'fonte';
  const sourceName = native ? source?.title : demo ? 'Counter-Strike 2' : track ? track.label || surface : null;
  // A window gives the sound of that game; a monitor gives the whole PC minus the Stackcall (core does both).
  const withAudio = native && !!source && audio;
  const canStart = !busy && !!chosen && (native ? !!source && !testing : !!track || demo);

  function pick(next: CaptureSource) {
    setSource(next);
    store.set('fonte', JSON.stringify({ process_name: next.process_name, title: next.title } satisfies SavedSource));
  }

  async function pickSource() {
    setError(undefined);
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60 }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      });
      stream?.getTracks().forEach((t) => t.stop());
      next.getVideoTracks()[0]?.addEventListener('ended', () => setStream(null), { once: true });
      setStream(next);
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') setError({ text: `Não deu para capturar a tela: ${message(e)}.`, retry: () => void pickSource() });
    }
  }

  async function start() {
    if (!canStart || !chosen) return;
    if (demo) return onCancel();
    setBusy(true);
    setError(undefined);
    try {
      if (native && source && onNativeStart) {
        await onNativeStart(source, chosen, codec.codec, withAudio);
      } else if (track) {
        started.current = true;
        await onStart(track, chosen, codec.codec);
      }
    } catch (e) {
      started.current = false;
      // Only a missing core sends the user to the WebView2 mode; anything else can be retried here.
      if (native && message(e) === message(CORE_MISSING)) setReserva(`${CORE_MISSING}`);
      else setError({ text: `Não deu para entrar no ar: ${message(e)}.`, retry: () => void start() });
    } finally {
      setBusy(false);
    }
  }

  // Second press of the global shortcut: start with what is chosen (start() checks canStart).
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (confirmar > 0) void startRef.current();
  }, [confirmar]);

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'f' && (event.ctrlKey || event.metaKey) && native) {
      event.preventDefault();
      search.current?.focus();
    } else if (event.key === 'Enter' && event.target === dialog.current) {
      event.preventDefault();
      void start();
    }
  }

  function redo() {
    setError(undefined);
    void runUpload(true);
    if (native) void runProbe(true);
  }

  const gpuLoad = chosen?.trial?.encoder_load_percent ?? null;
  const uploadText = upload === 'testing' ? 'medindo…' : upload === null ? 'sem resposta' : <>{fmt(upload)} <Unit>Mb/s</Unit></>;
  const encoderText = native && testing && !trials ? 'testando a placa…' : `${codecLabel}${codec.hardware ? ' por hardware' : ''}`;
  const testedAt = gpu ? new Date(gpu.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;
  const preview = native ? source : null;

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Entrar no ar" tabIndex={-1} onKeyDown={onKey}
      className="absolute inset-0 z-20 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4 bg-fundo pt-5 outline-none max-md:grid-rows-none max-md:overflow-y-auto">
      <header className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-1 px-8 max-md:px-3">
        <div className="flex flex-col gap-1">
          <span className="rotulo">/ Sala {roomLabel} · {viewers === 0 ? 'ninguém na sala ainda' : `${viewers} ${viewers === 1 ? 'pessoa pode' : 'pessoas podem'} assistir`}</span>
          <h1 className="text-[56px] leading-[0.9] max-md:text-[40px]">Entrar no ar</h1>
        </div>
        <p className="m-0 min-w-0 flex-1 truncate pb-1 text-[14px] text-texto-fraco max-md:hidden">
          Escolha a fonte e a qualidade. Os números vêm do teste da sua placa e da sua internet.
        </p>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 px-8 max-md:grid-cols-[minmax(0,1fr)] max-md:px-3">
        {native ? (
          <Fontes sources={sources} loading={loadingSources} selected={source?.id} disabled={busy} refreshDisabled={testing || busy}
            searchRef={search} onSelect={pick} onEnter={() => void start()}
            onRefresh={() => void loadSources().catch((e: unknown) => setError({ text: `Não deu para atualizar a lista: ${message(e)}.` }))} />
        ) : (
          <section aria-label="Fonte" className="janela flex min-h-0 min-w-0 flex-col">
            <div className="barra">Fonte · modo de reserva</div>
            <button type="button" onClick={pickSource} disabled={busy} className="flex min-h-0 flex-1 flex-col border-0 bg-superficie p-0 text-left hover:bg-superficie-alta">
              <span className="relative flex min-h-0 w-full flex-1 items-center justify-center bg-palco">
                {stream ? <video ref={video} autoPlay muted playsInline className="absolute inset-0 size-full object-contain" />
                  : <span className="text-[13px] text-[#b3b3ab]">Abre o seletor do Windows</span>}
              </span>
              <span className="flex w-full flex-col border-t border-texto px-3 py-2.5">
                <b className="text-[14px]">{sourceName ?? 'Escolher tela ou janela'}</b>
                <span className="text-[12px] text-texto-fraco">{sourceName ? `${surface} · clique para trocar` : 'O Windows mostra as telas e janelas'}</span>
              </span>
            </button>
          </section>
        )}

        <section aria-label="Qualidade" className="flex min-h-0 min-w-0 flex-col gap-3">
          {native && (
            <div className="janela flex min-h-[28px] flex-[1_1_0] flex-col [@media(max-height:820px)]:hidden">
              <div className="barra">
                Prévia<span className="min-w-0 truncate font-medium normal-case">{preview ? `· ${preview.title}` : ''}</span>
                {preview?.width && preview.height ? <span className="ml-auto">{preview.width}×{preview.height}</span> : null}
              </div>
              <div className="relative min-h-0 flex-1 bg-palco [container-type:size]">
                <div className="absolute inset-0 flex items-center justify-center [@container(max-height:72px)]:hidden">
                  {preview?.thumbnail && !preview.minimized
                    ? <img alt={`Prévia de ${preview.title}`} className="size-full object-contain" src={`data:image/png;base64,${preview.thumbnail}`} />
                    : <span className="text-[13px] text-[#b3b3ab]">{preview?.minimized ? 'Janela minimizada: volte ao jogo antes de entrar no ar' : preview ? 'Sem prévia desta fonte' : 'Escolha uma fonte à esquerda'}</span>}
                </div>
              </div>
            </div>
          )}

          <div className="janela flex shrink-0 flex-col [@media(max-height:820px)]:flex-1">
            <div className="barra barra-lima">
              Qualidade escolhida
              <span className="ml-auto truncate font-medium">upload {uploadText} · {encoderText}</span>
            </div>
            {chosen ? (
              <div className="flex flex-1 items-center gap-5 px-4 py-3 max-md:flex-col max-md:items-stretch max-md:gap-3 [@media(max-height:760px)]:py-2">
                <div className="relative shrink-0 pr-[4.5rem]">
                  <b className="block font-display text-[76px] leading-[0.9] tabular-nums [@media(max-height:820px)]:text-[60px]">{fmtRes(chosen)}</b>
                  <span className="absolute right-0 bottom-0 -rotate-6 font-pincel text-[24px] text-destaque">{chosen.fps} fps</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="grid grid-cols-3 border border-texto">
                    <Stat label="upload" value={fmt(chosen.mbps[codec.codec])} unit="Mb/s" />
                    <Stat label="placa" value={gpuLoad !== null ? `${fmt(gpuLoad, 0)}%` : codecLabel} />
                    <Stat label="por pessoa/h" value={fmt(gbPerHour(chosen.mbps[codec.codec]))} unit="GB" />
                  </div>
                  {gpuLoad !== null && (
                    <span className="flex h-2 gap-0.5" role="meter" aria-label="Carga da placa de vídeo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(gpuLoad)}>
                      {Array.from({ length: 20 }, (_, k) => (
                        <i key={k} className={`flex-1 ${k < Math.round(gpuLoad / 5) ? (k >= 16 ? 'bg-destaque' : 'bg-texto') : 'bg-superficie-topo'}`} />
                      ))}
                    </span>
                  )}
                  <span className="truncate text-[13px] text-texto-fraco [@media(max-height:760px)]:hidden">{chosen.note}</span>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[96px] flex-1 items-center px-4 py-3">
                {native && !trials ? <span className="skeleton h-16 w-full" aria-label="Testando a placa de vídeo" />
                  : <span className="text-[14px] text-texto-fraco">Nenhum preset liberado para esta fonte. Escolha outra fonte ou refaça o teste.</span>}
              </div>
            )}
          </div>

          <div className="janela flex min-h-[100px] shrink flex-col">
            <div className="barra">
              Presets
              {gpu?.gpu && <span className="min-w-0 truncate font-medium normal-case opacity-75">· {gpu.gpu.name}{testedAt ? `, teste de ${testedAt}` : ''}</span>}
              <button type="button" disabled={upload === 'testing' || testing || busy || loadingSources || demo} onClick={redo}
                className="ml-auto shrink-0 border-0 bg-transparent font-mono text-[11px] font-bold text-superficie uppercase underline disabled:opacity-50">
                {testing ? 'Testando…' : 'Refazer teste'}
              </button>
            </div>
            <div role="radiogroup" aria-label="Presets de qualidade" className="min-h-0 overflow-y-auto">
              {native && !trials && [0, 1, 2].map((n) => <span key={n} className="skeleton m-2 block h-7" />)}
              {cards.map((p) => {
                const selected = p.id === chosen?.id;
                const tag = p.locked ? 'travado' : selected ? 'escolhido' : p.recommended ? 'recomendado' : '';
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={selected} disabled={p.locked || busy} title={p.reason}
                    onClick={() => { setPicked(p.id); store.set('preset', p.id); }}
                    className={`grid h-11 w-full [@media(max-height:760px)]:h-10 grid-cols-[60px_44px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-texto px-3.5 text-left first:border-t-0 ${selected ? 'bg-texto text-superficie' : 'bg-superficie hover:bg-superficie-alta disabled:hover:bg-superficie'} ${p.locked ? 'text-texto-fraco' : ''}`}>
                    <b className={`font-display text-[22px] tabular-nums ${p.locked ? 'line-through' : ''}`}>{fmtRes(p)}</b>
                    <span className={`rotulo ${selected ? 'text-superficie opacity-75' : ''}`}>{p.fps} fps</span>
                    <span className="truncate text-[13px]">{p.locked ? p.short ?? p.reason : `${fmt(p.mbps[codec.codec])} Mb/s · ${fmt(gbPerHour(p.mbps[codec.codec]))} GB/h por pessoa${p.trial ? ` · placa ${fmt(p.trial.encoder_load_percent ?? 0, 0)}%` : ''}`}</span>
                    <span className={`rotulo text-[10px] ${selected ? 'text-superficie opacity-75' : ''}`}>{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <footer className="flex flex-col">
        {reserva !== null && (
          <div role="status" className="flex min-h-9 items-center gap-3 border-t border-texto bg-superficie-alta px-8 py-1.5 text-[13px]">
            <b className="shrink-0">Modo de reserva (WebView2)</b>
            <span className="min-w-0 flex-1 truncate text-texto-fraco" title={reserva}>{reserva || 'Transmissão nativa só no app instalado.'} Vai até 1080p60.</span>
            {canNative && (
              <button type="button" className="shrink-0 border-0 bg-transparent p-0 text-[13px] font-bold underline" disabled={busy}
                onClick={() => { setError(undefined); setReserva(null); }}>Tentar o modo nativo</button>
            )}
          </div>
        )}
        {error && (
          <div role="alert" className="flex min-h-9 items-center gap-3 border-t border-perigo bg-destaque-fraco px-8 py-1.5 text-[13px] text-perigo">
            <span className="min-w-0 flex-1 truncate" title={error.text}>{error.text}</span>
            {error.retry && (
              <button type="button" className="shrink-0 border-0 bg-transparent p-0 text-[13px] font-bold text-perigo underline" disabled={busy}
                onClick={error.retry}>Tentar de novo</button>
            )}
          </div>
        )}
        <div className="flex h-[72px] items-center gap-3 border-t border-texto bg-superficie px-8 max-md:h-auto max-md:flex-wrap max-md:px-3 max-md:py-2.5">
          <span className="min-w-0 flex-1 truncate text-[14px] text-texto-fraco max-md:basis-full max-md:whitespace-normal">
            Vai transmitir <b className="text-texto">{sourceName ?? 'nenhuma fonte'}</b>{chosen && <> em <b className="text-texto">{presetLabel(chosen)}</b></>}, {!withAudio ? 'sem som do jogo' : source?.pid ? 'com o som do jogo' : 'com o som do PC, menos o Stackcall'}.
          </span>
          <span className="shrink-0 text-[13px] font-bold" id="som-do-jogo">Som do jogo</span>
          <div className="abas shrink-0" role="group" aria-labelledby="som-do-jogo"
            title={!native ? 'Só no app instalado' : source?.pid ? `Só o áudio de ${source.process_name ?? source.title}. Voz e música ficam fora.` : 'Todo o som do PC, menos o Stackcall: a voz da call não volta para quem assiste.'}>
            {([true, false] as const).map((on) => (
              <button key={String(on)} type="button" aria-pressed={withAudio === on} disabled={!native || !source || busy}
                onClick={() => { setAudio(on); store.set('somDoJogo', on ? '1' : '0'); }}>{on ? 'Ligado' : 'Desligado'}</button>
            ))}
          </div>
          <button type="button" className="btn btn-lg" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn btn-prim btn-lg" disabled={!canStart} onClick={() => void start()}>
            <span aria-hidden="true" className="size-2 bg-sobre-destaque" />{busy ? 'Conectando…' : 'Entrar no ar'}
          </button>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <span className="flex min-w-0 flex-col px-3 py-1.5 [&+&]:border-l [&+&]:border-texto">
      <span className="rotulo truncate text-[10px]">{label}</span>
      <b className="font-display text-[26px] leading-none tabular-nums">{value}{unit && <Unit className="ml-1 text-[11px] text-texto-fraco">{unit}</Unit>}</b>
    </span>
  );
}

/** Units keep their case ("Mb/s", not "MB/S") inside uppercase labels and title bars. */
function Unit({ children, className = '' }: { children: string; className?: string }) {
  return <span className={`font-mono normal-case ${className}`}>{children}</span>;
}
