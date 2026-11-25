mod keys;
mod raw_input;
#[cfg(test)]
mod tests;

use std::{collections::HashSet, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use self::{
    keys::{Combo, Key},
    raw_input::Worker,
};

#[derive(Deserialize)]
pub struct Atalho {
    id: String,
    teclas: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Edge {
    Pressionado,
    Solto,
}

#[derive(Clone, Serialize)]
struct ShortcutEvent<'a> {
    id: &'a str,
    estado: Edge,
}

type RecordingResult = Result<Option<String>, String>;

enum Request {
    Replace(Vec<Binding>, oneshot::Sender<Result<(), String>>),
    Record(oneshot::Sender<RecordingResult>),
}

#[derive(Default)]
pub struct Hotkeys(Mutex<Option<Worker>>);

impl Hotkeys {
    fn submit(&self, app: AppHandle, request: Request) -> Result<(), String> {
        let mut worker = self.0.lock().map_err(|e| e.to_string())?;
        if worker.as_ref().is_some_and(Worker::is_finished) {
            worker.take();
        }
        if let Some(worker) = worker.as_ref() {
            return worker.post(request);
        }
        match request {
            Request::Replace(bindings, reply) if bindings.is_empty() => {
                let _ = reply.send(Ok(()));
            }
            request => {
                let started = Worker::start(move |id, estado| {
                    let _ = app.emit("atalho", ShortcutEvent { id, estado });
                })?;
                started.post(request)?;
                *worker = Some(started);
            }
        }
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut worker) = self.0.lock() {
            worker.take();
        }
    }
}

#[tauri::command]
pub async fn atalhos_definir(
    app: AppHandle,
    state: State<'_, Hotkeys>,
    atalhos: Vec<Atalho>,
) -> Result<(), String> {
    let bindings = parse_bindings(atalhos)?;
    let (reply, result) = oneshot::channel();
    state.submit(app, Request::Replace(bindings, reply))?;
    result
        .await
        .map_err(|_| "A escuta de atalhos foi encerrada.")?
}

#[tauri::command]
pub async fn atalhos_gravar(app: AppHandle, state: State<'_, Hotkeys>) -> RecordingResult {
    let (reply, result) = oneshot::channel();
    state.submit(app, Request::Record(reply))?;
    result
        .await
        .map_err(|_| "A escuta de atalhos foi encerrada.")?
}

#[derive(Debug)]
struct Binding {
    id: String,
    combo: Combo,
    active: bool,
}

fn parse_bindings(atalhos: Vec<Atalho>) -> Result<Vec<Binding>, String> {
    let mut ids = HashSet::new();
    for atalho in &atalhos {
        if atalho.id.trim().is_empty() {
            return Err("O identificador do atalho está vazio.".into());
        }
        if !ids.insert(&atalho.id) {
            return Err(format!("Identificador de atalho repetido: {}.", atalho.id));
        }
    }
    atalhos
        .into_iter()
        .map(|atalho| {
            let combo = Combo::parse(&atalho.teclas)
                .map_err(|error| format!("Atalho {:?}: {error}", atalho.id))?;
            Ok(Binding {
                id: atalho.id,
                combo,
                active: false,
            })
        })
        .collect()
}

#[derive(Default)]
struct Matcher {
    bindings: Vec<Binding>,
    pressed: HashSet<(usize, Key)>,
    suppressed: HashSet<Key>,
    recording: bool,
}

// A modifier already held when Windows registration starts has no device packet yet.
const INITIAL_DEVICE: usize = usize::MAX;

impl Matcher {
    fn replace(&mut self, mut bindings: Vec<Binding>, emit: &mut impl FnMut(&str, Edge)) {
        if self
            .bindings
            .iter()
            .map(|b| (&b.id, b.combo))
            .eq(bindings.iter().map(|b| (&b.id, b.combo)))
        {
            return;
        }
        for old in self.bindings.iter().filter(|binding| binding.active) {
            if let Some(same) = bindings
                .iter_mut()
                .find(|new| new.id == old.id && new.combo == old.combo)
            {
                same.active = true;
            } else {
                emit(&old.id, Edge::Solto);
            }
        }
        self.suppress_held();
        self.bindings = bindings;
    }

    fn start_recording(&mut self, emit: &mut impl FnMut(&str, Edge)) {
        for binding in self.bindings.iter_mut().filter(|binding| binding.active) {
            binding.active = false;
            emit(&binding.id, Edge::Solto);
        }
        self.recording = true;
    }

    fn end_recording(&mut self) {
        self.recording = false;
        self.suppress_held();
    }

    fn suppress_held(&mut self) {
        self.suppressed.extend(
            self.pressed
                .iter()
                .filter_map(|&(_, key)| (key.modifier() == 0).then_some(key)),
        );
    }

    fn remove_device(&mut self, device: usize, emit: &mut impl FnMut(&str, Edge)) {
        self.pressed.retain(|&(which, _)| which != device);
        self.release_missing(emit);
    }

    fn release_missing(&mut self, emit: &mut impl FnMut(&str, Edge)) {
        let pressed = &self.pressed;
        let down = |key| pressed.iter().any(|&(_, held)| held == key);
        self.suppressed.retain(|&key| down(key));
        for binding in self
            .bindings
            .iter_mut()
            .filter(|b| b.active && !down(b.combo.main))
        {
            binding.active = false;
            emit(&binding.id, Edge::Solto);
        }
    }

    fn forget_unregistered(&mut self, keyboard: bool, mouse: bool) {
        let registered = |key: Key| if key.is_mouse() { mouse } else { keyboard };
        self.pressed.retain(|&(_, key)| registered(key));
        self.suppressed.retain(|&key| registered(key));
    }

    fn seed_modifier(&mut self, key: Key) {
        self.pressed.insert((INITIAL_DEVICE, key));
    }

    fn input(
        &mut self,
        device: usize,
        key: Key,
        down: bool,
        emit: &mut impl FnMut(&str, Edge),
    ) -> Option<RecordingResult> {
        let seeded = self.pressed.remove(&(INITIAL_DEVICE, key));
        if !down {
            if self.pressed.remove(&(device, key)) || seeded {
                self.release_missing(emit);
            }
            return None;
        }

        let already_down = seeded || self.pressed.iter().any(|&(_, held)| held == key);
        self.pressed.insert((device, key));
        if already_down {
            return None;
        }

        let modifiers = self
            .pressed
            .iter()
            .fold(0, |flags, &(_, key)| flags | key.modifier());
        if self.recording {
            return Combo {
                main: key,
                modifiers,
            }
            .recorded();
        }

        for binding in &mut self.bindings {
            let main = binding.combo.main;
            let closes = main == key
                || (key.modifier() != 0 && self.pressed.iter().any(|&(_, held)| held == main));
            if !binding.active
                && closes
                && modifiers == binding.combo.modifiers
                && !self.suppressed.contains(&main)
            {
                binding.active = true;
                emit(&binding.id, Edge::Pressionado);
            }
        }
        None
    }
}
