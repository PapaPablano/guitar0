// Tab Highway desktop shell. It does four jobs: locate the bundled stem engine, run first-launch setup,
// start and stop the engine, and report that state to the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod setup;

use std::collections::HashMap;
use std::fs;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::RunEvent;

#[derive(Clone, Serialize, Default)]
struct Status {
    /// setup-needed | setting-up | setup-failed | starting | ready | engine-error
    phase: String,
    progress: Option<f64>,
    message: Option<String>,
    url: Option<String>,
    secret: Option<String>,
}

#[derive(Default)]
struct Shared {
    status: Mutex<Status>,
    child: Mutex<Option<Child>>,
    working: Mutex<bool>,
}

type State = Arc<Shared>;

fn set(state: &State, phase: &str, progress: Option<f64>, message: Option<String>) {
    *state.status.lock().unwrap() = Status { phase: phase.to_string(), progress, message, url: None, secret: None };
}

/// Runs setup if needed, then starts the engine, and watches it. One run at a time.
fn bootstrap(state: State, run_setup: bool) {
    {
        let mut working = state.working.lock().unwrap();
        if *working {
            return;
        }
        *working = true;
    }
    let result = (|| -> Result<(), String> {
        let layout = engine::Layout::locate()?;
        if !layout.engine_present() {
            return Err("The stem engine is missing from this install.".to_string());
        }
        if !setup::is_complete(&layout.data) {
            if !run_setup {
                set(&state, "setup-needed", None, Some("Stem separation needs a one-time download of FFmpeg and the separation models.".to_string()));
                return Ok(());
            }
            set(&state, "setting-up", Some(0.0), Some("Setting up stem separation".to_string()));
            let report_state = state.clone();
            let report = move |progress: f64, message: &str| set(&report_state, "setting-up", Some(progress), Some(message.to_string()));
            if let Err(e) = setup::run(&layout.data, &layout.python, &layout.backend, &report) {
                set(&state, "setup-failed", None, Some(e));
                return Ok(());
            }
        }
        set(&state, "starting", None, Some("Starting the stem engine".to_string()));
        let started = engine::start(&layout)?;
        *state.child.lock().unwrap() = Some(started.child);
        *state.status.lock().unwrap() = Status {
            phase: "ready".to_string(),
            progress: None,
            message: None,
            url: Some(started.url),
            secret: Some(started.secret),
        };
        Ok(())
    })();
    if let Err(e) = result {
        set(&state, "engine-error", None, Some(e));
    }
    *state.working.lock().unwrap() = false;
}

/// Flags the engine as stopped if its process ends on its own.
fn watch(state: State) {
    loop {
        std::thread::sleep(Duration::from_secs(2));
        let mut child = state.child.lock().unwrap();
        if let Some(c) = child.as_mut() {
            if let Ok(Some(status)) = c.try_wait() {
                *child = None;
                drop(child);
                set(&state, "engine-error", None, Some(format!("The engine exited ({status}).")));
            }
        }
    }
}

fn stop(state: &State) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn engine_status(state: tauri::State<State>) -> Status {
    state.status.lock().unwrap().clone()
}

/// Starts or retries setup, or restarts a stopped engine.
#[tauri::command]
fn engine_setup(state: tauri::State<State>) {
    let state: State = state.inner().clone();
    stop(&state);
    std::thread::spawn(move || bootstrap(state, true));
}

fn index_path() -> Result<std::path::PathBuf, String> {
    Ok(engine::Layout::locate()?.data.join("stem-index.json"))
}

#[tauri::command]
fn stem_index_read() -> Result<HashMap<String, String>, String> {
    let path = index_path()?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        // Only a missing file is an empty index. Any other error (a lock, a permission) must not read as
        // empty, or the next save would overwrite every saved mapping.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("could not read the saved-stems index: {e}")),
    }
}

#[tauri::command]
fn stem_index_write(index: HashMap<String, String>) -> Result<(), String> {
    let path = index_path()?;
    let tmp = path.with_extension("json.tmp");
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&tmp, serde_json::to_string(&index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn main() {
    let state: State = Arc::new(Shared::default());
    set(&state, "starting", None, Some("Starting".to_string()));

    let app = tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![engine_status, engine_setup, stem_index_read, stem_index_write])
        .setup({
            let state = state.clone();
            move |_app| {
                let boot = state.clone();
                std::thread::spawn(move || bootstrap(boot, false));
                let watcher = state.clone();
                std::thread::spawn(move || watch(watcher));
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Tab Highway shell");

    let exit_state = state.clone();
    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            stop(&exit_state);
        }
    });
}
