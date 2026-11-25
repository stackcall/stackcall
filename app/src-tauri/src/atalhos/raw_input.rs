use std::{
    collections::VecDeque,
    io::Error,
    mem::size_of,
    ptr::{null, null_mut},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tokio::sync::oneshot;
use windows_sys::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM},
        UI::{
            Input::{KeyboardAndMouse::*, *},
            WindowsAndMessaging::*,
        },
    },
};

use super::{
    keys::{Key, NUM_ENTER},
    Binding, Edge, Matcher, RecordingResult, Request,
};

const WM_REQUEST: u32 = WM_APP + 1;
const RECORD_TIMER: usize = 1;
const RECORD_TIMEOUT: Duration = Duration::from_secs(10);

type Pending = Arc<Mutex<Option<VecDeque<Request>>>>;

pub(super) struct Worker {
    hwnd: usize,
    pending: Pending,
    thread: JoinHandle<()>,
}

impl Worker {
    pub(super) fn start(emit: impl FnMut(&str, Edge) + Send + 'static) -> Result<Self, String> {
        let pending = Arc::new(Mutex::new(Some(VecDeque::new())));
        let requests = Arc::clone(&pending);
        let (ready, window) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("atalhos-raw-input".into())
            .spawn(move || {
                let hwnd = match create_window() {
                    Ok(hwnd) => hwnd,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let mut input = RawInput {
                    hwnd,
                    classes: InputClasses::default(),
                    matcher: Matcher::default(),
                    recording: None,
                };
                if ready.send(Ok(hwnd as usize)).is_ok() {
                    input.run(&requests, emit);
                }
                // End outstanding commands if the Windows message loop stops unexpectedly.
                if let Ok(mut pending) = requests.lock() {
                    pending.take();
                }
            })
            .map_err(|error| format!("Não foi possível iniciar a escuta de atalhos: {error}"))?;
        let hwnd = window
            .recv()
            .map_err(|_| "A escuta de atalhos foi encerrada.")??;
        Ok(Self {
            hwnd,
            pending,
            thread,
        })
    }

    pub(super) fn is_finished(&self) -> bool {
        self.thread.is_finished()
    }

    pub(super) fn post(&self, request: Request) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let queue = pending
            .as_mut()
            .ok_or("A escuta de atalhos foi encerrada.")?;
        // SAFETY: only the window owned by our worker is targeted, with no pointer payload.
        if unsafe { PostMessageW(self.hwnd as HWND, WM_REQUEST, 0, 0) } == 0 {
            return Err(windows_error(
                "Não foi possível enviar o comando de atalhos",
            ));
        }
        queue.push_back(request);
        Ok(())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if !self.is_finished() {
            // SAFETY: sends a close message to our worker without blocking the Tauri event loop.
            unsafe { PostMessageW(self.hwnd as HWND, WM_CLOSE, 0, 0) };
        }
    }
}

fn create_window() -> Result<HWND, String> {
    // SAFETY: STATIC is a predefined class. HWND_MESSAGE makes the window message-only.
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            w!("STATIC"),
            null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            null_mut(),
            null(),
        )
    };
    if hwnd.is_null() {
        Err(windows_error("Não foi possível criar a janela de atalhos"))
    } else {
        Ok(hwnd)
    }
}

fn windows_error(context: &str) -> String {
    format!("{context}: {}", Error::last_os_error())
}

struct RawInput {
    hwnd: HWND,
    classes: InputClasses,
    matcher: Matcher,
    recording: Option<Recording>,
}

struct Recording {
    armed_at: u32,
    deadline: Instant,
    reply: oneshot::Sender<RecordingResult>,
}

#[derive(Default, Copy, Clone)]
struct InputClasses {
    keyboard: bool,
    mouse: bool,
}

impl InputClasses {
    fn for_bindings(bindings: &[Binding], recording: bool) -> Self {
        Self {
            keyboard: recording || !bindings.is_empty(),
            mouse: recording || bindings.iter().any(|b| b.combo.main.is_mouse()),
        }
    }
}

