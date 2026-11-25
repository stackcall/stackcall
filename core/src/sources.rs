use std::{sync::mpsc, thread, time::Duration};

use anyhow::Result;
use base64::Engine;
use serde::Serialize;
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::{
        Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute},
        Gdi::{MONITOR_DEFAULTTONEAREST, MonitorFromWindow},
    },
    UI::WindowsAndMessaging::{
        GW_OWNER, GWL_EXSTYLE, GWL_STYLE, GetWindow, GetWindowLongW, GetWindowPlacement, IsIconic,
        IsWindowVisible, WINDOWPLACEMENT, WS_CAPTION, WS_EX_TOOLWINDOW, WS_POPUP, WS_THICKFRAME,
    },
};
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
    width: Option<u32>,
    height: Option<u32>,
    minimized: bool,
    thumbnail: Option<String>,
}

#[derive(Clone, Copy)]
enum ThumbnailTarget {
    Monitor(Monitor),
    Window(Window),
}

struct WindowMetadata<'a> {
    title: &'a str,
    width: u32,
    height: u32,
    visible: bool,
    minimized: bool,
    cloaked: bool,
    tool_window: bool,
    owned: bool,
}

impl WindowMetadata<'_> {
    fn is_shareable(&self) -> bool {
        self.visible
            && !self.cloaked
            && !self.tool_window
            && !self.owned
            && !self.title.trim().is_empty()
            && (self.minimized || meets_minimum((self.width, self.height)))
    }
}

fn meets_minimum((width, height): (u32, u32)) -> bool {
    width >= 320 && height >= 200
}

fn rect_size(rect: RECT) -> (u32, u32) {
    (
        (rect.right - rect.left).max(0) as u32,
        (rect.bottom - rect.top).max(0) as u32,
    )
}

fn minimized_window_size(
    restored: Option<(u32, u32)>,
    monitor: Option<(u32, u32)>,
    fullscreen_hint: bool,
) -> Option<(u32, u32)> {
    let restored = restored.filter(|&size| meets_minimum(size));
    if fullscreen_hint {
        monitor.or(restored)
    } else {
        restored.or(monitor)
    }
}

fn window_monitor_size(hwnd: HWND) -> Option<(u32, u32)> {
    // Windows uses the window's pre-minimize rectangle to choose the monitor.
    let handle = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if handle.is_invalid() {
        return None;
    }
    let monitor = Monitor::from_raw_hmonitor(handle.0);
    Some((monitor.width().ok()?, monitor.height().ok()?))
}

