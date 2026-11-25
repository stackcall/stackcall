use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    VK_ESCAPE, VK_LCONTROL, VK_LSHIFT, VK_M, VK_RCONTROL, VK_XBUTTON1, VK_XBUTTON2,
};

use super::*;

#[test]
fn canonical_shortcut_names_round_trip() {
    for (input, expected) in [
        (" shift + Ctrl + m ", "Ctrl+Shift+M"),
        ("alt+F9", "Alt+F9"),
        ("win+mouse5", "Win+Mouse5"),
        ("mouse4", "Mouse4"),
        ("f13", "F13"),
        ("f24", "F24"),
        ("num0", "Num0"),
        ("NumEnter", "NumEnter"),
        ("0", "0"),
        ("del", "Delete"),
    ] {
        let combo = Combo::parse(input).unwrap();
        assert_eq!(
            combo.recorded().unwrap().unwrap().as_deref(),
            Some(expected)
        );
        assert_eq!(Combo::parse(expected).unwrap(), combo);
    }
    assert_ne!(Combo::parse("Num0").unwrap(), Combo::parse("0").unwrap());
}

#[test]
fn rejects_invalid_and_reserved_shortcuts() {
    for text in [
        "",
        "Ctrl",
        "Alt+Shift",
        "Ctrl+",
        "M+Q",
        "Ctrl++M",
        "Shift+Shift+M",
        "F25",
        "Num10",
        "Mouse6",
    ] {
        assert!(Combo::parse(text).is_err(), "accepted {text}");
    }
    for text in [
        "Ctrl+Alt+Del",
        "Alt+Shift+Ctrl+Delete",
        "Ctrl+Alt+NumDecimal",
        "Win+L",
    ] {
        assert!(
            Combo::parse(text).unwrap_err().contains("reservado"),
            "{text}"
        );
    }
    assert!(parse_bindings(vec![Atalho {
        id: " ".into(),
        teclas: "F13".into()
    }])
    .is_err());
    let duplicate = [("mic", "F13"), ("mic", "F14")].map(|(id, teclas)| Atalho {
        id: id.into(),
        teclas: teclas.into(),
    });
    assert!(parse_bindings(Vec::from(duplicate)).is_err());
}

fn bindings(config: &[(&str, &str)]) -> Vec<Binding> {
    parse_bindings(
        config
            .iter()
            .map(|&(id, teclas)| Atalho {
                id: id.into(),
                teclas: teclas.into(),
            })
            .collect(),
    )
    .unwrap()
}

#[test]
fn combination_closes_when_last_key_is_pressed_and_releases_with_main_key() {
    let mut matcher = Matcher {
        bindings: bindings(&[("mic", "Ctrl+Shift+M"), ("plain", "M")]),
        ..Matcher::default()
    };
    let mut events = Vec::new();
    let mut emit = |id: &str, edge| events.push((id.to_owned(), edge));
    for (key, down) in [
        (VK_LCONTROL, true),
        (VK_M, true),
        (VK_M, true),
        (VK_LSHIFT, true),
        (VK_M, true),
        (VK_LCONTROL, false),
        (VK_LSHIFT, false),
        (VK_M, false),
        (VK_M, false),
    ] {
        assert!(matcher.input(1, Key(key), down, &mut emit).is_none());
    }
    assert_eq!(
        events,
        [
            ("mic".into(), Edge::Pressionado),
            ("mic".into(), Edge::Solto)
        ]
    );
}

#[test]
fn left_and_right_modifiers_stay_independent() {
    let mut matcher = Matcher {
        bindings: bindings(&[("mic", "Ctrl+M")]),
        ..Matcher::default()
    };
    let mut events = Vec::new();
    for (key, down) in [
        (VK_LCONTROL, true),
        (VK_RCONTROL, true),
        (VK_LCONTROL, false),
        (VK_M, true),
        (VK_M, false),
    ] {
        matcher.input(1, Key(key), down, &mut |_, edge| events.push(edge));
    }
    assert_eq!(events, [Edge::Pressionado, Edge::Solto]);
}

