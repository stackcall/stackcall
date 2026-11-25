import { PRESETS } from './presets';
const MIME = { av1: 'video/AV1', h264: 'video/H264' };
function contentType(codec) {
    const rtp = RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
    const match = rtp.find((c) => c.mimeType.toLowerCase() === MIME[codec].toLowerCase());
    if (!match)
        return null;
    return match.sdpFmtpLine ? `${MIME[codec]};${match.sdpFmtpLine}` : MIME[codec];
}
async function info(codec, width, height, framerate, mbps) {
    const type = contentType(codec);
    if (!type)
        return null;
    try {
        return await navigator.mediaCapabilities.encodingInfo({
            type: 'webrtc',
            video: { contentType: type, width, height, framerate, bitrate: mbps * 1e6 },
        });
    }
    catch {
        return null;
    }
}
/** AV1 when the WebView2 offers it for sending and reports hardware encoding (powerEfficient); else H.264. */
export async function pickCodec() {
    const av1 = await info('av1', 1920, 1080, 60, 4.2);
    if (av1?.supported && av1.powerEfficient)
        return { codec: 'av1', hardware: true };
    const h264 = await info('h264', 1920, 1080, 60, 7);
    return { codec: 'h264', hardware: !!h264?.powerEfficient };
}
/** What the WebView2 says it can encode, per preset. Presets it cannot answer for stay unchecked. */
export async function checkPresets(codec) {
    const result = {};
    for (const p of PRESETS) {
        const r = await info(codec, p.width, p.height, p.fps, p.mbps[codec]);
        if (r)
            result[p.id] = { supported: r.supported, smooth: r.smooth };
    }
    return result;
}
