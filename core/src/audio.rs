use anyhow::{Context, Result};
use livekit::{
    options::TrackPublishOptions,
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
    time::Duration,
};
use tokio::{runtime::Handle, task::JoinHandle};
use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

const RATE: u32 = 48_000;
const CHANNELS: u32 = 2;
const FRAMES: u32 = RATE / 100;
const CHUNK_BYTES: usize = (FRAMES * CHANNELS * 2) as usize;

#[derive(Default)]
pub struct Worker {
    stopping: Arc<AtomicBool>,
    task: Option<JoinHandle<Result<()>>>,
}

impl Worker {
    pub async fn start(&mut self, room: &Room, pid: u32) -> Result<()> {
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
                    ..Default::default()
                },
            )
            .await?;
        let runtime = Handle::current();
        let stopping = self.stopping.clone();
        self.task = Some(tokio::task::spawn_blocking(move || {
            capture(pid, source, &runtime, &stopping).context("WASAPI process loopback")
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

fn capture(
    pid: u32,
    source: NativeAudioSource,
    runtime: &Handle,
    stopping: &AtomicBool,
) -> Result<()> {
    wasapi::initialize_mta().ok()?;
    let result = (|| {
        let mut client = AudioClient::new_application_loopback_client(pid, true)?;
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
            while !stopping.load(Ordering::Relaxed) {
                while reader.get_next_packet_size()?.unwrap_or(0) > 0 {
                    reader.read_from_device_to_deque(&mut bytes)?;
                }
                while bytes.len() >= CHUNK_BYTES && !stopping.load(Ordering::Relaxed) {
                    let (samples, _) = bytes.make_contiguous()[..CHUNK_BYTES].as_chunks::<2>();
                    let data = samples.iter().copied().map(i16::from_le_bytes).collect();
                    bytes.drain(..CHUNK_BYTES);
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
                        Ok::<_, anyhow::Error>(())
                    })?;
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
