use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

pub(super) const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const WIN: u8 = 8;
const MODIFIERS: [(&str, u8); 4] = [("Ctrl", CTRL), ("Alt", ALT), ("Shift", SHIFT), ("Win", WIN)];
pub(super) const NUM_ENTER: u16 = 0x100 | VK_RETURN;

const NAMED: &[(&str, u16)] = &[
    ("Mouse1", VK_LBUTTON),
    ("Mouse2", VK_RBUTTON),
    ("Mouse3", VK_MBUTTON),
    ("Mouse4", VK_XBUTTON1),
    ("Mouse5", VK_XBUTTON2),
    ("Escape", VK_ESCAPE),
    ("Space", VK_SPACE),
    ("Tab", VK_TAB),
    ("Enter", VK_RETURN),
    ("Backspace", VK_BACK),
    ("Delete", VK_DELETE),
    ("Insert", VK_INSERT),
    ("Home", VK_HOME),
    ("End", VK_END),
    ("PageUp", VK_PRIOR),
    ("PageDown", VK_NEXT),
    ("ArrowLeft", VK_LEFT),
    ("ArrowUp", VK_UP),
    ("ArrowRight", VK_RIGHT),
    ("ArrowDown", VK_DOWN),
    ("CapsLock", VK_CAPITAL),
    ("NumLock", VK_NUMLOCK),
    ("ScrollLock", VK_SCROLL),
    ("PrintScreen", VK_SNAPSHOT),
    ("ContextMenu", VK_APPS),
    ("NumEnter", NUM_ENTER),
    ("NumAdd", VK_ADD),
    ("NumSubtract", VK_SUBTRACT),
    ("NumMultiply", VK_MULTIPLY),
    ("NumDivide", VK_DIVIDE),
    ("NumDecimal", VK_DECIMAL),
    ("NumSeparator", VK_SEPARATOR),
    ("Equal", VK_OEM_PLUS),
    ("Minus", VK_OEM_MINUS),
    ("Comma", VK_OEM_COMMA),
    ("Period", VK_OEM_PERIOD),
    ("Semicolon", VK_OEM_1),
    ("Slash", VK_OEM_2),
    ("Backquote", VK_OEM_3),
    ("BracketLeft", VK_OEM_4),
    ("Backslash", VK_OEM_5),
    ("BracketRight", VK_OEM_6),
    ("Quote", VK_OEM_7),
    ("IntlBackslash", VK_OEM_102),
];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct Key(pub(super) u16);

impl Key {
    fn parse(text: &str) -> Option<Self> {
        let text = text.to_ascii_uppercase();
        let key = match text.as_bytes() {
            [key @ (b'A'..=b'Z' | b'0'..=b'9')] => u16::from(*key),
            [b'F', ..] => {
                let n: u16 = text[1..].parse().ok()?;
                if !(1..=24).contains(&n) {
                    return None;
                }
                VK_F1 + n - 1
            }
            [b'N', b'U', b'M', digit @ b'0'..=b'9'] => VK_NUMPAD0 + u16::from(*digit - b'0'),
            _ if text == "ESC" => VK_ESCAPE,
            _ if text == "DEL" => VK_DELETE,
            _ => {
                NAMED
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case(&text))?
                    .1
            }
        };
        Some(Self(key))
    }

    fn name(self) -> Option<String> {
        Some(match self.0 {
            VK_A..=VK_Z | VK_0..=VK_9 => char::from_u32(u32::from(self.0))?.to_string(),
            VK_F1..=VK_F24 => format!("F{}", self.0 - VK_F1 + 1),
            VK_NUMPAD0..=VK_NUMPAD9 => format!("Num{}", self.0 - VK_NUMPAD0),
            key => NAMED.iter().find(|(_, code)| *code == key)?.0.to_owned(),
        })
    }

    pub(super) fn modifier(self) -> u8 {
        match self.0 {
            VK_CONTROL | VK_LCONTROL | VK_RCONTROL => CTRL,
            VK_MENU | VK_LMENU | VK_RMENU => ALT,
            VK_SHIFT | VK_LSHIFT | VK_RSHIFT => SHIFT,
            VK_LWIN | VK_RWIN => WIN,
            _ => 0,
        }
    }

    pub(super) fn is_mouse(self) -> bool {
        matches!(
            self.0,
            VK_LBUTTON | VK_RBUTTON | VK_MBUTTON | VK_XBUTTON1 | VK_XBUTTON2
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct Combo {
    pub(super) main: Key,
    pub(super) modifiers: u8,
}

impl Combo {
    pub(super) fn parse(text: &str) -> Result<Self, String> {
        let mut parts = text.split('+').map(str::trim);
        let main = parts.next_back().and_then(Key::parse).ok_or_else(|| {
            "Informe uma tecla ou um botão do mouse depois dos modificadores.".to_owned()
        })?;
        let mut modifiers = 0;
        for part in parts {
            let Some((_, flag)) = MODIFIERS
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(part))
            else {
                return Err(format!(
                    "Modificador inválido: {part:?}. Use Ctrl, Alt, Shift ou Win."
                ));
            };
            if modifiers & flag != 0 {
                return Err(format!("Modificador repetido: {part}."));
            }
            modifiers |= flag;
        }
        let combo = Self { main, modifiers };
        combo.validate()?;
        Ok(combo)
    }

    fn validate(self) -> Result<(), String> {
        if self.modifiers & (CTRL | ALT) == CTRL | ALT
            && matches!(self.main.0, VK_DELETE | VK_DECIMAL)
        {
            return Err("Ctrl+Alt+Del é reservado pelo Windows.".into());
        }
        if self.modifiers & WIN != 0 && self.main.0 == VK_L {
            return Err("Win+L é reservado pelo Windows.".into());
        }
        Ok(())
    }

    pub(super) fn recorded(self) -> Option<Result<Option<String>, String>> {
        if self.main.0 == VK_ESCAPE {
            return Some(Ok(None));
        }
        let name = self.main.name()?;
        Some(self.validate().map(|()| {
            let mut text = String::new();
            for (name, flag) in MODIFIERS {
                if self.modifiers & flag != 0 {
                    text.push_str(name);
                    text.push('+');
                }
            }
            text.push_str(&name);
            Some(text)
        }))
    }
}