impl RawInput {
    fn run(&mut self, requests: &Pending, mut emit: impl FnMut(&str, Edge)) {
        let mut message = MSG::default();
        // SAFETY: GetMessage blocks until a message is available. The stack MSG is writable.
        while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
            match message.message {
                WM_CLOSE => break,
                WM_REQUEST => {
                    let request = requests
                        .lock()
                        .ok()
                        .and_then(|mut pending| pending.as_mut()?.pop_front());
                    if let Some(request) = request {
                        self.handle_request(request, message.time, &mut emit);
                    }
                }
                WM_TIMER if message.wParam == RECORD_TIMER => self.expire_recording(),
                WM_INPUT_DEVICE_CHANGE if message.wParam == GIDC_REMOVAL as usize => {
                    self.matcher
                        .remove_device(message.lParam as usize, &mut emit);
                }
                WM_INPUT => {
                    self.expire_recording();
                    // Posted commands can overtake Raw Input. Ignore the click that armed capture.
                    let capture = self.recording.as_ref().is_some_and(|recording| {
                        (message.time.wrapping_sub(recording.armed_at) as i32) > 0
                    });
                    let mut captured = None;
                    read_raw_input(message.lParam, |device, key, down| {
                        let registered = if key.is_mouse() {
                            self.classes.mouse
                        } else {
                            self.classes.keyboard
                        };
                        if registered {
                            let result = self.matcher.input(device, key, down, &mut emit);
                            if capture && captured.is_none() {
                                captured = result;
                            }
                        }
                    });
                    if let Some(result) = captured {
                        self.finish_recording(result);
                    }
                    // SAFETY: Win32 requires default processing for foreground WM_INPUT cleanup.
                    unsafe {
                        DefWindowProcW(self.hwnd, message.message, message.wParam, message.lParam)
                    };
                }
                // SAFETY: dispatch other Windows messages to their window procedure.
                _ => {
                    unsafe { DispatchMessageW(&message) };
                }
            };
        }
    }

    fn handle_request(
        &mut self,
        request: Request,
        armed_at: u32,
        emit: &mut impl FnMut(&str, Edge),
    ) {
        self.expire_recording();
        match request {
            Request::Replace(bindings, reply) => {
                let classes = InputClasses::for_bindings(&bindings, self.recording.is_some());
                let result = self
                    .set_classes(classes)
                    .map(|()| self.matcher.replace(bindings, emit));
                let _ = reply.send(result);
            }
            Request::Record(reply) => {
                if self.recording.is_some() {
                    let _ = reply.send(Err("Já há uma gravação de atalho em andamento.".into()));
                    return;
                }
                let deadline = Instant::now() + RECORD_TIMEOUT;
                // SAFETY: our live window owns this timer, which only runs during capture.
                if unsafe {
                    SetTimer(
                        self.hwnd,
                        RECORD_TIMER,
                        RECORD_TIMEOUT.as_millis() as u32,
                        None,
                    )
                } == 0
                {
                    let _ = reply.send(Err(windows_error(
                        "Não foi possível iniciar o tempo de gravação",
                    )));
                    return;
                }
                let classes = InputClasses::for_bindings(&self.matcher.bindings, true);
                if let Err(error) = self.set_classes(classes) {
                    // SAFETY: removes the timer just installed on our live window.
                    unsafe { KillTimer(self.hwnd, RECORD_TIMER) };
                    let _ = reply.send(Err(error));
                    return;
                }
                self.matcher.start_recording(emit);
                self.recording = Some(Recording {
                    armed_at,
                    deadline,
                    reply,
                });
            }
        }
    }

    fn expire_recording(&mut self) {
        if self
            .recording
            .as_ref()
            .is_some_and(|recording| Instant::now() >= recording.deadline)
        {
            self.finish_recording(Ok(None));
        }
    }

    fn finish_recording(&mut self, result: RecordingResult) {
        if let Some(recording) = self.recording.take() {
            // SAFETY: removes the recording timer owned by this live window.
            unsafe { KillTimer(self.hwnd, RECORD_TIMER) };
            self.matcher.end_recording();
            let classes = InputClasses::for_bindings(&self.matcher.bindings, false);
            let _ = recording.reply.send(self.set_classes(classes).and(result));
        }
    }

    fn set_classes(&mut self, wanted: InputClasses) -> Result<(), String> {
        let updates: Vec<_> = [
            (0x06, self.classes.keyboard, wanted.keyboard),
            (0x02, self.classes.mouse, wanted.mouse),
        ]
        .into_iter()
        .filter(|&(_, current, wanted)| current != wanted)
        .map(|(usage, _, enabled)| RAWINPUTDEVICE {
            usUsagePage: 0x01, // HID Generic Desktop Controls.
            usUsage: usage,
            dwFlags: if enabled {
                RIDEV_INPUTSINK | RIDEV_DEVNOTIFY
            } else {
                RIDEV_REMOVE
            },
            hwndTarget: if enabled { self.hwnd } else { null_mut() },
        })
        .collect();
        // SAFETY: updates contains exactly the number of initialized registrations passed.
        if !updates.is_empty()
            && unsafe {
                RegisterRawInputDevices(
                    updates.as_ptr(),
                    updates.len() as u32,
                    size_of::<RAWINPUTDEVICE>() as u32,
                )
            } == 0
        {
            return Err(windows_error(
                "Não foi possível configurar a escuta de teclado e mouse",
            ));
        }
        if wanted.keyboard && !self.classes.keyboard {
            // SAFETY: the high bit reports each modifier's state when registration begins.
            for key in [
                VK_LCONTROL,
                VK_RCONTROL,
                VK_LMENU,
                VK_RMENU,
                VK_LSHIFT,
                VK_RSHIFT,
                VK_LWIN,
                VK_RWIN,
            ] {
                if unsafe { GetAsyncKeyState(i32::from(key)) } < 0 {
                    self.matcher.seed_modifier(Key(key));
                }
            }
        }
        self.classes = wanted;
        self.matcher
            .forget_unregistered(wanted.keyboard, wanted.mouse);
        Ok(())
    }
}

