import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { uploadGuardado, uploadMedido } from '../lib/servidor';
import { store } from '../lib/config';
import { checkPresets, pickCodec } from '../lib/encoder';
import { evaluatePresets, gbPerHour, presetLabel } from '../lib/presets';
import { listSources, probeMachine, savedProbe } from '../lib/sidecar';
import { Fontes, initialSource } from './golive/Fontes';
import { demoSources, demoTrials } from './golive/demo';
/** Same text as `UNAVAILABLE` in app/src-tauri/src/sidecar.rs: the core is missing on this machine. */
const CORE_MISSING = 'O núcleo de transmissão não está disponível nesta máquina.';
const fmt = (n, d = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
const message = (e) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
const SURFACE = { monitor: 'tela inteira', window: 'janela', browser: 'aba' };
const fmtRes = (p) => (p.height === 2160 ? '4K' : `${p.height}p`);
/** The probe must hold 720p30 by hardware before the native mode is offered. */
const baseline = (trials) => trials.filter((t) => t.ok && t.resolution === '720p'
    && (t.fps ?? 0) >= 28.5 && (t.encoder_load_percent ?? Infinity) <= 80);
function readJson(key) {
    try {
        return JSON.parse(store.get(key) ?? 'null');
    }
    catch {
        return null;
    }
}
export function GoLive({ demo, server, roomLabel, viewers, onCancel, onStart, onNativeStart, fallback, confirmar = 0 }) {
    const canNative = demo || (isTauri() && !!onNativeStart);
    const [reserva, setReserva] = useState(() => fallback ? 'A transmissão nativa falhou nesta sessão.' : canNative ? null : '');
    const native = canNative && reserva === null;
    const [upload, setUpload] = useState(() => (demo ? 30 : uploadGuardado(server) ?? 'testing'));
    const [webCodec, setWebCodec] = useState({ codec: 'h264', hardware: false });
    const [encoding, setEncoding] = useState({});
    const [stream, setStream] = useState(null);
    const [picked, setPicked] = useState(() => store.get('preset'));
    const [error, setError] = useState();
    const [busy, setBusy] = useState(false);
    const [sources, setSources] = useState();
    const [loadingSources, setLoadingSources] = useState(false);
    const [source, setSource] = useState();
    // Saved GPU test: shown at once, checked against the core after the sources load.
    const [trials, setTrials] = useState(() => (demo ? demoTrials : savedProbe()?.trials));
    const [gpu, setGpu] = useState(() => (demo ? undefined : savedProbe() ?? undefined));
    const [testing, setTesting] = useState(false);
    const [audio, setAudio] = useState(() => store.get('somDoJogo') !== '0');
    const video = useRef(null);
    const dialog = useRef(null);
    const search = useRef(null);
    const started = useRef(false);
    async function runUpload(refazer = false) {
        if (demo)
            return;
        setUpload('testing');
        setUpload(await uploadMedido(server, refazer));
    }
    async function loadSources() {
        setLoadingSources(true);
        try {
            const next = demo ? demoSources() : await listSources();
            setSources(next);
            setSource((current) => next.find((s) => s.id === current?.id)
                ?? initialSource(next, current ?? readJson('fonte')));
        }
        finally {
            setLoadingSources(false);
        }
    }
    async function runProbe(force) {
        if (demo)
            return;
        setTesting(true);
        try {
            const result = await probeMachine(force);
            if (!baseline(result.trials).length)
                throw new Error('a placa não sustentou 720p30 por hardware');
            setTrials(result.trials);
            setGpu({ gpu: result.gpu, at: result.at });
        }
        catch (e) {
            setReserva(`O teste da placa falhou: ${message(e)}.`);
        }
        finally {
            setTesting(false);
        }
    }
    useEffect(() => {
        dialog.current?.focus();
        if (upload === 'testing')
            void runUpload();
    }, []);
    // Native: list the sources (thumbnails) first, then check the GPU; never both at once.
    useEffect(() => {
        if (!native)
            return;
        let current = true;
        void (async () => {
            try {
                await loadSources();
            }
            catch (e) {
                if (current)
                    setReserva(`O núcleo não listou as telas: ${message(e)}.`);
                return;
            }
            if (current)
                await runProbe(false);
        })();
        return () => { current = false; };
    }, [native]);
    useEffect(() => {
        if (demo || native)
            return;
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
        if (!started.current)
            stream?.getTracks().forEach((t) => t.stop());
    }, [stream]);
    useEffect(() => {
        if (video.current)
            video.current.srcObject = stream;
    }, [stream]);
    const track = stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.();
    const nativeCodec = trials && baseline(trials).some((t) => t.encoder.startsWith('av1_')) ? 'av1' : 'h264';
    const codec = native ? { codec: nativeCodec, hardware: true } : demo ? { codec: 'av1', hardware: true } : webCodec;
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
    const withAudio = native && !!source?.pid && audio;
    const canStart = !busy && !!chosen && (native ? !!source && !testing : !!track || demo);
    function pick(next) {
        setSource(next);
        store.set('fonte', JSON.stringify({ process_name: next.process_name, title: next.title }));
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
        }
        catch (e) {
            if (e?.name !== 'NotAllowedError')
                setError({ text: `Não deu para capturar a tela: ${message(e)}.`, retry: () => void pickSource() });
        }
    }
    async function start() {
        if (!canStart || !chosen)
            return;
        if (demo)
            return onCancel();
        setBusy(true);
        setError(undefined);
        try {
            if (native && source && onNativeStart) {
                await onNativeStart(source, chosen, codec.codec, withAudio);
            }
            else if (track) {
                started.current = true;
                await onStart(track, chosen, codec.codec);
            }
        }
        catch (e) {
            started.current = false;
            // Only a missing core sends the user to the WebView2 mode; anything else can be retried here.
            if (native && message(e) === message(CORE_MISSING))
                setReserva(`${CORE_MISSING}`);
            else
                setError({ text: `Não deu para entrar no ar: ${message(e)}.`, retry: () => void start() });
        }
        finally {
            setBusy(false);
        }
    }
    // Second press of the global shortcut: start with what is chosen (start() checks canStart).
    const startRef = useRef(start);
    startRef.current = start;
    useEffect(() => {
        if (confirmar > 0)
            void startRef.current();
    }, [confirmar]);
    function onKey(event) {
        if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onCancel();
        }
        else if (event.key === 'f' && (event.ctrlKey || event.metaKey) && native) {
            event.preventDefault();
            search.current?.focus();
        }
        else if (event.key === 'Enter' && event.target === dialog.current) {
            event.preventDefault();
            void start();
        }
    }
    function redo() {
        setError(undefined);
        void runUpload(true);
        if (native)
            void runProbe(true);
    }
    const gpuLoad = chosen?.trial?.encoder_load_percent ?? null;
    const uploadText = upload === 'testing' ? 'medindo…' : upload === null ? 'sem resposta' : _jsxs(_Fragment, { children: [fmt(upload), " ", _jsx(Unit, { children: "Mb/s" })] });
    const encoderText = native && testing && !trials ? 'testando a placa…' : `${codecLabel}${codec.hardware ? ' por hardware' : ''}`;
    const testedAt = gpu ? new Date(gpu.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;
    const preview = native ? source : null;
    return (_jsxs("div", { ref: dialog, role: "dialog", "aria-modal": "true", "aria-label": "Entrar no ar", tabIndex: -1, onKeyDown: onKey, className: "absolute inset-0 z-20 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4 bg-fundo pt-5 outline-none", children: [_jsxs("header", { className: "flex min-w-0 flex-wrap items-end gap-x-6 gap-y-1 px-8", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("span", { className: "rotulo", children: ["/ Sala ", roomLabel, " \u00B7 ", viewers === 0 ? 'ninguém na sala ainda' : `${viewers} ${viewers === 1 ? 'pessoa pode' : 'pessoas podem'} assistir`] }), _jsx("h1", { className: "text-[56px] leading-[0.9]", children: "Entrar no ar" })] }), _jsx("p", { className: "m-0 min-w-0 flex-1 truncate pb-1 text-[14px] text-texto-fraco", children: "Escolha a fonte e a qualidade. Os n\u00FAmeros v\u00EAm do teste da sua placa e da sua internet." })] }), _jsxs("div", { className: "grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 px-8", children: [native ? (_jsx(Fontes, { sources: sources, loading: loadingSources, selected: source?.id, disabled: busy, refreshDisabled: testing || busy, searchRef: search, onSelect: pick, onEnter: () => void start(), onRefresh: () => void loadSources().catch((e) => setError({ text: `Não deu para atualizar a lista: ${message(e)}.` })) })) : (_jsxs("section", { "aria-label": "Fonte", className: "janela flex min-h-0 min-w-0 flex-col", children: [_jsx("div", { className: "barra", children: "Fonte \u00B7 modo de reserva" }), _jsxs("button", { type: "button", onClick: pickSource, disabled: busy, className: "flex min-h-0 flex-1 flex-col border-0 bg-superficie p-0 text-left hover:bg-superficie-alta", children: [_jsx("span", { className: "relative flex min-h-0 w-full flex-1 items-center justify-center bg-palco", children: stream ? _jsx("video", { ref: video, autoPlay: true, muted: true, playsInline: true, className: "absolute inset-0 size-full object-contain" })
                                            : _jsx("span", { className: "text-[13px] text-[#b3b3ab]", children: "Abre o seletor do Windows" }) }), _jsxs("span", { className: "flex w-full flex-col border-t border-texto px-3 py-2.5", children: [_jsx("b", { className: "text-[14px]", children: sourceName ?? 'Escolher tela ou janela' }), _jsx("span", { className: "text-[12px] text-texto-fraco", children: sourceName ? `${surface} · clique para trocar` : 'O Windows mostra as telas e janelas' })] })] })] })), _jsxs("section", { "aria-label": "Qualidade", className: "flex min-h-0 min-w-0 flex-col gap-3", children: [native && (_jsxs("div", { className: "janela flex min-h-[28px] flex-[1_1_0] flex-col [@media(max-height:820px)]:hidden", children: [_jsxs("div", { className: "barra", children: ["Pr\u00E9via", _jsx("span", { className: "min-w-0 truncate font-medium normal-case", children: preview ? `· ${preview.title}` : '' }), preview?.width && preview.height ? _jsxs("span", { className: "ml-auto", children: [preview.width, "\u00D7", preview.height] }) : null] }), _jsx("div", { className: "relative min-h-0 flex-1 bg-palco [container-type:size]", children: _jsx("div", { className: "absolute inset-0 flex items-center justify-center [@container(max-height:72px)]:hidden", children: preview?.thumbnail && !preview.minimized
                                                ? _jsx("img", { alt: `Prévia de ${preview.title}`, className: "size-full object-contain", src: `data:image/png;base64,${preview.thumbnail}` })
                                                : _jsx("span", { className: "text-[13px] text-[#b3b3ab]", children: preview?.minimized ? 'Janela minimizada: volte ao jogo antes de entrar no ar' : preview ? 'Sem prévia desta fonte' : 'Escolha uma fonte à esquerda' }) }) })] })), _jsxs("div", { className: "janela flex shrink-0 flex-col [@media(max-height:820px)]:flex-1", children: [_jsxs("div", { className: "barra barra-lima", children: ["Qualidade escolhida", _jsxs("span", { className: "ml-auto truncate font-medium", children: ["upload ", uploadText, " \u00B7 ", encoderText] })] }), chosen ? (_jsxs("div", { className: "flex flex-1 items-center gap-5 px-4 py-3 [@media(max-height:760px)]:py-2", children: [_jsxs("div", { className: "relative shrink-0 pr-[4.5rem]", children: [_jsx("b", { className: "block font-display text-[76px] leading-[0.9] tabular-nums [@media(max-height:820px)]:text-[60px]", children: fmtRes(chosen) }), _jsxs("span", { className: "absolute right-0 bottom-0 -rotate-6 font-pincel text-[24px] text-destaque", children: [chosen.fps, " fps"] })] }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-2", children: [_jsxs("div", { className: "grid grid-cols-3 border border-texto", children: [_jsx(Stat, { label: "upload", value: fmt(chosen.mbps[codec.codec]), unit: "Mb/s" }), _jsx(Stat, { label: "placa", value: gpuLoad !== null ? `${fmt(gpuLoad, 0)}%` : codecLabel }), _jsx(Stat, { label: "por pessoa/h", value: fmt(gbPerHour(chosen.mbps[codec.codec])), unit: "GB" })] }), gpuLoad !== null && (_jsx("span", { className: "flex h-2 gap-0.5", role: "meter", "aria-label": "Carga da placa de v\u00EDdeo", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(gpuLoad), children: Array.from({ length: 20 }, (_, k) => (_jsx("i", { className: `flex-1 ${k < Math.round(gpuLoad / 5) ? (k >= 16 ? 'bg-destaque' : 'bg-texto') : 'bg-superficie-topo'}` }, k))) })), _jsx("span", { className: "truncate text-[13px] text-texto-fraco [@media(max-height:760px)]:hidden", children: chosen.note })] })] })) : (_jsx("div", { className: "flex min-h-[96px] flex-1 items-center px-4 py-3", children: native && !trials ? _jsx("span", { className: "skeleton h-16 w-full", "aria-label": "Testando a placa de v\u00EDdeo" })
                                            : _jsx("span", { className: "text-[14px] text-texto-fraco", children: "Nenhum preset liberado para esta fonte. Escolha outra fonte ou refa\u00E7a o teste." }) }))] }), _jsxs("div", { className: "janela flex min-h-[100px] shrink flex-col", children: [_jsxs("div", { className: "barra", children: ["Presets", gpu?.gpu && _jsxs("span", { className: "min-w-0 truncate font-medium normal-case opacity-75", children: ["\u00B7 ", gpu.gpu.name, testedAt ? `, teste de ${testedAt}` : ''] }), _jsx("button", { type: "button", disabled: upload === 'testing' || testing || busy || loadingSources || demo, onClick: redo, className: "ml-auto shrink-0 border-0 bg-transparent font-mono text-[11px] font-bold text-superficie uppercase underline disabled:opacity-50", children: testing ? 'Testando…' : 'Refazer teste' })] }), _jsxs("div", { role: "radiogroup", "aria-label": "Presets de qualidade", className: "min-h-0 overflow-y-auto", children: [native && !trials && [0, 1, 2].map((n) => _jsx("span", { className: "skeleton m-2 block h-7" }, n)), cards.map((p) => {
                                                const selected = p.id === chosen?.id;
                                                const tag = p.locked ? 'travado' : selected ? 'escolhido' : p.recommended ? 'recomendado' : '';
                                                return (_jsxs("button", { type: "button", role: "radio", "aria-checked": selected, disabled: p.locked || busy, title: p.reason, onClick: () => { setPicked(p.id); store.set('preset', p.id); }, className: `grid h-11 w-full [@media(max-height:760px)]:h-10 grid-cols-[60px_44px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-texto px-3.5 text-left first:border-t-0 ${selected ? 'bg-texto text-superficie' : 'bg-superficie hover:bg-superficie-alta disabled:hover:bg-superficie'} ${p.locked ? 'text-texto-fraco' : ''}`, children: [_jsx("b", { className: `font-display text-[22px] tabular-nums ${p.locked ? 'line-through' : ''}`, children: fmtRes(p) }), _jsxs("span", { className: `rotulo ${selected ? 'text-superficie opacity-75' : ''}`, children: [p.fps, " fps"] }), _jsx("span", { className: "truncate text-[13px]", children: p.locked ? p.short ?? p.reason : `${fmt(p.mbps[codec.codec])} Mb/s · ${fmt(gbPerHour(p.mbps[codec.codec]))} GB/h por pessoa${p.trial ? ` · placa ${fmt(p.trial.encoder_load_percent ?? 0, 0)}%` : ''}` }), _jsx("span", { className: `rotulo text-[10px] ${selected ? 'text-superficie opacity-75' : ''}`, children: tag })] }, p.id));
                                            })] })] })] })] }), _jsxs("footer", { className: "flex flex-col", children: [reserva !== null && (_jsxs("div", { role: "status", className: "flex min-h-9 items-center gap-3 border-t border-texto bg-superficie-alta px-8 py-1.5 text-[13px]", children: [_jsx("b", { className: "shrink-0", children: "Modo de reserva (WebView2)" }), _jsxs("span", { className: "min-w-0 flex-1 truncate text-texto-fraco", title: reserva, children: [reserva || 'Transmissão nativa só no app instalado.', " Vai at\u00E9 1080p60."] }), canNative && (_jsx("button", { type: "button", className: "shrink-0 border-0 bg-transparent p-0 text-[13px] font-bold underline", disabled: busy, onClick: () => { setError(undefined); setReserva(null); }, children: "Tentar o modo nativo" }))] })), error && (_jsxs("div", { role: "alert", className: "flex min-h-9 items-center gap-3 border-t border-perigo bg-destaque-fraco px-8 py-1.5 text-[13px] text-perigo", children: [_jsx("span", { className: "min-w-0 flex-1 truncate", title: error.text, children: error.text }), error.retry && (_jsx("button", { type: "button", className: "shrink-0 border-0 bg-transparent p-0 text-[13px] font-bold text-perigo underline", disabled: busy, onClick: error.retry, children: "Tentar de novo" }))] })), _jsxs("div", { className: "flex h-[72px] items-center gap-3 border-t border-texto bg-superficie px-8", children: [_jsxs("span", { className: "min-w-0 flex-1 truncate text-[14px] text-texto-fraco", children: ["Vai transmitir ", _jsx("b", { className: "text-texto", children: sourceName ?? 'nenhuma fonte' }), chosen && _jsxs(_Fragment, { children: [" em ", _jsx("b", { className: "text-texto", children: presetLabel(chosen) })] }), ", ", withAudio ? 'com' : 'sem', " som do jogo."] }), _jsx("span", { className: "shrink-0 text-[13px] font-bold", id: "som-do-jogo", children: "Som do jogo" }), _jsx("div", { className: "abas shrink-0", role: "group", "aria-labelledby": "som-do-jogo", title: native && source?.pid ? `Só o áudio de ${source.process_name ?? source.title}. Voz e música ficam fora.` : 'Só em janela de jogo ou programa', children: [true, false].map((on) => (_jsx("button", { type: "button", "aria-pressed": withAudio === on, disabled: !native || !source?.pid || busy, onClick: () => { setAudio(on); store.set('somDoJogo', on ? '1' : '0'); }, children: on ? 'Ligado' : 'Desligado' }, String(on)))) }), _jsx("button", { type: "button", className: "btn btn-lg", disabled: busy, onClick: onCancel, children: "Cancelar" }), _jsxs("button", { type: "button", className: "btn btn-prim btn-lg", disabled: !canStart, onClick: () => void start(), children: [_jsx("span", { "aria-hidden": "true", className: "size-2 bg-sobre-destaque" }), busy ? 'Conectando…' : 'Entrar no ar'] })] })] })] }));
}
function Stat({ label, value, unit }) {
    return (_jsxs("span", { className: "flex min-w-0 flex-col px-3 py-1.5 [&+&]:border-l [&+&]:border-texto", children: [_jsx("span", { className: "rotulo truncate text-[10px]", children: label }), _jsxs("b", { className: "font-display text-[26px] leading-none tabular-nums", children: [value, unit && _jsx(Unit, { className: "ml-1 text-[11px] text-texto-fraco", children: unit })] })] }));
}
/** Units keep their case ("Mb/s", not "MB/S") inside uppercase labels and title bars. */
function Unit({ children, className = '' }) {
    return _jsx("span", { className: `font-mono normal-case ${className}`, children: children });
}
