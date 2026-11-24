import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Room, Track } from 'livekit-client';

const codecs = ['H264', 'VP9', 'AV1', 'H265'];

function App() {
  const [stream, setStream] = useState<MediaStream>();
  const [capture, setCapture] = useState('Aguardando teste.');
  const [fps, setFps] = useState<number>();
  const [codecReport, setCodecReport] = useState('');
  const [sendReport, setSendReport] = useState('');
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const url = useRef<HTMLInputElement>(null);
  const token = useRef<HTMLInputElement>(null);
  const room = useRef<Room | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = video.current!;
    element.srcObject = stream ?? null;
    if (!stream) return;
    let callback: number;
    let start: number | undefined;
    let frames = 0;
    const count: VideoFrameRequestCallback = (now, frame) => {
      if (start === undefined) {
        start = now;
        frames = frame.presentedFrames;
      } else if (now - start >= 1000) {
        setFps((frame.presentedFrames - frames) * 1000 / (now - start));
        start = now;
        frames = frame.presentedFrames;
      }
      callback = element.requestVideoFrameCallback(count);
    };
    callback = element.requestVideoFrameCallback(count);
    return () => element.cancelVideoFrameCallback(callback);
  }, [stream]);

  async function disconnect() {
    window.clearInterval(timer.current);
    const connected = room.current;
    room.current = null;
    await connected?.disconnect(false);
    setPublished(false);
  }

  async function stopCapture(source: MediaStream) {
    source.getTracks().forEach(track => track.stop());
    setStream(undefined);
    setFps(undefined);
    setCapture('Captura encerrada.');
    await disconnect();
  }

  async function startCapture() {
    setBusy(true);
    setCapture('Solicitação enviada. Se o seletor aparecer, escolha uma fonte.');
    try {
      const source = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 3840, height: 2160, frameRate: 60 },
        audio: true,
      });
      const track = source.getVideoTracks()[0];
      track.addEventListener('ended', () => void stopCapture(source), { once: true });
      setStream(source);
      setCapture(JSON.stringify({ video: track.getSettings(), audioTracks: source.getAudioTracks().length }, null, 2));
    } catch (error) {
      setCapture(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function probeCodecs() {
    const rtp = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const results = await Promise.all(codecs.map(async name => {
      const mime = 'video/' + name;
      const match = rtp.find(codec => codec.mimeType.toLowerCase() === mime.toLowerCase());
      const contentType = match?.sdpFmtpLine ? mime + ';' + match.sdpFmtpLine : mime;
      try {
        const { supported, smooth, powerEfficient } = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 60 },
        });
        return { name, advertised: !!match, contentType, supported, smooth, powerEfficient };
      } catch (error) {
        return { name, advertised: !!match, contentType, error: String(error) };
      }
    }));
    setCodecReport(JSON.stringify({ rtp: [...new Set(rtp.map(codec => codec.mimeType))], results }, null, 2));
  }

  async function publish(height: number) {
    const source = stream!;
    const width = height === 1080 ? 1920 : 2560;
    const maxBitrate = height === 1080 ? 8_000_000 : 10_000_000;
    const next = new Room();
    room.current = next;
    setBusy(true);
    setSendReport('Conectando…');
    try {
      const videoTrack = source.getVideoTracks()[0];
      await videoTrack.applyConstraints({ width: { ideal: width, max: width }, height: { ideal: height, max: height }, frameRate: { ideal: 60, max: 60 } });
      setCapture(JSON.stringify({ video: videoTrack.getSettings(), audioTracks: source.getAudioTracks().length }, null, 2));
      await next.connect(url.current!.value.trim(), token.current!.value.trim());
      if (room.current !== next) {
        await next.disconnect(false);
        return;
      }
      const publication = await next.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare, simulcast: false, videoCodec: 'h264',
        screenShareEncoding: { maxBitrate, maxFramerate: 60 },
      });
      for (const track of source.getAudioTracks()) {
        await next.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio });
      }
      if (room.current !== next) {
        await next.disconnect(false);
        return;
      }
      setPublished(true);
      setSendReport('Publicado. Aguardando amostras do RTP…');
      let previous: { bytesSent: number; timestamp: number; framesEncoded: number } | undefined;
      timer.current = window.setInterval(async () => {
        try {
          const stats = await publication.videoTrack?.getRTCStatsReport();
          if (room.current !== next) return;
          stats?.forEach(stat => {
            if (stat.type !== 'outbound-rtp' || stat.kind !== 'video') return;
            const elapsed = previous ? (stat.timestamp - previous.timestamp) / 1000 : 0;
            const bitrate = elapsed > 0 ? (stat.bytesSent - previous!.bytesSent) * 8 / elapsed : null;
            const fps = stat.framesPerSecond ?? (elapsed > 0 ? (stat.framesEncoded - previous!.framesEncoded) / elapsed : null);
            previous = stat;
            setSendReport(JSON.stringify({
              width: stat.frameWidth, height: stat.frameHeight, fps, bitrate,
              qualityLimitationReason: stat.qualityLimitationReason,
              codec: stats.get(stat.codecId)?.mimeType,
            }, null, 2));
          });
        } catch (error) {
          setSendReport(String(error));
        }
      }, 1000);
    } catch (error) {
      setSendReport('Falha na publicação (' + (error instanceof Error ? error.name : 'erro') + '). Confira a URL, o token e as condições da captura.');
      if (room.current === next) await disconnect();
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ fontFamily: 'system-ui', maxWidth: 840, margin: 'auto', padding: 16 }}>
    <h1>Stackcall P6 · WebView2</h1>
    <h2>1. Captura</h2>
    <button disabled={busy || !!stream} onClick={startCapture}>Solicitar captura 4K60 com áudio</button>{' '}
    <button disabled={busy || !stream} onClick={() => stream && void stopCapture(stream)}>Encerrar captura</button>
    <pre role="status" style={{ whiteSpace: 'pre-wrap' }}>{capture}</pre>
    <h2>2. Prévia</h2>
    <video ref={video} autoPlay muted playsInline aria-label="Prévia da captura" style={{ width: '100%', maxHeight: 320, background: '#222' }} />
    <div>FPS exibidos: {fps?.toFixed(1) ?? '—'}</div>
    <h2>3. Codecs de envio · 1080p60</h2>
    <button onClick={probeCodecs}>Consultar codecs</button>
    <pre role="status">{codecReport}</pre>
    <h2>4. Publicação no LiveKit</h2>
    <p><label>URL <input type="url" ref={url} placeholder="wss://…" /></label>{' '}
    <label>Token <input type="password" ref={token} autoComplete="off" /></label></p>
    <button disabled={busy || published || !stream} onClick={() => publish(1080)}>Publicar 1080p60</button>{' '}
    <button disabled={busy || published || !stream} onClick={() => publish(1440)}>Publicar 1440p60</button>{' '}
    <button disabled={busy || !published} onClick={() => void disconnect()}>Desconectar</button>
    <pre role="status">{sendReport}</pre>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