impl Drop for RawInput {
    fn drop(&mut self) {
        let _ = self.set_classes(InputClasses::default());
        // SAFETY: the window was created on this thread and DestroyWindow also removes its timer.
        unsafe { DestroyWindow(self.hwnd) };
    }
}

fn read_raw_input(lparam: LPARAM, mut input: impl FnMut(usize, Key, bool)) {
    let mut record = RAWINPUT::default();
    let mut bytes = size_of::<RAWINPUT>() as u32;
    // SAFETY: lparam is the WM_INPUT handle, and the aligned stack buffer fits keyboard and mouse records.
    let read = unsafe {
        GetRawInputData(
            lparam as HRAWINPUT,
            RID_INPUT,
            (&mut record as *mut RAWINPUT).cast(),
            &mut bytes,
            size_of::<RAWINPUTHEADER>() as u32,
        )
    } as usize;
    let device = record.header.hDevice as usize;
    let header = size_of::<RAWINPUTHEADER>();
    if read == u32::MAX as usize {
        return;
    }
    match record.header.dwType {
        RIM_TYPEKEYBOARD if read >= header + size_of::<RAWKEYBOARD>() => {
            // SAFETY: type and size identify the keyboard member written by GetRawInputData.
            let keyboard = unsafe { record.data.keyboard };
            if let Some(key) = keyboard_key(&keyboard) {
                input(device, key, u32::from(keyboard.Flags) & RI_KEY_BREAK == 0);
            }
        }
        RIM_TYPEMOUSE if read >= header + size_of::<RAWMOUSE>() => {
            // SAFETY: type and size identify the mouse member; the union also holds button flags.
            let flags = unsafe { record.data.mouse.Anonymous.Anonymous.usButtonFlags };
            mouse_buttons(u32::from(flags), |key, down| input(device, key, down));
        }
        _ => {}
    }
}