#[test]
fn modifier_held_before_registration_is_cleared_on_release() {
    let mut matcher = Matcher {
        bindings: bindings(&[("mic", "Ctrl+M"), ("plain", "M")]),
        ..Matcher::default()
    };
    let mut pressed = Vec::new();
    let mut emit = |id: &str, edge| {
        if edge == Edge::Pressionado {
            pressed.push(id.to_owned());
        }
    };
    matcher.seed_modifier(Key(VK_LCONTROL));
    matcher.input(1, Key(VK_M), true, &mut emit);
    matcher.input(1, Key(VK_M), false, &mut emit);
    matcher.input(1, Key(VK_LCONTROL), false, &mut emit);
    matcher.input(1, Key(VK_M), true, &mut emit);
    assert_eq!(pressed, ["mic", "plain"]);
}

#[test]
fn mouse_buttons_and_unplug_release_independently() {
    let mut matcher = Matcher {
        bindings: bindings(&[("falar", "Mouse4"), ("mic", "Mouse5")]),
        ..Matcher::default()
    };
    let mut events = Vec::new();
    let mut emit = |id: &str, edge| events.push((id.to_owned(), edge));
    matcher.input(1, Key(VK_XBUTTON1), true, &mut emit);
    matcher.input(2, Key(VK_XBUTTON1), true, &mut emit);
    matcher.input(2, Key(VK_XBUTTON2), true, &mut emit);
    matcher.remove_device(2, &mut emit);
    matcher.input(1, Key(VK_XBUTTON1), false, &mut emit);
    assert_eq!(
        events,
        [
            ("falar".into(), Edge::Pressionado),
            ("mic".into(), Edge::Pressionado),
            ("mic".into(), Edge::Solto),
            ("falar".into(), Edge::Solto),
        ]
    );
}

#[test]
fn recording_releases_active_shortcuts_and_suppresses_input_until_release() {
    let mut matcher = Matcher {
        bindings: bindings(&[("falar", "Mouse4"), ("mic", "Ctrl+Mouse4")]),
        ..Matcher::default()
    };
    let mut events = Vec::new();
    let mut emit = |id: &str, edge| events.push((id.to_owned(), edge));
    matcher.input(1, Key(VK_XBUTTON1), true, &mut emit);
    matcher.start_recording(&mut emit);
    assert!(matcher
        .input(1, Key(VK_XBUTTON1), true, &mut emit)
        .is_none());
    matcher.input(1, Key(VK_XBUTTON1), false, &mut emit);
    assert_eq!(
        matcher.input(1, Key(VK_XBUTTON1), true, &mut emit),
        Some(Ok(Some("Mouse4".into())))
    );
    matcher.end_recording();
    matcher.input(2, Key(VK_LCONTROL), true, &mut emit);
    matcher.input(1, Key(VK_XBUTTON1), false, &mut emit);
    matcher.input(1, Key(VK_XBUTTON1), true, &mut emit);
    matcher.input(1, Key(VK_XBUTTON1), false, &mut emit);
    matcher.start_recording(&mut emit);
    assert_eq!(
        matcher.input(1, Key(VK_ESCAPE), true, &mut emit),
        Some(Ok(None))
    );
    assert_eq!(
        events,
        [
            ("falar".into(), Edge::Pressionado),
            ("falar".into(), Edge::Solto),
            ("mic".into(), Edge::Pressionado),
            ("mic".into(), Edge::Solto),
        ]
    );
}

#[test]
fn reconfiguration_keeps_unchanged_shortcuts_and_releases_removed_ones() {
    let mut matcher = Matcher {
        bindings: bindings(&[("falar", "Mouse4")]),
        ..Matcher::default()
    };
    let mut events = Vec::new();
    let mut emit = |_: &str, edge| events.push(edge);
    matcher.input(1, Key(VK_XBUTTON1), true, &mut emit);
    matcher.replace(
        bindings(&[("falar", "Mouse4"), ("mic", "Ctrl+M")]),
        &mut emit,
    );
    matcher.replace(vec![], &mut emit);
    matcher.input(1, Key(VK_XBUTTON1), false, &mut emit);
    assert_eq!(events, [Edge::Pressionado, Edge::Solto]);
}
