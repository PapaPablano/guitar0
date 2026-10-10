// Tab Highway desktop shell. It does four jobs: locate the bundled stem engine, run first-launch setup,
// start and stop the engine, and report that state to the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod alignments;
mod engine;
mod exports;
mod model_progress;
mod profiles;
mod recovery;
mod setup;

use std::collections::HashMap;
use std::fs;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::RunEvent;

#[derive(Clone, Serialize, Default)]
struct Status {
    /// setup-needed | setting-up | setup-failed | starting | restarting | ready | engine-error
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
    /// The engine while it is still starting, so closing the app during a slow start kills it.
    starting: Mutex<Option<Child>>,
    working: Mutex<bool>,
    allowance: Mutex<recovery::RestartAllowance>,
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
                set(&state, "setup-needed", None, Some("Stem separation needs a one-time download of about 330 MB: FFmpeg (about 190 MB) and the separation models (about 140 MB).".to_string()));
                return Ok(());
            }
            set(&state, "setting-up", Some(0.0), Some("Setting up stem separation".to_string()));
            let report_state = state.clone();
            let report = move |progress: f64, message: &str| {
                set(&report_state, "setting-up", (progress >= 0.0).then_some(progress), Some(message.to_string()))
            };
            if let Err(e) = setup::run(&layout.data, &layout.python, &layout.backend, &report) {
                set(&state, "setup-failed", None, Some(e));
                return Ok(());
            }
        }
        set(&state, "starting", None, Some("Starting the stem engine".to_string()));
        let started = engine::start(&layout, &state.starting)?;
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

/// Restarts the engine once after an unexpected exit, without setup. Takes the same one-run-at-a-time guard as
/// `bootstrap`, so it yields to a user retry that is already running.
fn restart_engine(state: State, exit_note: String) {
    {
        let mut working = state.working.lock().unwrap();
        if *working {
            return;
        }
        *working = true;
    }
    set(&state, "restarting", None, Some("The stem engine stopped; restarting it".to_string()));
    let result = engine::Layout::locate().and_then(|layout| engine::start(&layout, &state.starting));
    match result {
        Ok(started) => {
            *state.child.lock().unwrap() = Some(started.child);
            *state.status.lock().unwrap() =
                Status { phase: "ready".to_string(), progress: None, message: None, url: Some(started.url), secret: Some(started.secret) };
        }
        Err(e) => set(&state, "engine-error", None, Some(format!("{exit_note}\nThe automatic restart failed: {e}"))),
    }
    *state.working.lock().unwrap() = false;
}

/// Handles the engine process ending on its own: one automatic restart per healthy period, otherwise an error
/// with the log tail. A user stop or retry takes the child away first, so it is never seen here.
fn watch(state: State) {
    let mut ready_since: Option<Instant> = None;
    loop {
        std::thread::sleep(Duration::from_secs(2));
        let exited = {
            let mut child = state.child.lock().unwrap();
            match child.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(status))) => {
                    *child = None;
                    Some(status)
                }
                Some(_) => None,
                None => {
                    ready_since = None;
                    continue;
                }
            }
        };
        let Some(status) = exited else {
            let since = *ready_since.get_or_insert_with(Instant::now);
            state.allowance.lock().unwrap().on_healthy_for(since.elapsed());
            continue;
        };
        ready_since = None;
        // If a user retry is running, it owns the status; leave it alone.
        if *state.working.lock().unwrap() {
            continue;
        }
        let exited = format!("The engine exited ({status}).");
        let note = engine::Layout::locate().map(|l| engine::with_log_tail(&l.data, exited.clone())).unwrap_or(exited);
        let action = state.allowance.lock().unwrap().on_exit(true, false);
        match action {
            recovery::ExitAction::Restart => restart_engine(state.clone(), note),
            recovery::ExitAction::GiveUp => set(&state, "engine-error", None, Some(note)),
        }
    }
}

fn stop(state: &State) {
    engine::kill_slot(&state.child);
}

/// Stops the engine for good, including one that is still starting. Used when the app exits; a user retry
/// uses `stop` so it does not cut off a start that is already in progress.
fn shutdown(state: &State) {
    stop(state);
    engine::kill_slot(&state.starting);
}

#[tauri::command]
fn engine_status(state: tauri::State<State>) -> Status {
    state.status.lock().unwrap().clone()
}

/// Starts or retries setup, or restarts a stopped engine.
#[tauri::command]
fn engine_setup(state: tauri::State<State>) {
    let state: State = state.inner().clone();
    state.allowance.lock().unwrap().on_user_retry();
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
    write_atomic(&index_path()?, serde_json::to_string(&index).map_err(|e| e.to_string())?)
}

/// Writes through a temporary file and a rename, so a crash never leaves a half-written file.
fn write_atomic(path: &std::path::Path, text: String) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Per-recording profiles live in their own file so a profile problem can never touch the saved-stems index.
/// A missing file, or text that is not a profile file, reads as empty. Any other read error (a lock, a permission)
/// is an error, so the page skips the save instead of overwriting every saved profile.
#[tauri::command]
fn profiles_read() -> Result<serde_json::Value, String> {
    let path = engine::Layout::locate()?.data.join("recording-profiles.json");
    match fs::read_to_string(&path) {
        Ok(text) => Ok(profiles::parse_profiles(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(profiles::empty_file()),
        Err(e) => Err(format!("could not read the saved recording profiles: {e}")),
    }
}

#[tauri::command]
fn profiles_write(profiles: serde_json::Value) -> Result<(), String> {
    let path = engine::Layout::locate()?.data.join("recording-profiles.json");
    let text = profiles::serialize_profiles(&profiles).ok_or_else(|| "not a profile file".to_string())?;
    write_atomic(&path, text)
}

/// One alignment file per recording, named by its content hash, so a person can read and edit it. A missing file, or
/// text that is not an alignment file for exactly this recording, reads as none. Any other read error (a lock, a
/// permission) is an error, so the page skips the save instead of overwriting a file it could not read.
fn alignment_path(hash: &str) -> Result<std::path::PathBuf, String> {
    if !alignments::is_valid_hash(hash) {
        return Err("not a recording hash".to_string());
    }
    Ok(engine::Layout::locate()?.data.join("alignments").join(format!("{hash}.json")))
}

#[tauri::command]
fn alignment_read(hash: String) -> Result<Option<serde_json::Value>, String> {
    let path = alignment_path(&hash)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(alignments::parse_alignment(&text, &hash)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read the saved alignment: {e}")),
    }
}

#[tauri::command]
fn alignment_write(hash: String, alignment: serde_json::Value) -> Result<(), String> {
    let path = alignment_path(&hash)?;
    let text = alignments::serialize_alignment(&alignment, &hash).ok_or_else(|| "not an alignment file for this recording".to_string())?;
    write_atomic(&path, text)
}

fn main() {
    let state: State = Arc::new(Shared::default());
    set(&state, "starting", None, Some("Starting".to_string()));

    let app = tauri::Builder::default()
        .manage(state.clone())
        .manage(exports::Exports::default())
        .invoke_handler(tauri::generate_handler![engine_status, engine_setup, stem_index_read, stem_index_write, profiles_read, profiles_write, alignment_read, alignment_write, exports::export_begin, exports::export_append, exports::export_finish, exports::export_cancel, exports::export_open_folder])
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
            shutdown(&exit_state);
        }
    });
}
