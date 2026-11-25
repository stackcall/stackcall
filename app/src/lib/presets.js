// shortcut: 1440p60 stays locked until the P6 test on the home PC proves it, then flip this.
export const P6_1440P60_VALIDATED = false;
export const PRESETS = [
    { id: '720p30', width: 1280, height: 720, fps: 30, mbps: { h264: 2, av1: 1.4 }, note: 'leve, bom para internet fraca' },
    { id: '1080p30', width: 1920, height: 1080, fps: 30, mbps: { h264: 4.5, av1: 3.2 }, note: 'texto e área de trabalho' },
    { id: '1080p60', width: 1920, height: 1080, fps: 60, mbps: { h264: 7, av1: 4.2 }, note: 'jogo com movimento' },
    {
        id: '1440p60', width: 2560, height: 1440, fps: 60, mbps: { h264: 10, av1: 7 }, note: 'mais nitidez, pede mais de quem assiste',
        lockedReason: P6_1440P60_VALIDATED ? undefined : 'Ainda não provado no WebView2. Libera quando o teste no PC de casa passar.',
    },
    { id: '4k30', width: 3840, height: 2160, fps: 30, mbps: { h264: 15, av1: 10.5 }, note: 'filme e série', lockedReason: 'O modo de reserva suporta até 1080p60.' },
    { id: '4k60', width: 3840, height: 2160, fps: 60, mbps: { h264: 25, av1: 18 }, note: 'jogo em 4K', lockedReason: 'O modo de reserva suporta até 1080p60.' },
];
export const resolutionOf = (p) => p.height === 2160 ? '4k' : `${p.height}p`;
export const presetLabel = (p) => `${p.height === 2160 ? '4K' : p.height + 'p'} ${p.fps} fps`;
/** What each viewer downloads per hour, in GB. */
export const gbPerHour = (mbps) => (mbps * 3600) / 8 / 1000;
const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function evaluatePresets({ codec, uploadMbps, sourceHeight, sourceWidth, encoding, trials }) {
    const cards = PRESETS.map((p) => {
        const enc = encoding[p.id];
        let reason;
        let short;
        let trial;
        const lock = (full, brief) => { reason = full; short = brief; };
        if (!trials && p.lockedReason) {
            lock(p.lockedReason, p.height > 1440 ? 'Só no modo nativo' : 'Ainda em teste');
        }
        else if (sourceHeight !== null && sourceHeight < p.height * 0.9) {
            lock(`A fonte escolhida tem ${sourceHeight} linhas. Escolha uma tela maior para ${p.height}p.`, `Fonte com ${sourceHeight} linhas`);
        }
        else if (sourceWidth !== undefined && sourceWidth < p.width * 0.9) {
            lock(`A fonte escolhida tem ${sourceWidth} pixels de largura. Escolha uma tela maior.`, `Fonte com ${sourceWidth} px de largura`);
        }
        else if (trials) {
            const label = codec === 'av1' ? 'AV1' : 'H.264';
            const matching = trials.filter((t) => t.ok && t.encoder.startsWith(codec + '_')
                && t.resolution === resolutionOf(p) && t.target_fps === p.fps);
            const smooth = matching.filter((t) => (t.fps ?? 0) >= p.fps * 0.95);
            trial = smooth.find((t) => (t.encoder_load_percent ?? Infinity) <= 80);
            if (!matching.length)
                lock(`A GPU não conseguiu codificar ${presetLabel(p)} em ${label}.`, `Placa não codifica em ${label}`);
            else if (!smooth.length)
                lock(`A GPU não sustentou ${p.fps} fps neste preset.`, `Placa não sustenta ${p.fps} fps`);
            else if (!trial)
                lock('O preset ultrapassa 80% de carga estimada do codificador.', 'Placa acima de 80% de carga');
            if (!reason && uploadMbps === null)
                lock('Meça o upload para liberar este preset.', 'Falta medir o upload');
        }
        else if (enc && (!enc.supported || !enc.smooth)) {
            lock(`O WebView2 desta máquina não segura ${presetLabel(p)} em ${codec === 'av1' ? 'AV1' : 'H.264'}.`, 'WebView2 não segura');
        }
        // Single headroom (hotfix 0.3.1): 80% of the measured upload must cover 1.5x the bitrate plus audio.
        const requiredMbps = p.mbps[codec] * 1.5 + 0.3;
        if (!reason && uploadMbps !== null && uploadMbps * 0.8 < requiredMbps) {
            lock(`Seu upload medido (${fmt(uploadMbps)} Mb/s) não sustenta este preset. Ele pede cerca de ${fmt(requiredMbps)} Mb/s com folga.`, `Pede ${fmt(requiredMbps / 0.8)} Mb/s · seu upload ${fmt(uploadMbps)}`);
        }
        return { ...p, locked: !!reason, reason, short, recommended: false, trial };
    });
    const best = cards.filter((c) => !c.locked && c.height <= 1080).at(-1);
    if (best)
        best.recommended = true;
    return cards;
}
