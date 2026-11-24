use std::{collections::BTreeMap, time::Instant};

use crate::media::{Frame, Pixel};
use anyhow::{Context, Result};
use serde::Serialize;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ERROR_NOT_FOUND, IDXGIFactory1};

use crate::{cli::Resolution, encoder};

#[derive(Clone, Copy)]
pub struct ProbeOptions {
    pub seconds: u32,
}

#[derive(Serialize)]
pub struct Report {
    adapters: Vec<Adapter>,
    trials: Vec<Trial>,
}

#[derive(Serialize)]
struct Adapter {
    name: String,
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
    },
    Failure {
        error: String,
    },
}

pub fn run(options: ProbeOptions) -> Result<Report> {
    crate::media::init()?;
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let adapters = (0..)
        .map_while(|index| match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => Some(unsafe { adapter.GetDesc1() }.map_err(anyhow::Error::from)),
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => None,
            Err(error) => Some(Err(error.into())),
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .map(|desc| Adapter {
            name: String::from_utf16_lossy(&desc.Description)
                .trim_end_matches('\0')
                .into(),
            vendor_id: desc.VendorId,
            vendor: match desc.VendorId {
                0x10de => "NVIDIA",
                0x1002 => "AMD",
                0x8086 => "Intel",
                _ => "Other",
            },
            dedicated_bytes: desc.DedicatedVideoMemory,
            shared_bytes: desc.SharedSystemMemory,
        })
        .collect();

    let presets = [
        (Resolution::P720, 30, 2000),
        (Resolution::P1080, 60, 6000),
        (Resolution::P1440, 60, 10000),
        (Resolution::P4k, 60, 18000),
    ];
    let trials = encoder::CANDIDATES
        .into_iter()
        .flat_map(|name| {
            presets
                .into_iter()
                .map(move |(resolution, target_fps, kbps)| {
                    let result = measure(name, resolution, target_fps, kbps, options.seconds);
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
    Ok(Report { adapters, trials })
}

fn measure(name: &str, res: Resolution, fps: u32, kbps: u32, seconds: u32) -> Result<Outcome> {
    let mut session = encoder::open(name, res, fps, kbps, None)?;
    let (width, height) = res.dimensions();
    let mut frames: Vec<_> = (0..8)
        .map(|phase| {
            let mut frame = Frame::new(Pixel::AV_PIX_FMT_NV12, width, height)?;
            let stride = frame.stride(0);
            for (y, row) in frame
                .plane_mut(0, height as usize)
                .chunks_mut(stride)
                .enumerate()
            {
                for (x, pixel) in row.iter_mut().enumerate() {
                    *pixel = if ((x + phase * 17) / 32 + y / 32) % 2 == 0 {
                        48
                    } else {
                        208
                    };
                }
            }
            frame.plane_mut(1, height as usize / 2).fill(128);
            Ok(frame)
        })
        .collect::<Result<_>>()?;
    let mut pending = BTreeMap::<i64, Instant>::new();
    let mut latencies = Vec::new();
    let start = Instant::now();
    for index in 0..seconds * fps {
        let pts = i64::from(index) * 90_000 / i64::from(fps);
        let count = frames.len();
        let frame = &mut frames[index as usize % count];
        frame.raw_mut().pts = pts;
        pending.insert(pts, Instant::now());
        session.send_frame(frame)?;
        encoder::drain(&mut session, |packet| {
            record(packet, &mut pending, &mut latencies)
        })?;
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
