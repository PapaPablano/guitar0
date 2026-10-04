//! Starting and stopping the pinned StemDeck engine through Tab Highway's wrapper.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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
            data: root.join("data"),
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

/// Starts the engine on a free loopback port and waits until it answers as ours.
pub fn start(layout: &Layout) -> Result<Started, String> {
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
    let log = fs::File::create(data.join("logs").join("engine.log")).map_err(|e| format!("cannot write the engine log: {e}"))?;
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

    let mut child = command.spawn().map_err(|e| format!("could not start the engine: {e}"))?;
    let url = format!("http://127.0.0.1:{port}");
    match wait_for_health(&mut child, &url, &secret, &token, Duration::from_secs(90)) {
        Ok(()) => Ok(Started { child, url, secret }),
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

fn wait_for_health(child: &mut Child, url: &str, secret: &str, token: &str, limit: Duration) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    while started.elapsed() < limit {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("the engine exited while starting ({status}); see data/logs/engine.log"));
        }
        let answer = client
            .get(format!("{url}/api/health"))
            .header("X-TabHighway-Secret", secret)
            .send()
            .and_then(|r| r.json::<serde_json::Value>());
        if let Ok(body) = answer {
            if body.get("instance").and_then(|v| v.as_str()) == Some(token) {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("the engine did not start in time; see data/logs/engine.log".to_string())
}