fn keyboard_key(raw: &RAWKEYBOARD) -> Option<Key> {
    let flags = u32::from(raw.Flags);
    let extended = flags & RI_KEY_E0 != 0;
    let key = match raw.VKey {
        0 | 255 => return None,
        VK_SHIFT if extended => return None, // Fake shift around Print Screen or keypad events.
        VK_SHIFT if raw.MakeCode == 0x36 => VK_RSHIFT,
        VK_SHIFT => VK_LSHIFT,
        VK_CONTROL if extended => VK_RCONTROL,
        VK_CONTROL => VK_LCONTROL,
        VK_MENU if extended => VK_RMENU,
        VK_MENU => VK_LMENU,
        VK_RETURN if extended => NUM_ENTER,
        VK_INSERT | VK_END | VK_DOWN | VK_NEXT | VK_LEFT | VK_CLEAR | VK_RIGHT | VK_HOME
        | VK_UP | VK_PRIOR | VK_DELETE
            if flags & (RI_KEY_E0 | RI_KEY_E1) == 0 =>
        {
            match raw.MakeCode {
                0x52 => VK_NUMPAD0,
                0x4f => VK_NUMPAD1,
                0x50 => VK_NUMPAD2,
                0x51 => VK_NUMPAD3,
                0x4b => VK_NUMPAD4,
                0x4c => VK_NUMPAD5,
                0x4d => VK_NUMPAD6,
                0x47 => VK_NUMPAD7,
                0x48 => VK_NUMPAD8,
                0x49 => VK_NUMPAD9,
                0x53 => VK_DECIMAL,
                _ => raw.VKey,
            }
        }
        key => key,
    };
    Some(Key(key))
}

