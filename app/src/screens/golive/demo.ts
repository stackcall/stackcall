import type { CaptureSource, Trial } from '../../lib/sidecar';

/** Fake screens and windows for the demo server (`?demo=1&tela=ar`), so the native layout can be reviewed in a browser. */
function thumb(width: number, height: number, fill: string, label: string) {
  if (typeof document === 'undefined' || navigator.userAgent.includes('jsdom')) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = Math.round((320 * height) / width);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = fill;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, canvas.height - 40, canvas.width, 40);
    g.fillStyle = '#f4f4f1';
    g.font = 'bold 18px sans-serif';
    g.fillText(label, 14, canvas.height - 14);
    return canvas.toDataURL('image/png').split(',')[1] ?? null;
  } catch {
    return null;
  }
}

const source = (id: string, title: string, process_name: string | null, width: number, height: number, fill: string, extra: Partial<CaptureSource> = {}): CaptureSource => ({
  id, title, process_name, pid: process_name ? 1000 + id.length : null, width, height, minimized: false,
  thumbnail: thumb(width, height, fill, title), ...extra,
});

export const demoSources = (): CaptureSource[] => [
  source('hmonitor:1', 'Tela 1', null, 3840, 2160, '#23384f', { primary: true }),
  source('hmonitor:2', 'Tela 2', null, 1920, 1080, '#3b2f4a'),
  source('hwnd:1:1', 'Counter-Strike 2', 'cs2.exe', 1920, 1080, '#5a4a1f'),
  source('hwnd:2:2', 'Firefox — vídeo da galera', 'firefox.exe', 1600, 900, '#2f4a3a'),
  source('hwnd:3:3', 'Visual Studio Code', 'Code.exe', 1920, 1040, '#1e2a38'),
  source('hwnd:4:4', 'Spotify', 'Spotify.exe', 1280, 800, '#1f3d2b'),
  source('hwnd:5:5', 'Configurações', 'SystemSettings.exe', 1100, 760, '#3a3a40'),
  source('hwnd:6:6', 'Configurações', 'SystemSettings.exe', 1100, 760, '#3a3a40'),
  source('hwnd:7:7', 'Explorador de Arquivos', 'explorer.exe', 1200, 700, '#40382c'),
];

const LOAD: Record<string, number> = { '720p': 18, '1080p': 31, '1440p': 52, '4k': 62 };
/** An RTX-class result: everything passes except 4K60, which goes over 80% of the encoder. */
export const demoTrials: Trial[] = Object.keys(LOAD).flatMap((resolution) => [30, 60].map((target_fps) => ({
  encoder: 'av1_nvenc', resolution, target_fps, ok: true, fps: target_fps,
  encoder_load_percent: Math.round(LOAD[resolution] * (target_fps === 60 ? 1.5 : 1)),
})));
