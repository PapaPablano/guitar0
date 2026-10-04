//! First-launch setup: FFmpeg and the separation models, into the package's data folder.
//! Mirrors StemDeck's own Windows setup (FFmpeg from the BtbN builds with a published checksum, models
//! through StemDeck's `app.pipeline.warmup`), so the pinned engine finds everything where it expects it.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};

const FFMPEG_ARCHIVE: &str = "ffmpeg-n8.1-latest-win64-gpl-8.1.zip";
const FFMPEG_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-8.1.zip";
const FFMPEG_CHECKSUMS_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256";

pub type Report<'a> = &'a dyn Fn(f64, &str);

/// Reported as the progress value when the amount done is unknown; the shell turns it into "no progress"
/// so the page shows an indeterminate bar.
pub const INDETERMINATE: f64 = -1.0;
/// How often the model download folder is read. The page polls status every second.
const POLL_MS: u64 = 500;

pub fn ffmpeg_dir(data: &Path) -> PathBuf {
    data.join("ffmpeg")
}

pub fn setup_marker(data: &Path) -> PathBuf {
    data.join("tabhighway-setup.json")
}

/// True once both FFmpeg and the models were installed by a completed setup.
pub fn is_complete(data: &Path) -> bool {
    ffmpeg_dir(data).join("ffmpeg.exe").is_file() && setup_marker(data).is_file()
}

pub fn run(data: &Path, python: &Path, backend: &Path, report: Report) -> Result<(), String> {
    for dir in ["downloads", "ffmpeg", "models", "cache", "logs", "stems"] {
        fs::create_dir_all(data.join(dir)).map_err(|e| format!("could not create {dir}: {e}"))?;
    }
    if !ffmpeg_dir(data).join("ffmpeg.exe").is_file() || !ffmpeg_dir(data).join("ffprobe.exe").is_file() {
        install_ffmpeg(data, report)?;
    }
    warm_models(data, python, backend, report)?;
    fs::write(setup_marker(data), "{\"ffmpegReady\":true,\"modelReady\":true}")
        .map_err(|e| format!("could not record setup: {e}"))?;
    report(1.0, "Setup complete");
    Ok(())
}

fn install_ffmpeg(data: &Path, report: Report) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("network setup failed: {e}"))?;

    report(0.0, "Checking FFmpeg download");
    let checksums = client
        .get(FFMPEG_CHECKSUMS_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| format!("could not reach the FFmpeg download: {e}"))?;
    let expected = checksums
        .lines()
        .find(|l| l.trim_end().ends_with(FFMPEG_ARCHIVE))
        .and_then(|l| l.split_whitespace().next())
        .map(|h| h.to_ascii_lowercase())
        .ok_or_else(|| "the FFmpeg checksum list did not name the archive".to_string())?;

    let archive = data.join("downloads").join(FFMPEG_ARCHIVE);
    let mut response = client
        .get(FFMPEG_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("FFmpeg download failed: {e}"))?;
    let total = response.content_length().unwrap_or(0) as f64;
    let mut file = fs::File::create(&archive).map_err(|e| format!("could not write {}: {e}", archive.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut done = 0f64;
    loop {
        let n = response.read(&mut buf).map_err(|e| format!("FFmpeg download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| format!("could not write FFmpeg: {e}"))?;
        done += n as f64;
        if total > 0.0 {
            report(0.4 * (done / total), "Downloading FFmpeg");
        }
    }
    drop(file);

    let actual = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    if actual != expected {
        let _ = fs::remove_file(&archive);
        return Err("the FFmpeg download failed its checksum and was discarded".to_string());
    }

    report(0.4, "Unpacking FFmpeg");
    extract_ffmpeg(&archive, &ffmpeg_dir(data))?;
    let _ = fs::remove_file(&archive);
    Ok(())
}

fn extract_ffmpeg(archive: &Path, target: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("could not open {}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("FFmpeg archive is unreadable: {e}"))?;
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let (mut ffmpeg, mut ffprobe) = (false, false);
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("FFmpeg archive entry failed: {e}"))?;
        if !entry.is_file() {
            continue;
        }
        let Some(name) = entry.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_ascii_lowercase())) else {
            continue;
        };
        let name = name.to_string_lossy().to_string();
        if name != "ffmpeg.exe" && name != "ffprobe.exe" {
            continue;
        }
        let mut out = fs::File::create(target.join(&name)).map_err(|e| format!("could not write {name}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("could not unpack {name}: {e}"))?;
        if name == "ffmpeg.exe" {
            ffmpeg = true;
        } else {
            ffprobe = true;
        }
    }
    if ffmpeg && ffprobe {
        Ok(())
    } else {
        Err("the FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe".to_string())
    }
}

fn warm_models(data: &Path, python: &Path, backend: &Path, report: Report) -> Result<(), String> {
    report(crate::model_progress::FFMPEG_END, "Downloading the separation models");
    let mut command = Command::new(python);
    command
        .args(["-m", "app.pipeline.warmup"])
        .current_dir(backend)
        .env("STEMDECK_DATA_DIR", data)
        .env("PYTHONUNBUFFERED", "1")
        .env("XDG_CACHE_HOME", data.join("cache"))
        .env("TORCH_HOME", data.join("models").join("torch"))
        .env("PATH", crate::engine::path_with(&ffmpeg_dir(data)))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::engine::configure_python(&mut command, python);
    crate::engine::hide_window(&mut command);
    let torch_home = data.join("models").join("torch");
    let checkpoints = crate::model_progress::checkpoint_dir(&torch_home);
    // A retry re-downloads from zero (R24): drop leftover partial files so the bar does not start at their size.
    crate::model_progress::clear_partials(&checkpoints);
    let mut child = command.spawn().map_err(|e| format!("could not start model setup: {e}"))?;
    // Drain both pipes on their own threads so a full pipe never stalls the engine's warm-up.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut text);
            }
            text
        })
    };
    let out_thread = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err_thread = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    // Poll the checkpoint folder beside the blocking wait so the page's one-second status poll sees movement.
    let mut best = crate::model_progress::FFMPEG_END;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(e) => return Err(format!("could not watch model setup: {e}")),
        }
        match crate::model_progress::model_progress(
            crate::model_progress::largest_file_size(&checkpoints),
            crate::model_progress::KNOWN_MODEL_BYTES,
        ) {
            crate::model_progress::ModelProgress::Fraction(f) => {
                best = best.max(f); // never move backwards when a finished file replaces a partial one
                report(best, "Downloading the separation models");
            }
            crate::model_progress::ModelProgress::Indeterminate => report(INDETERMINATE, "Downloading the separation models"),
        }
        std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
    }
    let output = std::process::Output {
        status: child.wait().map_err(|e| format!("model setup ended unexpectedly: {e}"))?,
        stdout: out_thread.join().unwrap_or_default(),
        stderr: err_thread.join().unwrap_or_default(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.lines().any(|l| l == "WARMUP_OK demucs") {
        Ok(())
    } else {
        let tail: String = String::from_utf8_lossy(&output.stderr).lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        Err(format!("the separation model did not download. {tail}"))
    }
}
