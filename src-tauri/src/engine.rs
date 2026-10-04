//! Starting and stopping the pinned StemDeck engine through Tab Highway's wrapper.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::recovery::HealthWait;

pub struct Layout {
    pub data: PathBuf,
    pub python: PathBuf,
    pub backend: PathBuf,
    pub wrapper: PathBuf,
}

impl Layout {
    pub fn locate() -> Result<Layout, String> {
        let root = match env::var("TABHIGHWAY_ROOT") {
            Ok(r) => PathBuf::from(r),
            Err(_) => env::current_exe()
                .map_err(|e| format!("cannot find the app folder: {e}"))?
                .parent()
                .ok_or("the app has no folder")?
                .to_path_buf(),
        };
        Ok(Layout {
            data: env::var("TABHIGHWAY_DATA").map(PathBuf::from).unwrap_or_else(|_| root.join("data")),
            python: root.join("python").join("Scripts").join("python.exe"),
            backend: root.join("backend"),
            wrapper: root.join("engine"),
        })
    }

    pub fn engine_present(&self) -> bool {
        self.python.is_file() && self.backend.join("app").is_dir() && self.wrapper.join("tabhighway_engine.py").is_file()
    }
}

/// The current PATH with `dir` first, so the engine finds FFmpeg.
pub fn path_with(dir: &Path) -> OsString {
    let mut paths = vec![dir.to_path_buf()];
    paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
    env::join_paths(paths).unwrap_or_default()
}

/// StemDeck's Windows runtime is a venv whose stdlib sits under `base/`; point Python at it, as StemDeck's own shell does.
pub fn configure_python(command: &mut Command, python: &Path) {
    let Some(venv) = python.parent().and_then(|p| p.parent()) else { return };
    let base = venv.join("base");
    if base.join("python.exe").is_file() && base.join("Lib").join("os.py").is_file() {
        patch_pyvenv_cfg(venv, &base);
        command.env("PYTHONHOME", &base);
    }
}

fn patch_pyvenv_cfg(venv: &Path, base: &Path) {
    let cfg = venv.join("pyvenv.cfg");
    let Ok(content) = fs::read_to_string(&cfg) else { return };
    let patched: Vec<String> = content
        .lines()
        .map(|line| {
            let t = line.trim_start();
            if t.starts_with("home") && t[4..].trim_start().starts_with('=') {
                format!("home = {}", base.display())
            } else if t.starts_with("executable") && t["executable".len()..].trim_start().starts_with('=') {
                format!("executable = {}", base.join("python.exe").display())
            } else {
                line.to_string()
            }
        })
        .collect();
    let _ = fs::write(cfg, patched.join("\n") + "\n");
}

#[cfg(windows)]
pub fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
pub fn hide_window(_command: &mut Command) {}

