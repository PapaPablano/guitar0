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

/// Where the FFmpeg archive and its checksum list can be fetched from, best first. An owner-hosted mirror
/// (`TABHIGHWAY_MIRROR_URL`, set when the release is built) comes before the upstream host, so setup does not
/// depend on a third-party URL staying up.
struct Source {
    archive_url: String,
    checksums_url: String,
}

fn sources() -> Vec<Source> {
    sources_with(option_env!("TABHIGHWAY_MIRROR_URL"))
}

fn sources_with(mirror: Option<&str>) -> Vec<Source> {
    let mut list = Vec::new();
    if let Some(base) = mirror.map(|m| m.trim().trim_end_matches('/')).filter(|m| m.starts_with("https://")) {
        list.push(Source { archive_url: format!("{base}/{FFMPEG_ARCHIVE}"), checksums_url: format!("{base}/checksums.sha256") });
    }
    list.push(Source { archive_url: FFMPEG_URL.to_string(), checksums_url: FFMPEG_CHECKSUMS_URL.to_string() });
    list
}

/// A plain sentence for a failed request, so the page says what to do rather than echoing a library error.
fn describe_network_error(action: &str, e: &reqwest::Error) -> String {
    if e.is_timeout() {
        format!("{action}: the connection timed out. Check your internet connection and retry.")
    } else if e.is_connect() {
        format!("{action}: could not connect. Check your internet connection and retry.")
    } else if let Some(status) = e.status() {
        format!("{action}: the server answered {status}.")
    } else {
        format!("{action}: {e}")
    }
}