pub fn list() -> Result<Vec<SourceInfo>> {
    let app_pid = std::env::var("STACKCALL_APP_PID")
        .ok()
        .and_then(|pid| pid.parse::<u32>().ok());
    let mut sources = Vec::new();
    let mut thumbnails = Vec::new();
    for (index, monitor) in Monitor::enumerate()?.into_iter().enumerate() {
        let (Ok(width), Ok(height)) = (monitor.width(), monitor.height()) else {
            continue;
        };
        thumbnails.push((sources.len(), ThumbnailTarget::Monitor(monitor)));
        sources.push(SourceInfo {
            id: format!("hmonitor:{}", monitor.as_raw_hmonitor() as usize),
            title: format!("Tela {}", index + 1),
            process_name: None,
            pid: None,
            width: Some(width),
            height: Some(height),
            minimized: false,
            thumbnail: None,
        });
    }
    for window in Window::enumerate()? {
        let (Ok(title), Ok(pid)) = (window.title(), window.process_id()) else {
            continue;
        };
        let (width, height) = window.rect().map(rect_size).unwrap_or_default();
        let hwnd = HWND(window.as_raw_hwnd());
        let mut cloaked = 0_u32;
        // The handle comes from Win32 enumeration and the DWM output buffer is a DWORD.
        let metadata = unsafe {
            let cloak_known = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                std::ptr::from_mut(&mut cloaked).cast(),
                size_of::<u32>() as u32,
            )
            .is_ok();
            WindowMetadata {
                title: &title,
                width,
                height,
                visible: IsWindowVisible(hwnd).as_bool(),
                minimized: IsIconic(hwnd).as_bool(),
                cloaked: cloak_known && cloaked != 0,
                tool_window: GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0,
                owned: GetWindow(hwnd, GW_OWNER).is_ok(),
            }
        };
        if !metadata.is_shareable() {
            continue;
        }
        let process_name = window.process_name().ok();
        let own_process = process_name.as_deref().is_some_and(|name| {
            let name = name.to_ascii_lowercase();
            matches!(
                name.trim_end_matches(".exe"),
                "stackcall" | "stackcall-core"
            )
        });
        if Some(pid) == app_pid || pid == std::process::id() || own_process {
            continue;
        }
        let minimized = metadata.minimized;
        let size = if minimized {
            let mut placement = WINDOWPLACEMENT {
                length: size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            let restored = unsafe { GetWindowPlacement(hwnd, &mut placement) }
                .ok()
                .map(|()| rect_size(placement.rcNormalPosition));
            let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
            // A minimized game can keep its fullscreen popup style after losing the display mode.
            let fullscreen_hint =
                style & WS_POPUP.0 != 0 && style & (WS_CAPTION.0 | WS_THICKFRAME.0) == 0;
            minimized_window_size(restored, window_monitor_size(hwnd), fullscreen_hint)
        } else {
            Some((width, height))
        };
        let (width, height) = size.unzip();
        if !minimized {
            thumbnails.push((sources.len(), ThumbnailTarget::Window(window)));
        }
        sources.push(SourceInfo {
            id: format!("hwnd:{}:{pid}", window.as_raw_hwnd() as usize),
            title,
            process_name,
            pid: Some(pid),
            width,
            height,
            minimized,
            thumbnail: None,
        });
    }
    for batch in thumbnails.chunks(8) {
        thread::scope(|scope| {
            let workers: Vec<_> = batch
                .iter()
                .map(|&(index, target)| {
                    let handle = scope.spawn(move || match target {
                        ThumbnailTarget::Monitor(monitor) => thumbnail(monitor),
                        ThumbnailTarget::Window(window) => thumbnail(window),
                    });
                    (index, handle)
                })
                .collect();
            for (index, handle) in workers {
                sources[index].thumbnail = handle.join().ok().flatten();
            }
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

#[cfg(test)]
mod tests {
    use super::{WindowMetadata, minimized_window_size};

    #[test]
    fn filters_windows_before_capturing_thumbnails() {
        let normal = WindowMetadata {
            title: "Counter-Strike 2",
            width: 1920,
            height: 1080,
            visible: true,
            minimized: false,
            cloaked: false,
            tool_window: false,
            owned: false,
        };

        assert!(normal.is_shareable());
        for excluded in [
            WindowMetadata {
                cloaked: true,
                ..normal
            },
            WindowMetadata {
                width: 160,
                height: 28,
                ..normal
            },
            WindowMetadata {
                width: 319,
                ..normal
            },
            WindowMetadata {
                height: 199,
                ..normal
            },
            WindowMetadata {
                title: "",
                ..normal
            },
            WindowMetadata {
                title: " \t ",
                ..normal
            },
            WindowMetadata {
                visible: false,
                ..normal
            },
            WindowMetadata {
                tool_window: true,
                ..normal
            },
            WindowMetadata {
                owned: true,
                ..normal
            },
        ] {
            assert!(!excluded.is_shareable());
        }
        assert!(
            WindowMetadata {
                width: 320,
                height: 200,
                ..normal
            }
            .is_shareable()
        );
        assert!(
            WindowMetadata {
                minimized: true,
                width: 160,
                height: 28,
                ..normal
            }
            .is_shareable()
        );
    }

    #[test]
    fn sizes_minimized_windows_by_restored_position_or_monitor() {
        let monitor = Some((1920, 1080));
        assert_eq!(
            minimized_window_size(Some((160, 28)), monitor, false),
            monitor
        );
        assert_eq!(
            minimized_window_size(Some((800, 600)), monitor, false),
            Some((800, 600))
        );
        assert_eq!(
            minimized_window_size(Some((800, 600)), monitor, true),
            monitor
        );
        assert_eq!(minimized_window_size(None, monitor, false), monitor);
        assert_eq!(minimized_window_size(Some((160, 28)), None, false), None);
    }
}
