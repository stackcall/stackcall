use std::{sync::mpsc, time::Duration};

use anyhow::Result;
use base64::Engine;
use serde::Serialize;
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::*,
    window::Window,
};

#[derive(Serialize)]
pub struct SourceInfo {
    id: String,
    title: String,
    process_name: Option<String>,
    pid: Option<u32>,
    width: u32,
    height: u32,
    thumbnail: Option<String>,
}

pub fn list() -> Result<Vec<SourceInfo>> {
    let app_pid = std::env::var("STACKCALL_APP_PID")
        .ok()
        .and_then(|pid| pid.parse::<u32>().ok());
    let mut sources = Vec::new();
    for (index, monitor) in Monitor::enumerate()?.into_iter().enumerate() {
        let (Ok(width), Ok(height)) = (monitor.width(), monitor.height()) else {
            continue;
        };
        sources.push(SourceInfo {
            id: format!("hmonitor:{}", monitor.as_raw_hmonitor() as usize),
            title: format!("Tela {}", index + 1),
            process_name: None,
            pid: None,
            width,
            height,
            thumbnail: thumbnail(monitor),
        });
    }
    for window in Window::enumerate()? {
        let (Ok(title), Ok(pid), Ok(width), Ok(height)) = (
            window.title(),
            window.process_id(),
            window.width(),
            window.height(),
        ) else {
            continue;
        };
        let process_name = window.process_name().ok();
        let own_process = process_name.as_deref().is_some_and(|name| {
            let name = name.to_ascii_lowercase();
            matches!(
                name.trim_end_matches(".exe"),
                "stackcall" | "stackcall-core"
            )
        });
        if Some(pid) == app_pid
            || pid == std::process::id()
            || own_process
            || width <= 0
            || height <= 0
        {
            continue;
        }
        sources.push(SourceInfo {
            id: format!("hwnd:{}:{pid}", window.as_raw_hwnd() as usize),
            title,
            process_name,
            pid: Some(pid),
            width: width as u32,
            height: height as u32,
            thumbnail: thumbnail(window),
        });
    }
    Ok(sources)
}

fn thumbnail<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(target: T) -> Option<String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let capture = Thumbnail::start_free_threaded(Settings::new(
        target,
        CursorCaptureSettings::Default,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        tx,
    ))
    .ok()?;
    let image = rx.recv_timeout(Duration::from_millis(350)).ok();
    if capture.is_finished() {
        let _ = capture.wait();
    } else {
        let _ = capture.stop();
    }
    image
}

struct Thumbnail(mpsc::SyncSender<String>);

impl GraphicsCaptureApiHandler for Thumbnail {
    type Flags = mpsc::SyncSender<String>;
    type Error = anyhow::Error;

    fn new(ctx: Context<Self::Flags>) -> Result<Self> {
        Ok(Self(ctx.flags))
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<()> {
        let (source_w, source_h) = (frame.width() as usize, frame.height() as usize);
        anyhow::ensure!(source_w > 0 && source_h > 0, "Captura sem dimensões.");
        let longest = source_w.max(source_h);
        let scale = longest.min(320);
        let width = (source_w * scale / longest).max(1);
        let height = (source_h * scale / longest).max(1);
        let mut buffer = frame.buffer()?;
        let pitch = buffer.row_pitch() as usize;
        let bgra = buffer.as_raw_buffer();
        let mut pixels = Vec::with_capacity(width * height * 3);
        for y in 0..height {
            let row = y * source_h / height * pitch;
            for x in 0..width {
                let pixel = row + x * source_w / width * 4;
                pixels.extend_from_slice(&[bgra[pixel + 2], bgra[pixel + 1], bgra[pixel]]);
            }
        }
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.write_header()?.write_image_data(&pixels)?;
        let _ = self
            .0
            .try_send(base64::engine::general_purpose::STANDARD.encode(png));
        control.stop();
        Ok(())
    }
}
