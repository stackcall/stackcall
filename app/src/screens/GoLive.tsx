import { useEffect, useRef, useState } from 'react';
import { measureUpload } from '../lib/api';
import { store } from '../lib/config';
import { checkPresets, pickCodec } from '../lib/encoder';
import { evaluatePresets, gbPerHour, presetLabel, type Codec, type Encoding, type Preset } from '../lib/presets';

type Props = {
  demo: boolean;
  server: string;
  roomLabel: string;
  viewers: number;
  onCancel(): void;
  onStart(track: MediaStreamTrack, preset: Preset, codec: Codec): Promise<void>;
};

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const SURFACE: Record<string, string> = { monitor: 'tela inteira', window: 'janela', browser: 'aba' };

export function GoLive({ demo, server, roomLabel, viewers, onCancel, onStart }: Props) {
  const [upload, setUpload] = useState<number | null | 'testing'>('testing');
  const [codec, setCodec] = useState<{ codec: Codec; hardware: boolean }>({ codec: 'h264', hardware: false });
  const [encoding, setEncoding] = useState<Record<string, Encoding>>({});
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  const runUploadTest = async () => {
    setUpload('testing');
    const mbps = demo ? 100 : await measureUpload(server);
    if (mbps !== null) store.set('uploadMbps', String(Math.round(mbps)));
    setUpload(mbps);
  };

  useEffect(() => {
    void runUploadTest();
    if (demo) return setCodec({ codec: 'av1', hardware: true });
    void pickCodec().then(async (c) => {
      setCodec(c);
      setEncoding(await checkPresets(c.codec));
    });
  }, []);

  // Stop the capture if the user leaves without going live.
  useEffect(() => () => {
    if (!started.current) stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  const sourceHeight = demo ? 1080 : caps?.height?.max && Number.isFinite(caps.height.max) ? caps.height.max : null;
  const cards = evaluatePresets({
    codec: codec.codec,
    uploadMbps: typeof upload === 'number' ? upload : null,
    sourceHeight: stream || demo ? sourceHeight : null,
    encoding,
  });
  const chosen = cards.find((c) => c.id === picked && !c.locked) ?? cards.find((c) => c.recommended);
  const codecLabel = codec.codec === 'av1' ? 'AV1' : 'H.264';
  const surface = SURFACE[track?.getSettings().displaySurface ?? ''] ?? 'fonte';
  const sourceName = demo ? 'Counter-Strike 2' : track ? track.label || surface : null;

  async function pickSource() {
    setError(undefined);
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60 }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false, // game audio comes in v0.2 with the native core
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
    if (!track) return;
    setBusy(true);
    setError(undefined);
    try {
      started.current = true;
      await onStart(track, chosen, codec.codec);
    } catch (e) {
      started.current = false;
      setError('Falhou ao entrar no ar: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const hatch = 'repeating-linear-gradient(135deg, #1a1d22 0 22px, #181b20 22px 44px)';
  return (
    <div role="dialog" aria-modal="true" aria-label="Entrar no ar" className="absolute inset-0 z-20 flex flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-6">
        <span className="font-cond text-[20px] font-bold tracking-[0.04em]">ENTRAR NO AR</span>
        <span className="text-muted">sala {roomLabel} · {viewers} {viewers === 1 ? 'pessoa pode' : 'pessoas podem'} assistir</span>
        <button type="button" onClick={onCancel} className="ml-auto h-9 rounded-[6px] border border-line bg-transparent px-3.5 text-[#c5c8ce]">Cancelar</button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[420px_minmax(0,1fr)]">
        <section aria-label="O que transmitir" className="flex flex-col gap-3.5 border-r border-line px-6 py-5">
          <h2 className="label-caps m-0 text-[15px] text-muted">1 · O que transmitir</h2>
          <button type="button" onClick={pickSource} className={`flex flex-col items-start gap-0.5 rounded-[6px] border-2 bg-surface px-3 py-3 text-left text-text ${sourceName ? 'border-live' : 'border-line'}`}>
            <b className="font-semibold">{sourceName ?? 'Escolher tela ou janela'}</b>
            <span className="text-[12px] text-muted">{sourceName ? `${surface} · clique para trocar` : 'Abre o seletor do Windows'}</span>
          </button>
          <label className="flex h-11 items-center gap-2.5 rounded-[6px] border border-line bg-panel px-3 text-muted">
            <input type="checkbox" disabled checked={false} onChange={() => undefined} className="size-[18px] accent-live" />
            <span>Transmitir o som do app <span className="text-faint">· chega na v0.2</span></span>
          </label>
          <div className="relative mt-auto h-[200px] overflow-hidden rounded-[6px] border border-line" style={{ background: hatch }}>
            <span className="label-caps absolute top-2 left-2.5 z-10 text-[13px] text-muted">Prévia</span>
            {stream ? (
              <video ref={video} autoPlay muted playsInline className="size-full object-contain" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center font-cond tracking-[0.05em] text-[#5d6470]">
                {demo ? '[ Counter-Strike 2 ]' : '[ nada escolhido ]'}
              </span>
            )}
          </div>
        </section>

        <section aria-label="Qualidade" className="flex min-w-0 flex-col gap-3.5 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <h2 className="label-caps m-0 text-[15px] text-muted">2 · Qualidade</h2>
            <span className="ml-auto text-[13px] text-muted">
              Teste da máquina:{' '}
              <b className="font-semibold text-text">
                {codecLabel}{codec.hardware ? ' por hardware' : ''} · upload{' '}
                {upload === 'testing' ? 'medindo…' : upload === null ? 'não medido' : `${fmt(upload)} Mbps`}
              </b>
            </span>
            <button type="button" disabled={upload === 'testing'} onClick={() => void runUploadTest()} className="h-8 rounded-[6px] border border-line bg-raised px-3 text-text">
              Refazer teste
            </button>
          </div>
          {upload === null && (
            <p className="m-0 text-[13px] text-danger-text">O teste de upload não respondeu. Os cartões não levam o upload em conta.</p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {cards.map((p) => {
              const selected = p.id === chosen?.id;
              const badge = p.locked ? 'BLOQUEADO' : selected ? 'ESCOLHIDO' : p.recommended ? 'RECOMENDADO' : 'DISPONÍVEL';
              const mbps = p.mbps[codec.codec];
              return (
                <button key={p.id} type="button" disabled={p.locked} aria-pressed={selected} onClick={() => setPicked(p.id)}
                  className={`flex min-h-[176px] flex-col gap-2.5 rounded-[6px] border-2 px-4 py-3.5 text-left text-text ${selected ? 'border-live bg-active' : 'border-line bg-[#15171a]'} ${p.locked ? 'opacity-60' : ''}`}>
                  <span className="flex items-center gap-2">
                    <b className="font-cond text-[26px] font-bold tracking-[0.02em]">{p.height === 2160 ? '4K' : `${p.height}p`}</b>
                    <span className="font-cond text-[18px] font-semibold text-muted">{p.fps} FPS</span>
                    <span className={`label-caps ml-auto rounded px-2 py-0.5 text-[12px] ${selected ? 'bg-live text-bg' : p.recommended ? 'bg-[#2a2347] text-[#cbbdff]' : p.locked ? 'bg-[#24272c] text-muted' : 'bg-[#1f2226] text-muted'}`}>{badge}</span>
                  </span>
                  {p.locked ? (
                    <span className="text-[13px] leading-[1.45] text-[#c5c8ce]">{p.reason}</span>
                  ) : (
                    <>
                      <span className="grid grid-cols-3 gap-2">
                        <Stat label="Usa de upload" value={`${fmt(mbps)} Mbps`} />
                        <Stat label="Codec" value={codecLabel} />
                        <Stat label="Por pessoa" value={`${fmt(gbPerHour(mbps))} GB/h`} />
                      </span>
                      <span className="text-[12px] text-muted">{p.note}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="m-0 text-[12px] text-faint">
            "Por pessoa" é quanto cada amigo que assistir baixa por hora. A carga da placa só aparece na v0.2, com o teste completo.
          </p>
          {error && <p role="alert" className="m-0 text-danger-text">{error}</p>}
        </section>
      </div>

      <footer className="flex h-[76px] shrink-0 items-center gap-4 border-t border-line bg-panel px-6">
        <span className="font-cond text-[15px] tracking-[0.04em] text-muted">
          VAI AO AR: <b className="text-text">{[sourceName ?? 'escolha uma fonte', chosen && presetLabel(chosen), codecLabel].filter(Boolean).join(' · ')}</b> · sem som do app
        </span>
        <button type="button" disabled={busy || !chosen || (!track && !demo)} onClick={() => void start()} className="btn btn-primary ml-auto h-12 px-7 text-[18px] disabled:opacity-50">
          {busy ? 'Conectando…' : 'Entrar no ar'}
        </button>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <b className="text-[16px] font-semibold">{value}</b>
    </span>
  );
}
