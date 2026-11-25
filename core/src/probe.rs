use std::{
    collections::BTreeMap,
    path::Path,
    time::{Duration, Instant},
};

use crate::media::{Frame, Pixel};
use anyhow::{Context, Result};
use serde::Serialize;
use windows::{
    Win32::Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ERROR_NOT_FOUND, IDXGIDevice, IDXGIFactory1},
    core::Interface,
};

use crate::{
    cli::{Codec, Probe, Resolution},
    encoder::{self, NvencPreset, Tuning},
};

#[derive(Serialize)]
pub struct Report {
    adapters: Vec<Adapter>,
    trials: Vec<Trial>,
    cbr: bool,
}

#[derive(Serialize)]
struct Adapter {
    name: String,
    driver_version: String,
    vendor_id: u32,
    vendor: &'static str,
    dedicated_bytes: usize,
    shared_bytes: usize,
}

#[derive(Serialize)]
struct Trial {
    encoder: &'static str,
    resolution: Resolution,
    target_fps: u32,
    ok: bool,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Outcome {
    Success {
        fps: f64,
        encoded_frames: usize,
        encode_ms_p50: Option<f64>,
        encode_ms_p95: Option<f64>,
        encoder_load_percent: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        nvenc_preset: Option<NvencPreset>,
        #[serde(skip_serializing_if = "Option::is_none")]
        h264_high: Option<bool>,
    },
    Failure {
        error: String,
    },
}

pub fn run(options: Probe) -> Result<Report> {
    crate::media::init()?;
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut adapters = Vec::new();
    for index in 0.. {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(error) => return Err(error.into()),
        };
        let desc = unsafe { adapter.GetDesc1()? };
        let driver_version = unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }
            .map(|version| {
                let [a, b, c, d] = [48, 32, 16, 0].map(|shift| (version >> shift) as u16);
                format!("{a}.{b}.{c}.{d}")
            })
            .unwrap_or_default();
        adapters.push(Adapter {
            name: String::from_utf16_lossy(&desc.Description)
                .trim_end_matches('\0')
                .into(),
            driver_version,
            vendor_id: desc.VendorId,
            vendor: match desc.VendorId {
                0x10de => "NVIDIA",
                0x1002 => "AMD",
                0x8086 => "Intel",
                _ => "Other",
            },
            dedicated_bytes: desc.DedicatedVideoMemory,
            shared_bytes: desc.SharedSystemMemory,
        });
    }

    let presets = [
        (Resolution::P720, 30, 2000, 1400),
        (Resolution::P1080, 30, 4500, 3200),
        (Resolution::P1080, 60, 7000, 4200),
        (Resolution::P1440, 60, 10000, 7000),
        (Resolution::P4k, 30, 15000, 10500),
        (Resolution::P4k, 60, 25000, 18000),
    ];
    let tuning = Tuning {
        cbr: options.cbr,
        high_profile: options.hardware_quality,
        ..Tuning::default()
    };
    let trials = encoder::CANDIDATES
        .into_iter()
        .flat_map(|name| {
            presets
                .into_iter()
                .map(move |(resolution, target_fps, h264, av1)| {
                    let kbps = if name.starts_with("av1_") { av1 } else { h264 };
                    let best = if options.hardware_quality && name.ends_with("_nvenc") {
                        [NvencPreset::P4, NvencPreset::P3]
                            .into_iter()
                            .find_map(|preset| {
                                let outcome = measure(
                                    name,
                                    resolution,
                                    target_fps,
                                    kbps,
                                    Tuning {
                                        nvenc_preset: preset,
                                        ..tuning
                                    },
                                )
                                .ok()?;
                                match &outcome {
                                    Outcome::Success {
                                        nvenc_preset,
                                        encoder_load_percent,
                                        encode_ms_p95,
                                        ..
                                    } if *nvenc_preset == Some(preset)
                                        && has_headroom(
                                            *encoder_load_percent,
                                            *encode_ms_p95,
                                            target_fps,
                                        ) =>
                                    {
                                        Some(outcome)
                                    }
                                    _ => None,
                                }
                            })
                    } else {
                        None
                    };
                    let result = match best {
                        Some(outcome) => Ok(outcome),
                        None => measure(name, resolution, target_fps, kbps, tuning),
                    };
                    Trial {
                        encoder: name,
                        resolution,
                        target_fps,
                        ok: result.is_ok(),
                        outcome: result.unwrap_or_else(|error| Outcome::Failure {
                            error: format!("{error:#}"),
                        }),
                    }
                })
        })
        .collect();
    Ok(Report {
        adapters,
        trials,
        cbr: options.cbr,
    })
}

fn has_headroom(load: f64, p95_ms: Option<f64>, fps: u32) -> bool {
    load <= 60.0 && p95_ms.is_some_and(|latency| latency <= 600.0 / f64::from(fps))
}

