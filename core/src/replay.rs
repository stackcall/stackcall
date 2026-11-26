use crate::{
    audio::{self, Target},
    cli::Codec,
    mux,
    publish::emit,
};
use anyhow::{Context, Result, ensure};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::task::JoinHandle;

const MAX_BYTES: usize = 180 * 1024 * 1024;
const AUDIO_LEAD: Duration = Duration::from_millis(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VideoFormat {
    pub codec: Codec,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

// Export holds references to the same buffers. Their bytes remain charged until both
// the circular buffer and the exporter have released them.
pub struct Samples<T> {
    pub data: Box<[T]>,
    used: Arc<AtomicUsize>,
}

impl<T> Drop for Samples<T> {
    fn drop(&mut self) {
        self.used
            .fetch_sub(std::mem::size_of_val(&*self.data), Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct Video {
    pub at: Instant,
    pub key: bool,
    pub payload: Arc<Samples<u8>>,
    pub(crate) headers: Option<Arc<[u8]>>,
}

#[derive(Clone)]
pub struct Audio {
    pub at: Instant,
    pub payload: Arc<Samples<i16>>,
}

pub struct Clip {
    pub format: VideoFormat,
    pub headers: Arc<[u8]>,
    pub video: Vec<Video>,
    pub audio: [Vec<Audio>; 3], // Game, call output, own microphone.
}

#[derive(Default)]
struct Buffer {
    used: Arc<AtomicUsize>,
    seconds: Option<u32>,
    format: Option<VideoFormat>,
    headers: Option<Arc<[u8]>>,
    video: VecDeque<Video>,
    audio: [VecDeque<Audio>; 3],
}

impl Buffer {
    fn clear(&mut self) {
        self.video.clear();
        self.audio.iter_mut().for_each(VecDeque::clear);
    }

    fn trim_audio(&mut self, now: Instant) {
        let anchor = self.video.front().map_or(
            now.checked_sub(Duration::from_secs(2)).unwrap_or(now),
            |video| video.at,
        );
        for track in &mut self.audio {
            while track
                .front()
                .is_some_and(|sample| sample.at + AUDIO_LEAD < anchor)
            {
                track.pop_front();
            }
        }
    }

    fn drop_gop(&mut self) {
        self.video.pop_front();
        while self.video.front().is_some_and(|video| !video.key) {
            self.video.pop_front();
        }
    }

    fn prune(&mut self, now: Instant, seconds: u32) {
        while self
            .video
            .iter()
            .skip(1)
            .find(|video| video.key)
            .is_some_and(|next| {
                now.saturating_duration_since(next.at) >= Duration::from_secs(seconds.into())
            })
        {
            self.drop_gop();
        }
        self.trim_audio(now);
    }

    fn make_room(&mut self, now: Instant, bytes: usize) -> bool {
        if bytes > MAX_BYTES {
            return false;
        }
        while self.used.load(Ordering::Relaxed) > MAX_BYTES - bytes {
            if !self.video.is_empty() {
                self.drop_gop();
                self.trim_audio(now);
            } else if let Some(oldest) = self
                .audio
                .iter_mut()
                .filter(|track| !track.is_empty())
                .min_by_key(|track| track[0].at)
            {
                oldest.pop_front();
            } else {
                return false;
            }
        }
        true
    }

    fn allocate<T>(&self, data: Box<[T]>) -> Arc<Samples<T>> {
        self.used
            .fetch_add(std::mem::size_of_val(&*data), Ordering::Relaxed);
        Arc::new(Samples {
            data,
            used: self.used.clone(),
        })
    }

    fn video(&mut self, format: VideoFormat, at: Instant, key: bool, payload: &[u8]) {
        if self.format != Some(format) {
            self.video.clear();
            self.format = Some(format);
            self.headers = None;
        }
        if key
            && let Some(headers) = codec_headers(format.codec, payload)
            && self.headers.as_deref() != Some(headers.as_slice())
        {
            self.headers = Some(headers.into());
        }
        let Some(seconds) = self.seconds else { return };
        self.prune(at, seconds);
        if self.headers.is_none()
            || !self.make_room(at, payload.len())
            || (!key && self.video.is_empty())
        {
            return;
        }
        self.video.push_back(Video {
            at,
            key,
            payload: self.allocate(payload.into()),
            headers: if key { self.headers.clone() } else { None },
        });
    }

    fn audio(&mut self, track: usize, at: Instant, data: Vec<i16>) {
        if self.seconds.is_none() {
            return;
        }
        self.trim_audio(at);
        if self.make_room(at, data.len() * size_of::<i16>()) {
            let payload = self.allocate(data.into_boxed_slice());
            self.audio[track].push_back(Audio { at, payload });
        }
    }

    fn snapshot(&self) -> Option<Clip> {
        let first = self.video.front()?;
        let start = first.at;
        let end = self.video.back()?.at;
        Some(Clip {
            format: self.format?,
            headers: first.headers.clone()?,
            video: self.video.iter().cloned().collect(),
            audio: std::array::from_fn(|i| {
                self.audio[i]
                    .iter()
                    .filter(|audio| audio.at + AUDIO_LEAD >= start && audio.at <= end)
                    .cloned()
                    .collect()
            }),
        })
    }
}

#[derive(Clone, Default)]
pub struct Recorder {
    buffer: Arc<Mutex<Buffer>>,
    active: Arc<AtomicBool>,
}

impl Recorder {
    pub fn active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn video(&self, format: VideoFormat, at: Instant, key: bool, payload: &[u8]) {
        if key || self.active() {
            self.buffer.lock().unwrap().video(format, at, key, payload);
        }
    }

    pub fn audio(&self, track: usize, at: Instant, samples: Vec<i16>) {
        if self.active() {
            self.buffer.lock().unwrap().audio(track, at, samples);
        }
    }

    fn set(&self, seconds: Option<u32>) {
        let mut buffer = self.buffer.lock().unwrap();
        buffer.seconds = seconds;
        if seconds.is_none() {
            buffer.clear();
        }
        self.active.store(seconds.is_some(), Ordering::Relaxed);
    }
}

fn codec_headers(codec: Codec, mut payload: &[u8]) -> Option<Vec<u8>> {
    // Codec configuration precedes the picture data in an Annex B access unit
    // or an AV1 temporal unit. Retain it across eviction of the original GOP.
    match codec {
        Codec::H264 => {
            let mut result = Vec::new();
            let mut sps = false;
            let mut pps = false;
            let start = |bytes: &[u8]| bytes.windows(3).position(|bytes| bytes == [0, 0, 1]);
            while let Some(offset) = start(payload) {
                let nal = &payload[offset + 3..];
                let kind = *nal.first()? & 31;
                if matches!(kind, 1..=5) {
                    break;
                }
                let end = start(nal).unwrap_or(nal.len());
                if matches!(kind, 7 | 8) {
                    if result.len().saturating_add(end) > 64 * 1024 {
                        return None;
                    }
                    result.extend_from_slice(&[0, 0, 0, 1]);
                    let trimmed = nal[..end].iter().rposition(|byte| *byte != 0)? + 1;
                    result.extend_from_slice(&nal[..trimmed]);
                    sps |= kind == 7;
                    pps |= kind == 8;
                }
                payload = &nal[end..];
            }
            (sps && pps).then_some(result)
        }
        Codec::Av1 => {
            while let Some(&obu) = payload.first() {
                let kind = (obu >> 3) & 15;
                let header = 1 + usize::from(obu & 4 != 0);
                let rest = payload.get(header..)?;
                let length = if obu & 2 == 0 {
                    payload.len()
                } else {
                    let mut size = 0u64;
                    let mut bytes = 0usize;
                    for &byte in rest.iter().take(8) {
                        size |= u64::from(byte & 127) << (7 * bytes);
                        bytes += 1;
                        if byte & 128 == 0 {
                            break;
                        }
                    }
                    if *rest.get(bytes.checked_sub(1)?)? & 128 != 0 {
                        return None;
                    }
                    (header + bytes).checked_add(usize::try_from(size).ok()?)?
                };
                if kind == 1 {
                    if length > 64 * 1024 {
                        return None;
                    }
                    return Some(payload.get(..length)?.to_vec());
                }
                if matches!(kind, 3 | 6) {
                    return None;
                }
                payload = payload.get(length..)?;
            }
            None
        }
    }
}

struct AudioTask {
    stop: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl AudioTask {
    fn start(recorder: Recorder, target: Target, track: usize) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let task = tokio::task::spawn_blocking(move || {
            let result = audio::capture(
                target,
                || flag.load(Ordering::Relaxed),
                |at, data| {
                    if !flag.load(Ordering::Relaxed) {
                        recorder.audio(track, at, data);
                    }
                    Ok(())
                },
            );
            if let Err(error) = result {
                report_error(format!(
                    "{} do replay: {error:#}",
                    ["Som do jogo", "Áudio da call", "Microfone"][track]
                ));
            }
        });
        Self { stop, task }
    }

    async fn close(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.task.await;
    }
}

pub struct Replay {
    pub recorder: Recorder,
    pub dir: Option<PathBuf>,
    pub game: Option<Target>,
    pub call: Option<Target>,
    game_audio: Option<AudioTask>,
    call_audio: Option<AudioTask>,
    mic_audio: Option<AudioTask>,
    mic_open: bool,
    mic_device: Option<String>,
    saving: Option<JoinHandle<()>>,
}

impl Replay {
    pub fn new(dir: Option<PathBuf>, game: Option<Target>, call: Option<Target>) -> Self {
        Self {
            recorder: Recorder::default(),
            dir,
            game,
            call,
            game_audio: None,
            call_audio: None,
            mic_audio: None,
            mic_open: false,
            mic_device: None,
            saving: None,
        }
    }

    pub async fn configure(&mut self, seconds: Option<u32>) -> Result<()> {
        let was = self.recorder.active();
        if let Some(seconds) = seconds {
            ensure!(
                matches!(seconds, 30 | 60 | 120),
                "Escolha um replay de 30, 60 ou 120 segundos."
            );
            ensure!(
                self.dir.is_some(),
                "A pasta de vídeos do replay não foi configurada."
            );
            crate::media::init_muxer().context("Não foi possível carregar o muxer de MP4")?;
            self.recorder.set(Some(seconds));
            if !was {
                self.game_audio = self
                    .game
                    .clone()
                    .map(|target| AudioTask::start(self.recorder.clone(), target, 0));
                self.call_audio = self
                    .call
                    .clone()
                    .map(|target| AudioTask::start(self.recorder.clone(), target, 1));
                self.update_mic().await;
            }
        } else if was {
            self.recorder.set(None);
            for task in [
                self.game_audio.take(),
                self.call_audio.take(),
                self.mic_audio.take(),
            ]
            .into_iter()
            .flatten()
            {
                task.close().await;
            }
        }
        if was != seconds.is_some() {
            emit(serde_json::json!({"event":"replay_state", "ativo": seconds.is_some()}));
        }
        Ok(())
    }

    pub async fn microphone(&mut self, open: bool, device: Option<String>) {
        self.mic_open = open;
        if self.mic_device != device {
            if let Some(task) = self.mic_audio.take() {
                task.close().await;
            }
            self.mic_device = device;
        }
        self.update_mic().await;
    }

    async fn update_mic(&mut self) {
        if self.mic_open && self.recorder.active() {
            if self.mic_audio.is_none() {
                self.mic_audio = Some(AudioTask::start(
                    self.recorder.clone(),
                    Target::Microphone(self.mic_device.clone()),
                    2,
                ));
            }
        } else if let Some(task) = self.mic_audio.take() {
            task.close().await;
        }
    }

    pub fn save(&mut self) -> Result<()> {
        ensure!(
            self.recorder.active(),
            "Ligue o replay antes de salvar um clipe."
        );
        ensure!(
            self.saving.as_ref().is_none_or(JoinHandle::is_finished),
            "Já existe um clipe sendo salvo."
        );
        let dir = self
            .dir
            .clone()
            .context("Não foi possível localizar a pasta de vídeos")?;
        let clip = self
            .recorder
            .buffer
            .lock()
            .unwrap()
            .snapshot()
            .context("O replay ainda não tem vídeo. Aguarde o primeiro quadro-chave.")?;
        self.saving = Some(tokio::task::spawn_blocking(move || {
            match mux::save(&dir, clip) {
                Ok(saved) => emit(
                    serde_json::json!({"event":"replay_saved", "caminho": saved.path, "duracao": saved.seconds, "tamanho": saved.bytes}),
                ),
                Err(error) => report_error(format!("Não foi possível salvar o clipe: {error:#}")),
            }
        }));
        Ok(())
    }

    pub async fn close(mut self) {
        let _ = self.configure(None).await;
        if let Some(task) = self.saving.take() {
            let _ = task.await;
        }
    }
}

pub fn report_error(error: impl std::fmt::Display) {
    emit(serde_json::json!({"event":"replay_error", "motivo": error.to_string()}));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_mp4_codec_configuration_records() -> Result<()> {
        // Single black frames encoded as Annex B H.264 (QSV) and AV1 OBUs (libaom).
        const BASELINE: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x27, 0x42, 0x00, 0x0a, 0x95, 0xb1, 0x09, 0xb0, 0x11, 0x00,
            0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x3c, 0x9d, 0xa1, 0xc2, 0x6e, 0x00,
            0x00, 0x00, 0x01, 0x28, 0xce, 0x3c, 0x80, 0x00, 0x00, 0x01, 0x25, 0x88, 0x80, 0x41,
            0xbf, 0xff, 0xff, 0x0f, 0x45, 0x00, 0x01, 0x06, 0x9f, 0x27, 0x27, 0x27, 0x27, 0x27,
            0x27, 0x27, 0x27, 0x27, 0x27, 0x27, 0x27, 0x27, 0x27, 0x27, 0x80,
        ];
        const HIGH: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, 0x27, 0x64, 0x00, 0x0a, 0xac, 0x2b, 0x62, 0x13, 0x60, 0x22,
            0x00, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00, 0x03, 0x00, 0x79, 0x3b, 0x43, 0x84, 0xdc,
            0x00, 0x00, 0x00, 0x01, 0x28, 0xee, 0x3c, 0xb0, 0x00, 0x00, 0x01, 0x25, 0x88, 0x80,
            0x41, 0xbf, 0x94, 0x01, 0xb1, 0x76, 0xaf, 0x99, 0x5f, 0x01, 0xff, 0xbc, 0x5a, 0x66,
            0x74, 0xde, 0xac, 0x6d, 0x94, 0xb0, 0xcf, 0xac, 0x7c, 0x69, 0x9f, 0xb4, 0xfd, 0x76,
            0x18,
        ];
        const AV1: &[u8] = &[
            0x12, 0x00, 0x0a, 0x0a, 0x00, 0x00, 0x00, 0x02, 0x27, 0xfe, 0x6d, 0x7c, 0x80, 0x20,
            0x32, 0x0e, 0x10, 0x00, 0xc0, 0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0x02, 0xe5, 0xd6,
            0xf7, 0x40,
        ];

        crate::media::init()?;
        crate::media::init_muxer()?;
        let directory =
            std::env::temp_dir().join(format!("stackcall-mux-test-{}", std::process::id()));
        for (codec, size, frames, tag, config, count) in [
            (
                Codec::H264,
                64,
                &[BASELINE, BASELINE, HIGH][..],
                b"avc1",
                b"avcC",
                2,
            ),
            (Codec::Av1, 32, &[AV1][..], b"av01", b"av1C", 1),
        ] {
            let mut buffer = Buffer {
                seconds: Some(30),
                ..Default::default()
            };
            let format = VideoFormat {
                codec,
                width: size,
                height: size,
                fps: 30,
            };
            let start = Instant::now();
            for (index, payload) in frames.iter().enumerate() {
                buffer.video(
                    format,
                    start + Duration::from_secs(index as u64),
                    true,
                    payload,
                );
            }
            let saved = mux::save(&directory, buffer.snapshot().unwrap())?;
            let file = std::fs::read(&saved.path)?;

            let mdat = file.windows(4).position(|bytes| bytes == b"mdat").unwrap();
            let mdat_size = u32::from_be_bytes(file[mdat - 4..mdat].try_into()?) as usize;
            let media = &file[mdat + 4..mdat - 4 + mdat_size];
            let moov = &file[mdat - 4 + mdat_size..];
            assert_eq!(moov.windows(4).filter(|bytes| *bytes == tag).count(), count);
            let records = moov
                .windows(4)
                .enumerate()
                .filter(|(_, bytes)| *bytes == config);
            assert_eq!(records.clone().count(), count);
            for (offset, _) in records {
                let size = u32::from_be_bytes(moov[offset - 4..offset].try_into()?);
                let version = if codec == Codec::H264 { 1 } else { 0x81 };
                assert!(size > 12);
                assert_eq!(moov[offset + 4], version);
            }
            if codec == Codec::H264 {
                for payload in frames {
                    let headers = codec_headers(codec, payload).unwrap();
                    let sps_end = headers[4..]
                        .windows(4)
                        .position(|bytes| bytes == [0, 0, 0, 1])
                        .unwrap()
                        + 4;
                    let sps = &headers[4..sps_end];
                    let pps = &headers[sps_end + 4..];
                    assert!(!media.windows(sps.len()).any(|bytes| bytes == sps));
                    assert!(!media.windows(pps.len()).any(|bytes| bytes == pps));
                }
            }
            std::fs::remove_file(saved.path)?;
        }
        std::fs::remove_dir(directory)?;
        Ok(())
    }

    #[test]
    fn expires_whole_gops_and_pins_snapshot_bytes() {
        let mut buffer = Buffer {
            seconds: Some(30),
            ..Default::default()
        };
        let format = VideoFormat {
            codec: Codec::H264,
            width: 1280,
            height: 720,
            fps: 30,
        };
        let start = Instant::now();
        buffer.video(format, start, false, &[0]);
        assert!(buffer.snapshot().is_none());
        for t in 0..=40 {
            let payload: &[u8] = if t == 0 {
                &[0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2, 0, 0, 1, 0x65, 3]
            } else {
                &[42]
            };
            buffer.video(format, start + Duration::from_secs(t), t % 5 == 0, payload);
        }
        let clip = buffer.snapshot().unwrap();
        assert!(clip.video[0].key);
        assert_eq!(
            clip.headers.as_ref(),
            [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2]
        );
        assert_eq!(clip.video[0].at, start + Duration::from_secs(10));
        buffer.clear();
        assert_eq!(buffer.used.load(Ordering::Relaxed), 31);
        drop(clip);
        assert_eq!(buffer.used.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn preserves_the_gop_when_h264_bitrate_changes_its_headers() {
        let mut buffer = Buffer {
            seconds: Some(60),
            ..Default::default()
        };
        let format = VideoFormat {
            codec: Codec::H264,
            width: 1280,
            height: 720,
            fps: 30,
        };
        let start = Instant::now();
        buffer.video(format, start, true, &[0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 1]);
        buffer.video(
            format,
            start + Duration::from_secs(2),
            true,
            &[0, 0, 1, 0x67, 2, 0, 0, 1, 0x68, 2],
        );
        let clip = buffer.snapshot().unwrap();
        assert_eq!(clip.video.len(), 2);
        assert_eq!(
            clip.headers.as_ref(),
            [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 1]
        );
    }
}