fn install_ffmpeg(data: &Path, report: Report) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("network setup failed: {e}"))?;

    let mut last = String::from("no download source was available");
    for source in sources() {
        match install_ffmpeg_from(&client, &source, data, report) {
            Ok(()) => return Ok(()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn install_ffmpeg_from(client: &reqwest::blocking::Client, source: &Source, data: &Path, report: Report) -> Result<(), String> {
    report(0.0, "Checking FFmpeg download");
    let checksums = client
        .get(&source.checksums_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| describe_network_error("Could not reach the FFmpeg download", &e))?;
    let expected = parse_checksum(&checksums, FFMPEG_ARCHIVE).ok_or_else(|| "the FFmpeg checksum list did not name the archive".to_string())?;

    let archive = data.join("downloads").join(FFMPEG_ARCHIVE);
    let part = data.join("downloads").join(format!("{FFMPEG_ARCHIVE}.part"));
    // One retry on a bad checksum: the first attempt may have resumed onto a damaged partial file.
    for attempt in 0..2 {
        let actual = download_resumable(client, &source.archive_url, &part, &|fraction| report(0.4 * fraction, "Downloading FFmpeg"))?;
        if actual == expected {
            fs::rename(&part, &archive).map_err(|e| format!("could not keep the FFmpeg download: {e}"))?;
            report(0.4, "Unpacking FFmpeg");
            extract_ffmpeg(&archive, &ffmpeg_dir(data))?;
            let _ = fs::remove_file(&archive);
            return Ok(());
        }
        let _ = fs::remove_file(&part);
        if attempt == 1 {
            return Err("the FFmpeg download failed its checksum twice and was discarded".to_string());
        }
    }
    unreachable!("the loop returns on its second pass")
}

/// The expected SHA-256 for `name` from a `checksums.sha256` style list, lower-cased.
fn parse_checksum(list: &str, name: &str) -> Option<String> {
    list.lines().find(|l| l.trim_end().ends_with(name)).and_then(|l| l.split_whitespace().next()).map(|h| h.to_ascii_lowercase())
}

#[derive(Debug, PartialEq)]
enum Resume {
    /// Start the file again from the first byte.
    Fresh,
    /// Keep the first `n` bytes and append the rest.
    From(u64),
    /// The partial file is already the whole file.
    AlreadyComplete,
}

/// What to do with `existing` bytes already on disk, given the server's answer to a ranged request.
fn resume_decision(existing: u64, status: u16, content_range: Option<&str>) -> Resume {
    match (status, content_range) {
        (206, Some(range)) if range.trim().starts_with(&format!("bytes {existing}-")) => Resume::From(existing),
        (416, Some(range)) if range.trim() == format!("bytes */{existing}") => Resume::AlreadyComplete,
        _ => Resume::Fresh,
    }
}

fn sha256_hex(bytes: impl AsRef<[u8]>) -> String {
    Sha256::digest(bytes.as_ref()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads `url` into `part`, continuing a partial file left by an interrupted run when the server supports ranges.
/// Returns the SHA-256 of the whole file. An interruption keeps the partial file so the next run resumes where this stopped.
fn download_resumable(client: &reqwest::blocking::Client, url: &str, part: &Path, progress: &dyn Fn(f64)) -> Result<String, String> {
    let existing = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    let mut request = client.get(url);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let mut response = request.send().map_err(|e| describe_network_error("FFmpeg download failed", &e))?;
    let status = response.status().as_u16();
    let content_range = response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let decision = if existing > 0 { resume_decision(existing, status, content_range.as_deref()) } else { Resume::Fresh };
    if status >= 400 && decision != Resume::AlreadyComplete {
        let e = response.error_for_status().unwrap_err();
        return Err(describe_network_error("FFmpeg download failed", &e));
    }

    let mut hasher = Sha256::new();
    let start = match decision {
        Resume::AlreadyComplete => {
            let bytes = fs::read(part).map_err(|e| format!("could not read the partial FFmpeg download: {e}"))?;
            return Ok(sha256_hex(bytes));
        }
        Resume::From(n) => {
            let mut prefix = fs::File::open(part).map_err(|e| format!("could not read the partial FFmpeg download: {e}"))?;
            let mut buf = [0u8; 64 * 1024];
            loop {
                let read = prefix.read(&mut buf).map_err(|e| format!("could not read the partial FFmpeg download: {e}"))?;
                if read == 0 {
                    break;
                }
                hasher.update(&buf[..read]);
            }
            n
        }
        Resume::Fresh => 0,
    };
    let mut file = if start > 0 { fs::OpenOptions::new().append(true).open(part) } else { fs::File::create(part) }
        .map_err(|e| format!("could not write {}: {e}", part.display()))?;

    let total = response.content_length().map(|n| (n + start) as f64).unwrap_or(0.0);
    let mut buf = [0u8; 64 * 1024];
    let mut done = start as f64;
    loop {
        let n = response.read(&mut buf).map_err(|e| format!("FFmpeg download interrupted; it will continue where it stopped on retry: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| format!("could not write FFmpeg: {e}"))?;
        done += n as f64;
        if total > 0.0 {
            progress(done / total);
        }
    }
    drop(file);
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
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
    let began = std::time::Instant::now();
    let mut stall = crate::model_progress::StallWatch::new();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("could not watch model setup: {e}"));
            }
        }
        if stall.observe(crate::model_progress::folder_total_size(&checkpoints), began.elapsed()) {
            // A hung download would hold setup in "setting up" forever; stop it so the page can offer a retry.
            let _ = child.kill();
            let _ = child.wait();
            let _ = (out_thread.join(), err_thread.join());
            return Err(format!(
                "the model download stalled: nothing arrived for {} minutes. Check the connection and retry.",
                crate::model_progress::STALL_LIMIT.as_secs() / 60
            ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn body() -> Vec<u8> {
        (0..1000u32).map(|i| (i % 251) as u8).collect()
    }

    /// A one-file HTTP server on a free local port. `ranges` collects the Range header of each request.
    fn serve(content: Vec<u8>, honour_range: bool, fixed_status: Option<u16>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(4) {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("range:") {
                        range = Some(value.trim().to_string());
                    }
                }
                seen.lock().unwrap().push(range.clone().unwrap_or_default());
                let total = content.len();
                let response = if let Some(code) = fixed_status {
                    format!("HTTP/1.1 {code} Nope\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()
                } else if let (true, Some(r)) = (honour_range, range.as_deref()) {
                    let start: usize = r.trim_start_matches("bytes=").trim_end_matches('-').parse().unwrap();
                    let mut out = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{total}\r\nConnection: close\r\n\r\n",
                        total - start,
                        total - 1
                    )
                    .into_bytes();
                    out.extend_from_slice(&content[start..]);
                    out
                } else {
                    let mut out = format!("HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n").into_bytes();
                    out.extend_from_slice(&content);
                    out
                };
                let _ = stream.write_all(&response);
            }
        });
        (url, ranges)
    }

    fn client() -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder().build().unwrap()
    }

    fn temp_part(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tabhighway-setup-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("archive.part")
    }

    #[test]
    fn a_fresh_download_returns_the_hash_of_the_whole_file() {
        let (url, ranges) = serve(body(), true, None);
        let part = temp_part("fresh");
        let hash = download_resumable(&client(), &url, &part, &|_| {}).unwrap();
        assert_eq!(hash, sha256_hex(body()));
        assert_eq!(fs::read(&part).unwrap(), body());
        assert_eq!(ranges.lock().unwrap().as_slice(), [""], "no range is asked for on a fresh start");
    }

    #[test]
    fn covers_ae6_a_download_interrupted_at_sixty_percent_resumes_from_sixty_percent() {
        let (url, ranges) = serve(body(), true, None);
        let part = temp_part("resume");
        fs::write(&part, &body()[..600]).unwrap();
        let hash = download_resumable(&client(), &url, &part, &|_| {}).unwrap();
        assert_eq!(ranges.lock().unwrap().as_slice(), ["bytes=600-"]);
        assert_eq!(hash, sha256_hex(body()), "the hash covers the kept part and the new part");
        assert_eq!(fs::read(&part).unwrap(), body());
    }

    #[test]
    fn a_server_that_ignores_ranges_restarts_the_file_instead_of_appending_a_second_copy() {
        let (url, _) = serve(body(), false, None);
        let part = temp_part("no-range");
        fs::write(&part, &body()[..600]).unwrap();
        let hash = download_resumable(&client(), &url, &part, &|_| {}).unwrap();
        assert_eq!(hash, sha256_hex(body()));
        assert_eq!(fs::read(&part).unwrap(), body());
    }

    #[test]
    fn a_416_without_a_matching_content_range_fails_cleanly_instead_of_looping() {
        let (url, _) = serve(body(), true, Some(416));
        let part = temp_part("complete");
        fs::write(&part, body()).unwrap();
        // The fixed 416 carries no Content-Range, so it is not recognised as "already complete"; the download fails rather than looping.
        assert!(download_resumable(&client(), &url, &part, &|_| {}).is_err());
        assert_eq!(resume_decision(1000, 416, Some("bytes */1000")), Resume::AlreadyComplete);
    }

    #[test]
    fn a_server_error_is_reported_in_plain_words() {
        let (url, _) = serve(body(), true, Some(404));
        let part = temp_part("missing");
        let error = download_resumable(&client(), &url, &part, &|_| {}).unwrap_err();
        assert!(error.contains("404"), "{error}");
    }

    #[test]
    fn nothing_is_listening_so_the_message_tells_the_player_to_check_their_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        drop(listener);
        let part = temp_part("offline");
        let error = download_resumable(&client(), &url, &part, &|_| {}).unwrap_err();
        assert!(error.contains("internet connection"), "{error}");
    }

    #[test]
    fn resume_decisions() {
        assert_eq!(resume_decision(600, 206, Some("bytes 600-999/1000")), Resume::From(600));
        assert_eq!(resume_decision(600, 206, Some("bytes 0-999/1000")), Resume::Fresh);
        assert_eq!(resume_decision(600, 200, None), Resume::Fresh);
        assert_eq!(resume_decision(600, 416, Some("bytes */1000")), Resume::Fresh);
    }

    #[test]
    fn the_checksum_is_read_from_the_list_by_file_name() {
        let list = "AAAA1111  other.zip\nBBBB2222  ffmpeg-n8.1-latest-win64-gpl-8.1.zip\n";
        assert_eq!(parse_checksum(list, FFMPEG_ARCHIVE).as_deref(), Some("bbbb2222"));
        assert_eq!(parse_checksum(list, "missing.zip"), None);
    }

    #[test]
    fn an_https_mirror_is_tried_before_the_upstream_host_and_other_mirrors_are_ignored() {
        let with = sources_with(Some("https://downloads.example.com/ffmpeg/"));
        assert_eq!(with.len(), 2);
        assert_eq!(with[0].archive_url, format!("https://downloads.example.com/ffmpeg/{FFMPEG_ARCHIVE}"));
        assert_eq!(with[0].checksums_url, "https://downloads.example.com/ffmpeg/checksums.sha256");
        assert_eq!(with[1].archive_url, FFMPEG_URL);
        assert_eq!(sources_with(None).len(), 1);
        assert_eq!(sources_with(Some("http://insecure.example.com")).len(), 1);
        assert_eq!(sources_with(Some("")).len(), 1);
    }
}
