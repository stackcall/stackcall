use anyhow::{Context, Result};
use livekit::{
    options::{AudioEncoding, TrackPublishOptions},
    prelude::*,
    webrtc::{
        audio_frame::AudioFrame,
        audio_source::{AudioSourceOptions, RtcAudioSource, native::NativeAudioSource},
    },
};
use std::{
    borrow::Cow,
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{runtime::Handle, task::JoinHandle};
use wasapi::{AudioClient, DeviceEnumerator, Direction, Role, SampleType, StreamMode, WaveFormat};

pub const RATE: u32 = 48_000;
pub const CHANNELS: u32 = 2;
const FRAMES: u32 = RATE / 100;
const CHUNK_BYTES: usize = (FRAMES * CHANNELS * 2) as usize;

#[derive(Clone)]
pub enum Target {
    Process { pid: u32, include: bool },
    Microphone(Option<String>),
}

#[derive(Default)]
pub struct Worker {
    stopping: Arc<AtomicBool>,
    task: Option<JoinHandle<Result<()>>>,
}

impl Worker {
    pub async fn start(
        &mut self,
        room: &Room,
        target: Target,
        recorder: crate::replay::Recorder,
    ) -> Result<()> {
        let source = NativeAudioSource::new(AudioSourceOptions::default(), RATE, CHANNELS, 40);
        let track = LocalAudioTrack::create_audio_track(
            "game audio",
            RtcAudioSource::Native(source.clone()),
        );
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    stream: "screen".into(),
                    audio_encoding: Some(AudioEncoding {
                        max_bitrate: 96_000,
                    }),
                    dtx: false,
                    ..Default::default()
                },
            )
            .await?;
        let runtime = Handle::current();
        let stopping = self.stopping.clone();
        self.task = Some(tokio::task::spawn_blocking(move || {
            capture(
                target,
                || stopping.load(Ordering::Relaxed),
                |at, data| {
                    if recorder.active() {
                        recorder.audio(0, at, data.clone());
                    }
                    runtime.block_on(async {
                        tokio::time::timeout(
                            Duration::from_secs(1),
                            source.capture_frame(&AudioFrame {
                                data: Cow::Owned(data),
                                sample_rate: RATE,
                                num_channels: CHANNELS,
                                samples_per_channel: FRAMES,
                            }),
                        )
                        .await??;
                        Ok(())
                    })
                },
            )
            .context("WASAPI process loopback")
        }));
        Ok(())
    }

    pub async fn check(&mut self) -> Result<()> {
        if self.task.as_ref().is_some_and(|task| task.is_finished()) {
            self.stop().await?;
        }
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<()> {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(task) = self.task.take() {
            task.await??;
        }
        Ok(())
    }
}

pub fn capture(
    target: Target,
    stopping: impl Fn() -> bool,
    mut consume: impl FnMut(Instant, Vec<i16>) -> Result<()>,
) -> Result<()> {
    wasapi::initialize_mta().ok()?;
    let result = (|| {
        let mut client = match target {
            Target::Process { pid, include } => {
                AudioClient::new_application_loopback_client(pid, include)?
            }
            Target::Microphone(ref name) => {
                let devices = DeviceEnumerator::new()?;
                let device = if let Some(name) = name {
                    devices
                        .get_device_collection(Direction::Capture)?
                        .get_device_with_name(name)?
                } else {
                    devices.get_default_device_for_role(Direction::Capture, Role::Communications)?
                };
                device.get_iaudioclient()?
            }
        };
        let format = WaveFormat::new(
            16,
            16,
            SampleType::Int,
            RATE as usize,
            CHANNELS as usize,
            None,
        );
        client.initialize_client(
            &format,
            Direction::Capture,
            StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            },
            None,
        )?;
        let reader = client.get_audiocaptureclient()?;
        let event = client.set_get_eventhandle()?;
        let mut bytes = VecDeque::new();
        client.start_stream()?;
        let result = (|| {
            while !stopping() {
                while reader.get_next_packet_size()?.unwrap_or(0) > 0 {
                    reader.read_from_device_to_deque(&mut bytes)?;
                }
                let now = Instant::now();
                while bytes.len() >= CHUNK_BYTES && !stopping() {
                    let (samples, _) = bytes.make_contiguous()[..CHUNK_BYTES].as_chunks::<2>();
                    let data = samples.iter().copied().map(i16::from_le_bytes).collect();
                    let pending =
                        Duration::from_micros((bytes.len() as u64 * 10_000) / CHUNK_BYTES as u64);
                    bytes.drain(..CHUNK_BYTES);
                    consume(now.checked_sub(pending).unwrap_or(now), data)?;
                }
                let _ = event.wait_for_event(20);
            }
            Ok::<_, anyhow::Error>(())
        })();
        let stop = client.stop_stream();
        result?;
        stop?;
        Ok::<_, anyhow::Error>(())
    })();
    wasapi::deinitialize();
    result
}
