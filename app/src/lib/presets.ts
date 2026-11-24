import type { Trial } from './sidecar';

export type Codec = 'av1' | 'h264';

export type Preset = {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** Target bitrate in Mbit/s, H.264 / AV1 (docs/PLANO.md, 3.2). */
  mbps: Record<Codec, number>;
  /** Upload needed with headroom, Mbit/s. */
  uploadNeeded: number;
  note: string;
  /** Locked for everyone in this version, with the reason. */
  lockedReason?: string;
};

// shortcut: 1440p60 stays locked until the P6 test on the home PC proves it, then flip this.
export const P6_1440P60_VALIDATED = false;

export const PRESETS: Preset[] = [
  { id: '720p30', width: 1280, height: 720, fps: 30, mbps: { h264: 2, av1: 1.4 }, uploadNeeded: 5, note: 'leve, bom para internet fraca' },
  { id: '1080p30', width: 1920, height: 1080, fps: 30, mbps: { h264: 4.5, av1: 3.2 }, uploadNeeded: 12, note: 'texto e área de trabalho' },
  { id: '1080p60', width: 1920, height: 1080, fps: 60, mbps: { h264: 7, av1: 4.2 }, uploadNeeded: 16, note: 'jogo com movimento' },
  {
    id: '1440p60', width: 2560, height: 1440, fps: 60, mbps: { h264: 10, av1: 7 }, uploadNeeded: 26, note: 'mais nitidez, pede mais de quem assiste',
    lockedReason: P6_1440P60_VALIDATED ? undefined : 'Ainda não provado no WebView2. Libera quando o teste no PC de casa passar.',
  },
  { id: '4k30', width: 3840, height: 2160, fps: 30, mbps: { h264: 15, av1: 10.5 }, uploadNeeded: 40, note: 'filme e série', lockedReason: 'O modo de reserva suporta até 1080p60.' },
  { id: '4k60', width: 3840, height: 2160, fps: 60, mbps: { h264: 25, av1: 18 }, uploadNeeded: 65, note: 'jogo em 4K', lockedReason: 'O modo de reserva suporta até 1080p60.' },
];

export const resolutionOf = (p: Preset) => p.height === 2160 ? '4k' : `${p.height}p`;
export const presetLabel = (p: Preset) => `${p.height === 2160 ? '4K' : p.height + 'p'} ${p.fps} fps`;

/** What each viewer downloads per hour, in GB. */
export const gbPerHour = (mbps: number) => (mbps * 3600) / 8 / 1000;

export type Encoding = { supported: boolean; smooth: boolean };

export type PresetInput = {
  codec: Codec;
  /** Measured upload in Mbit/s; null = not measured. */
  uploadMbps: number | null;
  /** Height the chosen source can deliver; null = nothing chosen yet. */
  sourceHeight: number | null;
  sourceWidth?: number;
  /** MediaCapabilities result per preset; missing = not checked. */
  encoding: Record<string, Encoding>;
  trials?: Trial[];
};

export type PresetCard = Preset & { locked: boolean; reason?: string; recommended: boolean; trial?: Trial };

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function evaluatePresets({ codec, uploadMbps, sourceHeight, sourceWidth, encoding, trials }: PresetInput): PresetCard[] {
  const cards = PRESETS.map((p): PresetCard => {
    const enc = encoding[p.id];
    let reason: string | undefined;
    let trial: Trial | undefined;
    if (trials) {
      const label = codec === 'av1' ? 'AV1' : 'H.264';
      const matching = trials.filter((t) => t.ok && t.encoder.startsWith(codec + '_')
        && t.resolution === resolutionOf(p) && t.target_fps === p.fps);
      const smooth = matching.filter((t) => (t.fps ?? 0) >= p.fps * 0.95);
      trial = smooth.find((t) => (t.encoder_load_percent ?? Infinity) <= 80);
      if (!matching.length) reason = `A GPU não conseguiu codificar ${presetLabel(p)} em ${label}.`;
      else if (!smooth.length) reason = `A GPU não sustentou ${p.fps} fps neste preset.`;
      else if (!trial) reason = 'O preset ultrapassa 80% de carga estimada do codificador.';
      if (!reason && uploadMbps === null) reason = 'Meça o upload para liberar este preset.';
    } else {
      reason = p.lockedReason;
    }
    if (!trials && !reason && enc && (!enc.supported || !enc.smooth)) {
      reason = `O WebView2 desta máquina não segura ${presetLabel(p)} em ${codec === 'av1' ? 'AV1' : 'H.264'}.`;
    }
    if (!reason && uploadMbps !== null && uploadMbps * 0.5 < p.uploadNeeded) {
      reason = `Seu upload medido (${fmt(uploadMbps)} Mbps) não sustenta este preset. Ele pede cerca de ${p.uploadNeeded} Mbps com folga.`;
    }
    if (!reason && sourceHeight !== null && sourceHeight < p.height * 0.9) {
      reason = `A fonte escolhida tem ${sourceHeight} linhas. Escolha uma tela maior para ${p.height}p.`;
    }
    if (!reason && sourceWidth !== undefined && sourceWidth < p.width * 0.9) {
      reason = `A fonte escolhida tem ${sourceWidth} pixels de largura. Escolha uma tela maior.`;
    }
    return { ...p, locked: !!reason, reason, recommended: false, trial };
  });
  const best = cards.filter((c) => !c.locked && c.height <= 1080).at(-1);
  if (best) best.recommended = true;
  return cards;
}