pub fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|e| format!("no random source: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

pub struct Started {
    pub child: Child,
    pub url: String,
    pub secret: String,
}

/// Starts the engine on a free loopback port and waits until it answers as ours. While it waits, the child
/// lives in `starting`, so closing the app during a slow start can still kill it (see `kill_slot`).
pub fn start(layout: &Layout, starting: &Mutex<Option<Child>>) -> Result<Started, String> {
    let secret = random_hex(32)?;
    let token = random_hex(16)?;
    let port = {
        let probe = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no free port: {e}"))?;
        probe.local_addr().map_err(|e| e.to_string())?.port()
    };
    let data = &layout.data;
    for dir in ["logs", "stems", "cache", "models"] {
        let _ = fs::create_dir_all(data.join(dir));
    }
    let log_path = data.join("logs").join("engine.log");
    if fs::metadata(&log_path).map(|m| crate::recovery::should_rotate(m.len())).unwrap_or(false) {
        let _ = fs::rename(&log_path, data.join("logs").join("engine.log.1"));
    }
    let mut log = fs::OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| format!("cannot write the engine log: {e}"))?;
    let _ = writeln!(log, "--- engine start ---");
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut pythonpath = vec![layout.wrapper.clone(), layout.backend.clone()];
    pythonpath.extend(env::split_paths(&env::var_os("PYTHONPATH").unwrap_or_default()));

    let mut command = Command::new(&layout.python);
    command
        .args(["-m", "uvicorn", "tabhighway_engine:app", "--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["--timeout-graceful-shutdown", "2"])
        .current_dir(&layout.backend)
        .env("PYTHONPATH", env::join_paths(pythonpath).map_err(|e| e.to_string())?)
        .env("PYTHONUNBUFFERED", "1")
        .env("STEMDECK_DATA_DIR", data)
        .env("STEMDECK_DEFAULT_JOBS_DIR", data.join("stems"))
        .env("STEMDECK_DESKTOP", "1")
        .env("STEMDECK_PARENT_PID", std::process::id().to_string())
        .env("STEMDECK_INSTANCE_TOKEN", &token)
        .env("XDG_CACHE_HOME", data.join("cache"))
        .env("TORCH_HOME", data.join("models").join("torch"))
        .env("PATH", path_with(&crate::setup::ffmpeg_dir(data)))
        .env("TABHIGHWAY_ENGINE_SECRET", &secret)
        .env("TABHIGHWAY_ORIGINS", "http://tauri.localhost,https://tauri.localhost,http://localhost:5173")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    configure_python(&mut command, &layout.python);
    hide_window(&mut command);

    let child = command.spawn().map_err(|e| format!("could not start the engine: {e}"))?;
    *starting.lock().unwrap() = Some(child);
    let url = format!("http://127.0.0.1:{port}");
    match wait_for_health(starting, &url, &secret, &token) {
        // The slot is empty only if the app shut down while the engine was starting; its child is already killed.
        Ok(()) => match starting.lock().unwrap().take() {
            Some(child) => Ok(Started { child, url, secret }),
            None => Err("the app closed while the engine was starting".to_string()),
        },
        Err(e) => {
            kill_slot(starting);
            Err(with_log_tail(data, e))
        }
    }
}

/// Kills and reaps the child in the slot, if there is one.
pub(crate) fn kill_slot(slot: &Mutex<Option<Child>>) {
    if let Some(mut child) = slot.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Whether the slot holds a child that is still running. An empty slot (already killed) is not alive.
fn child_alive(slot: &Mutex<Option<Child>>) -> bool {
    match slot.lock().unwrap().as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

/// The last lines of the engine log, for showing why the engine failed. Empty if there is no log.
pub fn read_log_tail(data: &Path) -> String {
    let Ok(mut file) = fs::File::open(data.join("logs").join("engine.log")) else { return String::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(16 * 1024)));
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    crate::recovery::tail_lines(&String::from_utf8_lossy(&bytes), crate::recovery::TAIL_LINES)
}

pub(crate) fn with_log_tail(data: &Path, message: String) -> String {
    let tail = read_log_tail(data);
    if tail.is_empty() {
        message
    } else {
        format!("{message}\n{tail}")
    }
}

/// Waits while the process is alive, up to the recovery ceiling, until the engine answers as ours.
fn wait_for_health(starting: &Mutex<Option<Child>>, url: &str, secret: &str, token: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        let alive = child_alive(starting);
        let healthy = alive
            && client
                .get(format!("{url}/api/health"))
                .header("X-TabHighway-Secret", secret)
                .send()
                .and_then(|r| r.json::<serde_json::Value>())
                .map(|body| body.get("instance").and_then(|v| v.as_str()) == Some(token))
                .unwrap_or(false);
        match crate::recovery::health_decision(started.elapsed(), alive, healthy) {
            HealthWait::Ready => return Ok(()),
            HealthWait::Exited => return Err("the engine exited while starting; see data/logs/engine.log".to_string()),
            HealthWait::CeilingReached => return Err("the engine did not start in time; see data/logs/engine.log".to_string()),
            HealthWait::Keep => std::thread::sleep(Duration::from_millis(500)),
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// A process that lives for about a minute unless killed, and one that exits at once.
    fn long_lived() -> Child {
        Command::new("cmd").args(["/C", "ping -n 60 127.0.0.1 >nul"]).stdout(Stdio::null()).spawn().expect("spawn cmd")
    }
    fn short_lived() -> Child {
        Command::new("cmd").args(["/C", "exit 0"]).stdout(Stdio::null()).spawn().expect("spawn cmd")
    }

    #[test]
    fn a_running_child_in_the_slot_is_alive_and_an_empty_slot_is_not() {
        let slot = Mutex::new(Some(long_lived()));
        assert!(child_alive(&slot));
        kill_slot(&slot);
        assert!(!child_alive(&slot));
    }

    /// Whether Windows still lists a process with this id.
    fn process_listed(pid: u32) -> bool {
        let out = Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output().expect("run tasklist");
        String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
    }

    #[test]
    fn killing_the_slot_really_stops_a_still_starting_engine_and_empties_the_slot() {
        let child = long_lived();
        let pid = child.id();
        let slot = Mutex::new(Some(child));
        assert!(process_listed(pid), "the child should be running before the kill");
        kill_slot(&slot);
        assert!(slot.lock().unwrap().is_none());
        assert!(!process_listed(pid), "the child must be gone, not merely forgotten");
        // Killing an empty slot is harmless.
        kill_slot(&slot);
    }

    #[test]
    fn a_child_that_exits_is_no_longer_alive() {
        let slot = Mutex::new(Some(short_lived()));
        for _ in 0..50 {
            if !child_alive(&slot) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(!child_alive(&slot));
        kill_slot(&slot);
    }
}