pub fn nvenc_recommendation(
    path: &Path,
    codec: Codec,
    res: Resolution,
    fps: u32,
    cbr: bool,
) -> Result<NvencPreset> {
    #[derive(serde::Deserialize)]
    struct ProbeReport {
        #[serde(default)]
        cbr: bool,
        trials: Vec<NvencTrial>,
    }
    #[derive(serde::Deserialize)]
    struct NvencTrial {
        encoder: String,
        resolution: Resolution,
        target_fps: u32,
        ok: bool,
        nvenc_preset: Option<NvencPreset>,
        encoder_load_percent: Option<f64>,
        encode_ms_p95: Option<f64>,
    }
    let json = std::fs::read_to_string(path).context("reading NVENC probe report")?;
    let report: ProbeReport = serde_json::from_str(json.trim_start_matches('\u{feff}'))
        .context("parsing NVENC probe report")?;
    let name = match codec {
        Codec::H264 => "h264_nvenc",
        Codec::Av1 => "av1_nvenc",
    };
    Ok(if report.cbr == cbr {
        report
            .trials
            .into_iter()
            .find(|trial| {
                trial.ok
                    && trial.encoder == name
                    && trial.resolution == res
                    && trial.target_fps == fps
                    && trial
                        .encoder_load_percent
                        .is_some_and(|load| has_headroom(load, trial.encode_ms_p95, fps))
            })
            .and_then(|trial| trial.nvenc_preset)
            .unwrap_or_default()
    } else {
        NvencPreset::P1
    })
}

fn measure(name: &str, res: Resolution, fps: u32, kbps: u32, tuning: Tuning) -> Result<Outcome> {
    let mut session = encoder::open(name, res, fps, kbps, None, tuning)?;
    let (width, height) = res.dimensions();
    let mut frames: Vec<_> = (0..4)
        .map(|phase| {
            let mut frame = Frame::new(Pixel::AV_PIX_FMT_NV12, width, height)?;
            let stride = frame.stride(0);
            for (y, row) in frame
                .plane_mut(0, height as usize)
                .chunks_mut(stride)
                .enumerate()
            {
                for (x, block) in row.chunks_mut(32).enumerate() {
                    block.fill(if (x + y / 32 + phase).is_multiple_of(2) {
                        48
                    } else {
                        208
                    });
                }
            }
            frame.plane_mut(1, height as usize / 2).fill(128);
            Ok(frame)
        })
        .collect::<Result<_>>()?;
    let mut pending = BTreeMap::<i64, Instant>::new();
    let mut latencies = Vec::new();
    let start = Instant::now();
    for index in 0..5 * fps {
        let pts = i64::from(index) * 90_000 / i64::from(fps);
        let count = frames.len();
        let frame = &mut frames[index as usize % count];
        frame.raw_mut().pts = pts;
        pending.insert(pts, Instant::now());
        session.send_frame(frame)?;
        encoder::drain(&mut session, |packet| {
            record(packet, &mut pending, &mut latencies)
        })?;
        if start.elapsed() >= Duration::from_millis(1500) {
            break;
        }
    }
    session.send_eof()?;
    encoder::drain(&mut session, |packet| {
        record(packet, &mut pending, &mut latencies)
    })?;
    anyhow::ensure!(
        pending.is_empty(),
        "encoder did not return every submitted frame"
    );
    let achieved = latencies.len() as f64 / start.elapsed().as_secs_f64();
    let (p50, p95) = encoder::percentiles(&mut latencies);
    Ok(Outcome::Success {
        fps: achieved,
        encoded_frames: latencies.len(),
        encode_ms_p50: p50,
        encode_ms_p95: p95,
        encoder_load_percent: (100.0 * f64::from(fps) / achieved).min(100.0),
        nvenc_preset: name
            .ends_with("_nvenc")
            .then_some(session.tuning().nvenc_preset),
        h264_high: name
            .starts_with("h264")
            .then_some(session.tuning().high_profile),
    })
}

fn record(
    packet: &encoder::Packet,
    pending: &mut BTreeMap<i64, Instant>,
    latencies: &mut Vec<f64>,
) -> Result<()> {
    let pts = packet.pts().context("packet has no timestamp")?;
    let sent = pending
        .remove(&pts)
        .context("unexpected packet timestamp")?;
    latencies.push(sent.elapsed().as_secs_f64() * 1000.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_driver_version_is_text_even_when_unknown() {
        let adapter = Adapter {
            name: "Test adapter".into(),
            driver_version: Default::default(),
            vendor_id: 0,
            vendor: "Other",
            dedicated_bytes: 0,
            shared_bytes: 0,
        };
        let json = serde_json::to_value(adapter).unwrap();
        assert_eq!(json["name"], "Test adapter");
        assert_eq!(json["driver_version"], "");
    }

    #[test]
    fn nvenc_headroom_checks_throughput_and_tail_latency() {
        assert!(has_headroom(60.0, Some(10.0), 60));
        assert!(!has_headroom(61.0, Some(5.0), 60));
        assert!(!has_headroom(30.0, Some(11.0), 60));
        assert!(!has_headroom(30.0, None, 60));
    }

    #[test]
    fn failure_is_a_row_with_no_measurements() {
        let row = Trial {
            encoder: "av1_qsv",
            resolution: Resolution::P4k,
            target_fps: 60,
            ok: false,
            outcome: Outcome::Failure {
                error: "unavailable".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(row).unwrap(),
            serde_json::json!({
                "encoder":"av1_qsv", "resolution":"4k", "target_fps":60, "ok":false, "error":"unavailable"
            })
        );
    }
}
