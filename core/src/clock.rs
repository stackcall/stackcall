use anyhow::Result;
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::*,
        System::{LibraryLoader::GetModuleHandleW, SystemInformation::GetLocalTime},
        UI::WindowsAndMessaging::*,
    },
    core::w,
};

pub fn run() -> Result<()> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class = w!("StackcallClock");
        let definition = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: class,
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            ..Default::default()
        };
        anyhow::ensure!(
            RegisterClassW(&definition) != 0,
            "could not register clock window"
        );
        let window = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            w!("Stackcall Clock"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            650,
            210,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        anyhow::ensure!(
            SetTimer(Some(window), 1, 10, None) != 0,
            "could not start clock timer"
        );
        let mut message = MSG::default();
        loop {
            match GetMessageW(&mut message, None, 0, 0).0 {
                -1 => return Err(windows::core::Error::from_thread().into()),
                0 => return Ok(()),
                _ => {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            WM_TIMER => {
                let _ = InvalidateRect(Some(window), None, false);
            }
            WM_PAINT => {
                let mut paint = PAINTSTRUCT::default();
                let dc = BeginPaint(window, &mut paint);
                let mut rect = RECT::default();
                let _ = GetClientRect(window, &mut rect);
                FillRect(dc, &rect, HBRUSH(GetStockObject(WHITE_BRUSH).0));
                let font = CreateFontW(
                    72,
                    0,
                    0,
                    0,
                    700,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    DEFAULT_QUALITY,
                    0,
                    w!("Consolas"),
                );
                let old = SelectObject(dc, font.into());
                let time = GetLocalTime();
                let mut label: Vec<_> = format!(
                    "{:02}:{:02}:{:02}.{:03}",
                    time.wHour, time.wMinute, time.wSecond, time.wMilliseconds
                )
                .encode_utf16()
                .collect();
                DrawTextW(
                    dc,
                    &mut label,
                    &mut rect,
                    DT_SINGLELINE | DT_CENTER | DT_VCENTER,
                );
                SelectObject(dc, old);
                let _ = DeleteObject(font.into());
                let _ = EndPaint(window, &paint);
            }
            WM_DESTROY => PostQuitMessage(0),
            _ => return DefWindowProcW(window, message, wparam, lparam),
        }
        LRESULT(0)
    }
}
