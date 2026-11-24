import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { medirUpload } from '../lib/servidor';
import { store } from '../lib/config';
import { checkPresets, pickCodec } from '../lib/encoder';
import { evaluatePresets, gbPerHour, presetLabel, type Codec, type Encoding, type Preset, type PresetCard } from '../lib/presets';
import { listSources, testMachine, type CaptureSource, type Trial } from '../lib/sidecar';

type Props = {
  demo: boolean;
  server: string;
  roomLabel: string;
  viewers: number;
  onCancel(): void;
  onStart(track: MediaStreamTrack, preset: Preset, codec: Codec): Promise<void>;
  onNativeStart?(source: CaptureSource, preset: PresetCard, codec: Codec, audio: boolean): Promise<void>;
  fallback?: boolean;
};

const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const SURFACE: Record<string, string> = { monitor: 'tela inteira', window: 'janela', browser: 'aba' };

export function GoLive({ demo, server, roomLabel, viewers, onCancel, onStart, onNativeStart, fallback }: Props) {
  const [upload, setUpload] = useState<number | null | 'testing'>('testing');
  const [codec, setCodec] = useState<{ codec: Codec; hardware: boolean }>({ codec: 'h264', hardware: false });
  const [encoding, setEncoding] = useState<Record<string, Encoding>>({});
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [native, setNative] = useState(() => !demo && !fallback && isTauri() && !!onNativeStart);
  const [sources, setSources] = useState<CaptureSource[]>();
  const [source, setSource] = useState<CaptureSource>();
  const [trials, setTrials] = useState<Trial[]>();
  const [testing, setTesting] = useState(false);
  const [audio, setAudio] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  const runUploadTest = async () => {
    setUpload('testing');
    const mbps = demo ? 100 : await medirUpload(server);
    if (mbps !== null) store.set('uploadMbps', String(Math.round(mbps)));
    setUpload(mbps);
  };

  useEffect(() => {
    void runUploadTest();
    if (demo) return setCodec({ codec: 'av1', hardware: true });
  }, []);

  async function runMachineTest(force = false) {
    setTesting(true);
    try {
      const { trials } = await testMachine(force);
      const baseline = trials.filter((trial) => trial.ok && trial.resolution === '720p'
        && (trial.fps ?? 0) >= 28.5 && (trial.encoder_load_percent ?? Infinity) <= 80);
      if (!baseline.length) throw new Error('A GPU não conseguiu sustentar o preset de entrada.');
      setCodec({ codec: baseline.some((t) => t.encoder.startsWith('av1_')) ? 'av1' : 'h264', hardware: true });
      setTrials(trials);
    } catch (e) {
      setError(String(e));
      setNative(false);
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    if (!native) return;
    let current = true;
    void listSources().then((next) => {
      if (!current) return;
      if (!next.length) throw new Error('Nenhuma tela ou janela disponível para captura.');
      setSources(next);
    }).catch((e: unknown) => {
      if (current) {
        setError(String(e));
        setNative(false);
      }
    });
    void runMachineTest();
    return () => { current = false; };
  }, [native]);

  useEffect(() => {
    if (demo || native) return;
    let current = true;
    void pickCodec().then(async (c) => {
      const supported = await checkPresets(c.codec);
      if (current) {
        setCodec(c);
        setEncoding(supported);
      }
    });
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
  const sourceHeight = native ? source?.height ?? null
    : demo ? 1080 : caps?.height?.max && Number.isFinite(caps.height.max) ? caps.height.max : null;
  const cards = evaluatePresets({
    codec: codec.codec,
    uploadMbps: typeof upload === 'number' ? upload : null,
    sourceHeight,
    sourceWidth: native ? source?.width : undefined,
    encoding,
    trials: native ? trials ?? [] : undefined,
  }).filter((p) => !native || p.height <= 1080
    || (p.trial && typeof upload === 'number' && upload * 0.5 >= p.uploadNeeded));
  const chosen = cards.find((c) => c.id === picked && !c.locked) ?? cards.find((c) => c.recommended);
  const codecLabel = codec.codec === 'av1' ? 'AV1' : 'H.264';
  const surface = SURFACE[track?.getSettings().displaySurface ?? ''] ?? 'fonte';
  const sourceName = native ? source?.title : demo ? 'Counter-Strike 2' : track ? track.label || surface : null;
  const withAudio = native && !!source?.pid && audio;

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
      if ((e as DOMException)?.name !== 'NotAllowedError') setError('Não deu para capturar a tela: ' + String(e));
    }
  }

  async function start() {
    if (!chosen) return;
    if (demo) return onCancel();
    if (native ? !source || !onNativeStart : !track) return;
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
      setError('Falhou ao entrar no ar: ' + (e instanceof Error ? e.message : String(e)));
      if (native) setNative(false);
    } finally {
      setBusy(false);
    }
  }

  const gpuLoad = chosen?.trial?.encoder_load_percent ?? null;
  const fmtRes = (p: Preset) => (p.height === 2160 ? '4K' : `${p.height}p`);
  return (
    <div role="dialog" aria-modal="true" aria-label="Entrar no ar" className="absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 overflow-y-auto bg-fundo px-8 py-7">
      <section aria-label="O que transmitir" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="rotulo">/ Sala {roomLabel} · {viewers} {viewers === 1 ? 'pessoa pode' : 'pessoas podem'} assistir</span>
          <h1 className="text-[76px]">Entrar no ar</h1>
        </div>
        <p className="m-0 max-w-[56ch] text-texto-fraco">
          Escolha o que mostrar e a qualidade. Os números vêm do teste que mediu sua placa de vídeo e sua internet.
        </p>
        <h2 className="rotulo m-0 font-mono text-[12px]">Fonte</h2>
        {native ? (
          <div aria-label="Telas e janelas" className="grid grid-cols-2 gap-3" aria-busy={!sources}>
            {!sources && [0, 1, 2, 3].map((n) => <span key={n} className="skeleton h-[150px]" />)}
            {sources?.map((candidate) => {
              const on = source?.id === candidate.id;
              return (
                <button key={candidate.id} type="button" disabled={busy} aria-pressed={on}
                  onClick={() => { setSource(candidate); setAudio(!!candidate.pid); }}
                  className={`flex min-w-0 flex-col border border-texto bg-superficie p-0 text-left active:translate-y-px ${on ? 'outline-[3px] -outline-offset-1 outline-destaque' : ''}`}>
                  <span className="relative flex h-[104px] items-end border-b border-texto bg-palco p-2">
                    {candidate.thumbnail && <img alt="" className="absolute inset-0 size-full object-contain" src={`data:image/png;base64,${candidate.thumbnail}`} />}
                    <span className="rotulo relative text-[10px] text-[#b3b3ab]">{candidate.width}×{candidate.height}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 px-3 py-2.5">
                    <b title={candidate.title} className="truncate text-[14px]">{candidate.title}</b>
                    <span className="rotulo ml-auto shrink-0 text-[10px]">{candidate.pid ? 'janela' : 'monitor'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <button type="button" onClick={pickSource} className={`flex min-h-[120px] flex-col justify-end border border-texto bg-superficie p-0 text-left ${sourceName ? 'outline-[3px] -outline-offset-1 outline-destaque' : ''}`}>
            <span className="relative flex flex-1 items-center justify-center bg-palco">
              {stream ? <video ref={video} autoPlay muted playsInline className="max-h-[200px] w-full object-contain" />
                : <span className="text-[13px] text-[#b3b3ab]">Abre o seletor do Windows</span>}
            </span>
            <span className="flex flex-col border-t border-texto px-3 py-2.5">
              <b className="text-[14px]">{sourceName ?? 'Escolher tela ou janela'}</b>
              <span className="text-[12px] text-texto-fraco">{sourceName ? `${surface} · clique para trocar` : 'Modo de reserva pelo WebView2'}</span>
            </span>
          </button>
        )}
        <div className="janela flex items-center gap-3.5 px-3.5 py-3">
          <span className="flex flex-1 flex-col gap-0.5">
            <b className="text-[14px]">Levar o som do jogo</b>
            <span className="text-[13px] text-texto-fraco">
              {native && source?.pid ? `Só o áudio de ${source.process_name ?? source.title}. Voz e música ficam fora.` : 'Disponível ao escolher uma janela de jogo.'}
            </span>
          </span>
          <div className="abas" role="group" aria-label="Som do jogo">
            <button type="button" aria-pressed={withAudio} disabled={!native || !source?.pid || busy} onClick={() => setAudio(true)}>Ligado</button>
            <button type="button" aria-pressed={!withAudio} disabled={!native || !source?.pid || busy} onClick={() => setAudio(false)}>Desligado</button>
          </div>
        </div>
        {!demo && !native && <p className="m-0 text-[13px] text-texto-fraco">Modo de reserva WebView2: até 1080p60, com mais bitrate para manter a nitidez.</p>}
      </section>

      <section aria-label="Qualidade" className="flex min-w-0 flex-col gap-4">
        <div className="janela">
          <div className="barra barra-lima">
            Qualidade escolhida
            <span className="ml-auto truncate font-medium">
              upload {upload === 'testing' ? 'medindo…' : upload === null ? 'não medido' : `${fmt(upload)} Mb/s`} · {native && testing ? 'testando a placa…' : `${codecLabel}${codec.hardware ? ' por hardware' : ''}`}
            </span>
          </div>
          {chosen ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-6 px-5 py-4">
              <div className="relative pr-20">
                <b className="font-display tabular-nums block text-[120px] leading-[0.95]">{fmtRes(chosen)}</b>
                <span className="font-pincel absolute right-0 bottom-1 -rotate-6 text-[30px] text-destaque">{chosen.fps} fps</span>
              </div>
              <div className="flex flex-col gap-2.5 pb-2.5">
                <div className="grid grid-cols-3 border border-texto">
                  <Stat label="upload" value={`${fmt(chosen.mbps[codec.codec])}`} unit="Mb/s" />
                  <Stat label="placa" value={gpuLoad !== null ? `${fmt(gpuLoad, 0)}%` : codecLabel} />
                  <Stat label="por pessoa/h" value={fmt(gbPerHour(chosen.mbps[codec.codec]))} unit="GB" />
                </div>
                {gpuLoad !== null && (
                  <span className="flex h-2.5 gap-0.5" role="meter" aria-label="Carga da placa de vídeo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(gpuLoad)}>
                    {Array.from({ length: 20 }, (_, k) => (
                      <i key={k} className={`flex-1 ${k < Math.round(gpuLoad / 5) ? (k >= 16 ? 'bg-destaque' : 'bg-texto') : 'bg-superficie-topo'}`} />
                    ))}
                  </span>
                )}
                <span className="text-[14px] text-texto-fraco">{chosen.note}</span>
              </div>
            </div>
          ) : (
            <p className="m-0 px-5 py-6 text-texto-fraco">{native && testing ? 'Testando a placa de vídeo…' : 'Nenhum preset disponível. Refaça o teste.'}</p>
          )}
        </div>

        <div className="janela flex min-h-0 flex-col">
          <div className="barra">
            Presets
            <button type="button" disabled={upload === 'testing' || testing || busy} className="ml-auto border-0 bg-transparent font-mono text-[11px] font-bold text-superficie uppercase underline disabled:opacity-50"
              onClick={() => { void runUploadTest(); if (native) void runMachineTest(true); }}>Refazer teste</button>
          </div>
          <div role="radiogroup" aria-label="Qualidade" className="flex flex-col">
            {native && testing && !trials && [0, 1, 2].map((n) => <span key={n} className="skeleton m-2 h-10" />)}
            {cards.map((p) => {
              const selected = p.id === chosen?.id;
              const tag = p.locked ? 'travado' : selected ? 'escolhido' : p.recommended ? 'recomendado' : '';
              return (
                <button key={p.id} type="button" role="radio" aria-checked={selected} disabled={p.locked} onClick={() => setPicked(p.id)}
                  className={`grid min-h-[54px] grid-cols-[90px_54px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-texto px-3.5 py-2 text-left first:border-t-0 ${selected ? 'bg-texto text-superficie' : 'bg-superficie hover:bg-superficie-alta disabled:hover:bg-superficie'} ${p.locked ? 'text-texto-fraco' : ''}`}>
                  <b className={`font-display tabular-nums text-[26px] ${p.locked ? 'line-through' : ''}`}>{fmtRes(p)}</b>
                  <span className={`rotulo ${selected ? 'text-superficie opacity-75' : ''}`}>{p.fps} fps</span>
                  <span className="text-[13px] leading-snug">{p.locked ? p.reason : `${fmt(p.mbps[codec.codec])} Mb/s · ${fmt(gbPerHour(p.mbps[codec.codec]))} GB/h por pessoa${p.trial ? ` · placa ${fmt(p.trial.encoder_load_percent ?? 0, 0)}%` : ''}`}</span>
                  <span className={`rotulo text-[10px] ${selected ? 'text-superficie opacity-75' : ''}`}>{tag}</span>
                </button>
              );
            })}
          </div>
        </div>
        {upload === null && <p className="m-0 text-[13px] text-perigo">O teste de upload não respondeu. {native && 'Refaça o teste para liberar os presets.'}</p>}
        {error && <p role="alert" className="m-0 text-perigo">{error}</p>}

        <div className="mt-auto flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-texto-fraco">
            Vai transmitir <b className="text-texto">{sourceName ?? 'nenhuma fonte'}</b>{chosen && <> em <b className="text-texto">{presetLabel(chosen)}</b></>}, {withAudio ? 'com' : 'sem'} som do jogo.
          </span>
          <button type="button" className="btn btn-lg ml-auto" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn btn-prim btn-lg" disabled={busy || !chosen || (native ? !source || testing : !track && !demo)} onClick={() => void start()}>
            <span aria-hidden="true" className="size-2 bg-sobre-destaque" />{busy ? 'Conectando…' : 'Entrar no ar'}
          </button>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <span className="flex flex-col px-3 py-2 [&+&]:border-l [&+&]:border-texto">
      <span className="rotulo text-[10px]">{label}</span>
      <b className="font-display tabular-nums text-[30px] leading-none">{value}{unit && <span className="rotulo ml-1 text-[10px]">{unit}</span>}</b>
    </span>
  );
}