fn mouse_buttons(flags: u32, mut input: impl FnMut(Key, bool)) {
    if flags & 0x03ff == 0 {
        return;
    }
    for (key, press, release) in [
        (VK_LBUTTON, RI_MOUSE_BUTTON_1_DOWN, RI_MOUSE_BUTTON_1_UP),
        (VK_RBUTTON, RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_2_UP),
        (VK_MBUTTON, RI_MOUSE_BUTTON_3_DOWN, RI_MOUSE_BUTTON_3_UP),
        (VK_XBUTTON1, RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_4_UP),
        (VK_XBUTTON2, RI_MOUSE_BUTTON_5_DOWN, RI_MOUSE_BUTTON_5_UP),
    ] {
        if flags & press != 0 {
            input(Key(key), true);
        }
        if flags & release != 0 {
            input(Key(key), false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_extended_keys_and_numpad_with_numlock_off() {
        let key = |vkey, scan, flags| {
            keyboard_key(&RAWKEYBOARD {
                VKey: vkey,
                MakeCode: scan,
                Flags: flags as u16,
                ..Default::default()
            })
        };
        assert_eq!(key(VK_F13, 0, 0), Some(Key(VK_F13)));
        assert_eq!(key(VK_CONTROL, 0x1d, 0), Some(Key(VK_LCONTROL)));
        assert_eq!(key(VK_CONTROL, 0x1d, RI_KEY_E0), Some(Key(VK_RCONTROL)));
        assert_eq!(key(VK_SHIFT, 0x36, 0), Some(Key(VK_RSHIFT)));
        assert_eq!(key(VK_SHIFT, 0x2a, RI_KEY_E0), None);
        assert_eq!(
            key(VK_RETURN, 0x1c, RI_KEY_E0 | RI_KEY_BREAK),
            Some(Key(NUM_ENTER))
        );
        assert_eq!(key(VK_INSERT, 0x52, 0), Some(Key(VK_NUMPAD0)));
        assert_eq!(key(VK_NUMPAD0, 0x52, RI_KEY_BREAK), Some(Key(VK_NUMPAD0)));
        assert_eq!(key(VK_INSERT, 0x52, RI_KEY_E0), Some(Key(VK_INSERT)));
        assert_eq!(key(255, 0, 0), None);
    }

    #[test]
    fn decodes_mouse_side_buttons_but_ignores_motion_and_wheel() {
        let mut events = Vec::new();
        let mut emit = |key, down| events.push((key, down));
        mouse_buttons(0, &mut emit);
        mouse_buttons(RI_MOUSE_WHEEL, &mut emit);
        mouse_buttons(RI_MOUSE_BUTTON_4_DOWN | RI_MOUSE_BUTTON_5_UP, &mut emit);
        mouse_buttons(RI_MOUSE_BUTTON_4_UP | RI_MOUSE_BUTTON_5_DOWN, &mut emit);
        assert_eq!(
            events,
            [
                (Key(VK_XBUTTON1), true),
                (Key(VK_XBUTTON2), false),
                (Key(VK_XBUTTON1), false),
                (Key(VK_XBUTTON2), true)
            ]
        );
    }

    #[tokio::test]
    #[ignore = "requires an interactive Windows desktop"]
    async fn windows_worker_registers_only_needed_devices_and_idles() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::FILETIME, System::Threading::GetThreadTimes};

        async fn replace(worker: &Worker, keys: Option<&str>) {
            let bindings = keys
                .into_iter()
                .map(|keys| Binding {
                    id: "smoke".into(),
                    combo: super::super::Combo::parse(keys).unwrap(),
                    active: false,
                })
                .collect();
            let (reply, result) = oneshot::channel();
            worker.post(Request::Replace(bindings, reply)).unwrap();
            tokio::time::timeout(Duration::from_secs(2), result)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        }

        let worker = Worker::start(|_, _| {}).unwrap();
        let registrations = || {
            let mut devices = [RAWINPUTDEVICE::default(); 2];
            let mut count = devices.len() as u32;
            // SAFETY: the two slots are writable, and this test is the only registration owner.
            let read = unsafe {
                GetRegisteredRawInputDevices(
                    devices.as_mut_ptr(),
                    &mut count,
                    size_of::<RAWINPUTDEVICE>() as u32,
                )
            };
            assert_ne!(read, u32::MAX);
            devices
                .into_iter()
                .take(read as usize)
                .map(|device| {
                    assert_eq!(device.hwndTarget as usize, worker.hwnd);
                    // The registration query can omit RIDEV_DEVNOTIFY.
                    assert_eq!(device.dwFlags & !RIDEV_DEVNOTIFY, RIDEV_INPUTSINK);
                    device.usUsage
                })
                .collect::<Vec<_>>()
        };
        assert!(registrations().is_empty());
        replace(&worker, Some("F24")).await;
        assert_eq!(registrations(), [0x06]);
        replace(&worker, Some("Mouse4")).await;
        let mut both = registrations();
        both.sort_unstable();
        assert_eq!(both, [0x02, 0x06]);

        let cpu_time = || {
            let (mut created, mut exited, mut system, mut user) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            // SAFETY: JoinHandle owns the thread handle, and all four out pointers are writable.
            assert_ne!(
                unsafe {
                    GetThreadTimes(
                        worker.thread.as_raw_handle(),
                        &mut created,
                        &mut exited,
                        &mut system,
                        &mut user,
                    )
                },
                0
            );
            let ticks = |time: FILETIME| {
                (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
            };
            ticks(system) + ticks(user)
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        let before = cpu_time();
        tokio::time::sleep(Duration::from_secs(1)).await;
        println!(
            "CPU da thread durante 1 s sem entrada: {:.4} ms",
            (cpu_time() - before) as f64 / 10_000.0
        );

        replace(&worker, None).await;
        assert!(registrations().is_empty());
    }
}
