// Backup and restore of a player's own practice data: saved recording profiles, per-recording alignments, the
// saved-stems index, and the song library (its index, saved tabs and copied recordings). The stem audio itself is not
// included (it is large and can be made again; the page already forgets an index entry whose stems are gone), and
// neither are the models, FFmpeg or the Pro status, which belongs to one device.
//
// A backup is one zip with a small manifest. A restore reads only names it knows, checks each file before it writes
// anything under a real name, and keeps the file it replaces as `.bak`, so a bad or hostile archive can never write
// outside the data folder or leave half a restore behind. Library tabs and recordings are binary and can be large: they
// are streamed into the zip uncompressed, streamed back out to a temp file, and put in place only when their bytes match
// the hash in their name. The library index is merged by tab hash rather than replaced, and the recording profiles and
// saved-stems index by recording hash, so a song saved only on this machine survives a restore with its offset, mix and
// stems.

use std::fs;
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, TryLockError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Manager;
use zip::write::SimpleFileOptions;

use crate::library::{self, Kind};

const MANIFEST: &str = "tabhighway-backup.json";
const APP_NAME: &str = "tab-highway";
/// Version 2 added the song library. Every version from OLDEST_VERSION up still restores.
const BACKUP_VERSION: u64 = 2;
const OLDEST_VERSION: u64 = 1;
const PROFILES: &str = "recording-profiles.json";
const STEM_INDEX: &str = "stem-index.json";
const ALIGNMENTS_DIR: &str = "alignments";
const LIBRARY_DIR: &str = "library";
const LIBRARY_INDEX: &str = "library/library.json";
const LIBRARY_TABS: &str = "library/tabs";
const LIBRARY_RECORDINGS: &str = "library/recordings";
/// No single text file in a backup is larger than this; a bigger entry is not ours.
const MAX_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
/// No stored tab or recording is larger than this. They go through a file, never memory, so the bound is about disk.
const MAX_BINARY_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const COPY_BUFFER: usize = 1024 * 1024;

/// One backup or restore at a time: the commands run off the main thread now, so a second click could otherwise start
/// a second restore merging the same index.
static BUSY: Mutex<()> = Mutex::new(());
/// Makes each restore temp file name unique within this process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// How many files the backup holds or the restore wrote.
    pub files: usize,
    /// File name of the archive.
    pub name: String,
}

/// Which names in a backup are ours: the profile file, the stem index, `alignments/<64 hex>.json`, the library index
/// and the library's hash-named tabs and recordings. `library.json.bad` and temp files are not.
fn is_user_content(name: &str) -> bool {
    if name == PROFILES || name == STEM_INDEX || name == LIBRARY_INDEX {
        return true;
    }
    if library_file(name).is_some() {
        return true;
    }
    name.strip_prefix("alignments/")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(crate::alignments::is_valid_hash)
}

/// A stored library file: `library/tabs/<64 hex>.bin` or `library/recordings/<64 hex>.<allowed type>`. Returns its
/// kind, hash and extension, or None for any other name (so nothing like `..` or a separator can get through).
fn library_file(name: &str) -> Option<(Kind, &str, &str)> {
    let (kind, file) = if let Some(file) = name.strip_prefix("library/tabs/") {
        (Kind::Tab, file)
    } else {
        (Kind::Recording, name.strip_prefix("library/recordings/")?)
    };
    let (hash, extension) = file.split_once('.')?;
    (crate::alignments::is_valid_hash(hash) && library::is_allowed_extension(kind, extension)).then_some((kind, hash, extension))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Writes a backup of `data` to `out`. Fails if `out` already exists, so a backup is never overwritten.
pub fn create_backup(data: &Path, out: &Path) -> Result<Summary, String> {
    let mut names: Vec<(String, PathBuf)> = Vec::new();
    for name in [PROFILES, STEM_INDEX, LIBRARY_INDEX] {
        let path = data.join(name);
        if path.is_file() {
            names.push((name.to_string(), path));
        }
    }
    for dir in [ALIGNMENTS_DIR, LIBRARY_TABS, LIBRARY_RECORDINGS] {
        let Ok(entries) = fs::read_dir(data.join(dir)) else { continue };
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let name = format!("{dir}/{file_name}");
            if is_user_content(&name) && entry.path().is_file() {
                names.push((name, entry.path()));
            }
        }
    }
    names.sort();

    let file = fs::OpenOptions::new().write(true).create_new(true).open(out).map_err(|e| format!("could not create the backup file: {e}"))?;
    let written = write_archive(BufWriter::with_capacity(COPY_BUFFER, file), &names);
    if let Err(e) = written {
        // A half-written backup (a full disk, a file that vanished) must not sit in the folder looking like a good one.
        let _ = fs::remove_file(out);
        return Err(e);
    }
    Ok(Summary { files: names.len(), name: out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() })
}

fn write_archive(out: BufWriter<fs::File>, names: &[(String, PathBuf)]) -> Result<(), String> {
    let mut zip = zip::ZipWriter::new(out);
    let text_options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let manifest = serde_json::json!({ "app": APP_NAME, "version": BACKUP_VERSION, "createdAt": now_secs(), "files": names.len() });
    zip.start_file(MANIFEST, text_options).map_err(|e| e.to_string())?;
    zip.write_all(manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
    for (name, path) in names {
        if library_file(name).is_some() {
            // Audio barely compresses, and storing it keeps a large backup fast. Streamed, never held in memory.
            let mut source = fs::File::open(path).map_err(|e| format!("could not read {name}: {e}"))?;
            let len = source.metadata().map_err(|e| format!("could not read {name}: {e}"))?.len();
            let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(len >= u64::from(u32::MAX));
            zip.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            io::copy(&mut source, &mut zip).map_err(|e| format!("could not back up {name}: {e}"))?;
        } else {
            let bytes = fs::read(path).map_err(|e| format!("could not read {name}: {e}"))?;
            zip.start_file(name.as_str(), text_options).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    let mut out = zip.finish().map_err(|e| format!("could not finish the backup: {e}"))?;
    out.flush().map_err(|e| format!("could not finish the backup: {e}"))?;
    out.get_ref().sync_all().map_err(|e| format!("could not finish the backup: {e}"))
}

/// A text file from the archive that passed its checks and is ready to write.
struct Checked {
    name: String,
    text: String,
}

fn check_entry(name: &str, text: String) -> Option<Checked> {
    let ok = match name {
        PROFILES => serde_json::from_str::<Value>(&text).ok().and_then(|v| crate::profiles::serialize_profiles(&v)).is_some(),
        STEM_INDEX => serde_json::from_str::<std::collections::HashMap<String, String>>(&text).is_ok(),
        LIBRARY_INDEX => library::parse_index(&text).is_some(),
        _ => {
            let hash = name.strip_prefix("alignments/").and_then(|r| r.strip_suffix(".json"))?;
            crate::alignments::parse_alignment(&text, hash).is_some()
        }
    };
    ok.then(|| Checked { name: name.to_string(), text })
}

/// A library file from the archive whose bytes are in a temp file beside their target and match the hash in the name.
struct Staged {
    temp: PathBuf,
    target: PathBuf,
}

/// Temp files a restore made. Any still on disk when this is dropped (a refused entry, an error, a panic) are removed,
/// so a restore never leaves a partial file behind. The startup sweep in library.rs catches any left by a crash.
#[derive(Default)]
struct Temps(Vec<PathBuf>);

impl Drop for Temps {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

/// Streams one library entry to a temp file and checks it against `hash`. Ok(true) when the bytes match, Ok(false)
/// when the entry is refused (wrong bytes, too large, damaged in the archive), and Err when the disk write itself
/// failed, which stops the whole restore.
fn stage(entry: &mut impl Read, temp: &Path, hash: &str) -> Result<bool, String> {
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(temp).map_err(|e| format!("could not restore the library: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER];
    let mut total: u64 = 0;
    loop {
        let read = match entry.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            // A damaged entry (the zip reader checks each entry's CRC) is skipped like any other invalid file.
            Err(_) => return Ok(false),
        };
        total += read as u64;
        if total > MAX_BINARY_BYTES {
            return Ok(false);
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).map_err(|e| format!("could not restore the library: {e}"))?;
    }
    file.sync_all().map_err(|e| format!("could not restore the library: {e}"))?;
    let digest = library::hex(&hasher.finalize());
    Ok(digest == hash)
}

/// The library index to write: the backup's entries, then the entries only this machine has. Songs are matched by
/// their `tabHash`; for a song in both, the backup's entry wins. A local index that is missing or unreadable adds
/// nothing (the unreadable one is still kept as `.bak`). A local index that cannot be read for another reason stops
/// the restore, so it is never overwritten unread.
fn merge_index(backup_text: &str, local_path: &Path) -> Result<String, String> {
    let backup = library::parse_index(backup_text).ok_or_else(|| "the backup's library index is not readable".to_string())?;
    let local = read_local(local_path, "library index")?.as_deref().and_then(library::parse_index);
    let mut entries: Vec<Value> = backup["entries"].as_array().cloned().unwrap_or_default();
    let in_backup: std::collections::HashSet<String> = entries.iter().filter_map(tab_hash).collect();
    if let Some(local) = local {
        for entry in local["entries"].as_array().into_iter().flatten() {
            if !tab_hash(entry).is_some_and(|hash| in_backup.contains(&hash)) {
                entries.push(entry.clone());
            }
        }
    }
    let merged = serde_json::json!({ "version": library::INDEX_VERSION, "entries": entries });
    library::serialize_index(&merged).ok_or_else(|| "could not merge the library index".to_string())
}

fn tab_hash(entry: &Value) -> Option<String> {
    entry.get("tabHash").and_then(Value::as_str).map(str::to_string)
}

/// This machine's copy of a file a restore merges into. None when it is missing or not text (it then adds nothing);
/// Err for any other read error, which stops the restore so the file is never overwritten unread.
fn read_local(path: &Path, what: &str) -> Result<Option<String>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(String::from_utf8(bytes).ok()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("could not read this computer's {what}: {e}")),
    }
}

/// The recording profiles to write: the backup's entries, then the entries only this machine has, matched by their
/// `hash`; for a recording in both, the backup's entry wins. Local-only entries go last, as the newest, so the page's
/// oldest-first trim drops them last. A local file that is missing or unreadable adds nothing, and when nothing is
/// added the backup's text is written as it is.
fn merge_profiles(backup_text: &str, local_path: &Path) -> Result<String, String> {
    let mut backup: Value = serde_json::from_str(backup_text).map_err(|_| "the backup's recording profiles are not readable".to_string())?;
    crate::profiles::serialize_profiles(&backup).ok_or_else(|| "the backup's recording profiles are not readable".to_string())?;
    let Some(local_text) = read_local(local_path, "recording profiles")? else { return Ok(backup_text.to_string()) };
    let local = crate::profiles::parse_profiles(&local_text);
    let entries = backup["entries"].as_array_mut().ok_or_else(|| "the backup's recording profiles are not readable".to_string())?;
    let in_backup: std::collections::HashSet<String> = entries.iter().filter_map(profile_hash).collect();
    let local_only: Vec<Value> = local["entries"].as_array().into_iter().flatten().filter(|entry| profile_hash(entry).is_some_and(|hash| !in_backup.contains(&hash))).cloned().collect();
    if local_only.is_empty() {
        return Ok(backup_text.to_string());
    }
    entries.extend(local_only);
    crate::profiles::serialize_profiles(&backup).ok_or_else(|| "could not merge the recording profiles".to_string())
}

fn profile_hash(entry: &Value) -> Option<String> {
    entry.get("hash").and_then(Value::as_str).map(str::to_string)
}

/// The saved-stems index to write: recording hash to stem job. The backup's mapping wins for a recording in both, and a
/// mapping only this machine has is kept. A local index that is missing or unreadable adds nothing, and when nothing is
/// added the backup's text is written as it is.
fn merge_stem_index(backup_text: &str, local_path: &Path) -> Result<String, String> {
    let mut backup: std::collections::BTreeMap<String, String> = serde_json::from_str(backup_text).map_err(|_| "the backup's saved-stems index is not readable".to_string())?;
    let Some(local_text) = read_local(local_path, "saved-stems index")? else { return Ok(backup_text.to_string()) };
    let local: std::collections::BTreeMap<String, String> = serde_json::from_str(&local_text).unwrap_or_default();
    let before = backup.len();
    for (recording, job) in local {
        backup.entry(recording).or_insert(job);
    }
    if backup.len() == before {
        return Ok(backup_text.to_string());
    }
    serde_json::to_string(&backup).map_err(|_| "could not merge the saved-stems index".to_string())
}

/// Restores from `archive` into `data`. Everything is read and checked before the first write under a real name; an
/// invalid file is skipped, an archive that is not a Tab Highway backup is refused whole.
pub fn restore_backup(data: &Path, archive: &Path) -> Result<Summary, String> {
    let file = fs::File::open(archive).map_err(|e| format!("could not open the backup: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "that file is not a Tab Highway backup".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("that file is not a Tab Highway backup".to_string());
    }
    let manifest: Value = {
        let mut entry = zip.by_name(MANIFEST).map_err(|_| "that file is not a Tab Highway backup".to_string())?;
        let mut text = String::new();
        entry.by_ref().take(MAX_ENTRY_BYTES).read_to_string(&mut text).map_err(|_| "that file is not a Tab Highway backup".to_string())?;
        serde_json::from_str(&text).map_err(|_| "that file is not a Tab Highway backup".to_string())?
    };
    if manifest.get("app").and_then(Value::as_str) != Some(APP_NAME) {
        return Err("that file is not a Tab Highway backup".to_string());
    }
    match manifest.get("version").and_then(Value::as_u64) {
        Some(version) if (OLDEST_VERSION..=BACKUP_VERSION).contains(&version) => {}
        Some(version) if version > BACKUP_VERSION => return Err("that backup was made by a newer version of Tab Highway; update the app to restore it".to_string()),
        _ => return Err("that file is not a Tab Highway backup".to_string()),
    }

    let library_dir = data.join(LIBRARY_DIR);
    let mut temps = Temps::default();
    let mut checked = Vec::new();
    let mut staged = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("the backup is damaged: {e}"))?;
        let name = entry.name().to_string();
        if name == MANIFEST || !entry.is_file() || !is_user_content(&name) {
            continue;
        }
        if let Some((kind, hash, extension)) = library_file(&name) {
            // Binary: never read as text or held in memory.
            if entry.size() > MAX_BINARY_BYTES {
                continue;
            }
            let target = library::file_path_for(&library_dir, kind, hash, extension)?;
            let dir = target.parent().ok_or_else(|| "no library folder".to_string())?;
            fs::create_dir_all(dir).map_err(|e| format!("could not create the library folder: {e}"))?;
            let temp = dir.join(format!("{hash}.restore-{}-{}.tmp", std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
            temps.0.push(temp.clone());
            if stage(&mut entry, &temp, hash)? {
                staged.push(Staged { temp, target });
            } else {
                let _ = fs::remove_file(&temp);
            }
            continue;
        }
        if entry.size() > MAX_ENTRY_BYTES {
            continue;
        }
        let mut text = String::new();
        if entry.by_ref().take(MAX_ENTRY_BYTES).read_to_string(&mut text).is_err() {
            continue;
        }
        if let Some(item) = check_entry(&name, text) {
            checked.push(item);
        }
    }
    // The library index, the recording profiles and the saved-stems index are merged with this machine's, not
    // replaced, so a song kept because only this machine has it keeps its offset, mix and stems. Worked out before any
    // write, so a local file that cannot be read stops the restore with nothing changed.
    for item in checked.iter_mut() {
        let local = data.join(&item.name);
        item.text = match item.name.as_str() {
            LIBRARY_INDEX => merge_index(&item.text, &local)?,
            PROFILES => merge_profiles(&item.text, &local)?,
            STEM_INDEX => merge_stem_index(&item.text, &local)?,
            _ => continue,
        };
    }

    // Tabs and recordings go in place before the index that names them. A file already here under the same hash has the
    // same bytes, so it is kept; nothing already in the library is ever deleted.
    for item in &staged {
        if item.target.exists() {
            let _ = fs::remove_file(&item.temp);
        } else {
            fs::rename(&item.temp, &item.target).map_err(|e| format!("could not put a restored library file in place: {e}"))?;
        }
    }
    for item in &checked {
        let path = data.join(&item.name);
        if path.is_file() {
            let _ = fs::copy(&path, path.with_extension("json.bak"));
        }
        crate::write_atomic(&path, item.text.clone())?;
    }
    drop(temps);
    Ok(Summary { files: checked.len() + staged.len(), name: archive.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() })
}

/// Runs `work` unless another backup or restore is already running.
fn exclusive<T>(work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = match BUSY.try_lock() {
        Ok(guard) => guard,
        // A panic in an earlier run leaves nothing half-held that matters here: every write is atomic or a temp file.
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(TryLockError::WouldBlock) => return Err("a backup or restore is already running".to_string()),
    };
    work()
}

/// Runs the file work of a backup command on a blocking thread, so a large backup never stalls the window.
async fn off_main_thread<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || exclusive(work)).await.map_err(|e| format!("the backup stopped unexpectedly: {e}"))?
}

/// Where backups are kept: the player's Documents folder, in a Tab Highway folder.
fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = app.path().document_dir().map_err(|e| format!("could not find the Documents folder: {e}"))?;
    Ok(documents.join(crate::exports::FOLDER_NAME).join("Backups"))
}

/// A file name the page may ask to restore: one of our own backup names, nothing that could be a path.
fn is_backup_name(name: &str) -> bool {
    name.starts_with("tab-highway-backup-") && name.ends_with(".zip") && !name.contains(['/', '\\', ':']) && name.len() < 80
}

#[tauri::command]
pub async fn backup_create(app: tauri::AppHandle, stamp: String) -> Result<Summary, String> {
    if !crate::exports::is_valid_stamp(&stamp) {
        return Err("that is not a time stamp".to_string());
    }
    let dir = backups_dir(&app)?;
    off_main_thread(move || {
        let data = crate::engine::Layout::locate()?.data;
        fs::create_dir_all(&dir).map_err(|e| format!("could not create the Backups folder: {e}"))?;
        for attempt in 1..=100u32 {
            let name = if attempt == 1 { format!("tab-highway-backup-{stamp}.zip") } else { format!("tab-highway-backup-{stamp}-{attempt}.zip") };
            let path = dir.join(&name);
            if path.exists() {
                continue;
            }
            return create_backup(&data, &path);
        }
        Err("could not find a free backup name".to_string())
    })
    .await
}

/// The backups in the Backups folder, newest name first.
#[tauri::command]
pub fn backup_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = backups_dir(&app)?;
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(entries) => entries.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| is_backup_name(n)).collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    names.reverse();
    Ok(names)
}

#[tauri::command]
pub async fn backup_restore(app: tauri::AppHandle, name: String) -> Result<Summary, String> {
    if !is_backup_name(&name) {
        return Err("that is not one of the backups in the Backups folder".to_string());
    }
    let archive = backups_dir(&app)?.join(name);
    off_main_thread(move || {
        let data = crate::engine::Layout::locate()?.data;
        restore_backup(&data, &archive)
    })
    .await
}

#[tauri::command]
pub fn backup_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = backups_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the Backups folder: {e}"))?;
    crate::exports::open_in_file_manager(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH_A: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const HASH_B: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tabhighway-backup-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn profile_text() -> String {
        r#"{"version":1,"entries":[{"hash":"h","profile":{"version":1,"offset":0.5}}]}"#.to_string()
    }

    fn alignment_text(hash: &str) -> String {
        format!(r#"{{"version":1,"recording":"{hash}","offset":0.25}}"#)
    }

    fn fill(data: &Path) {
        fs::create_dir_all(data.join("alignments")).unwrap();
        fs::write(data.join(PROFILES), profile_text()).unwrap();
        fs::write(data.join(STEM_INDEX), r#"{"abc":"job1"}"#).unwrap();
        fs::write(data.join("alignments").join(format!("{HASH_A}.json")), alignment_text(HASH_A)).unwrap();
        fs::write(data.join("alignments").join(format!("{HASH_B}.json")), alignment_text(HASH_B)).unwrap();
        // Things a backup must leave out.
        fs::write(data.join("entitlement.json"), "secret device state").unwrap();
        fs::create_dir_all(data.join("stems").join("job1")).unwrap();
        fs::write(data.join("stems").join("job1").join("drums.wav"), "audio").unwrap();
        fs::write(data.join("alignments").join("notes.txt"), "not an alignment").unwrap();
    }

    fn names_in(archive: &Path) -> Vec<String> {
        let mut zip = zip::ZipArchive::new(fs::File::open(archive).unwrap()).unwrap();
        let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        names
    }

    #[test]
    fn a_backup_holds_profiles_alignments_and_the_index_and_nothing_else() {
        let root = scratch("contents");
        let data = root.join("data");
        fill(&data);
        let out = root.join("backup.zip");
        let summary = create_backup(&data, &out).unwrap();
        assert_eq!(summary.files, 4);
        let mut expected = vec![format!("alignments/{HASH_A}.json"), format!("alignments/{HASH_B}.json"), MANIFEST.to_string(), PROFILES.to_string(), STEM_INDEX.to_string()];
        expected.sort();
        assert_eq!(names_in(&out), expected);
    }

    #[test]
    fn a_backup_never_overwrites_an_existing_file() {
        let root = scratch("no-overwrite");
        let data = root.join("data");
        fill(&data);
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        assert!(create_backup(&data, &out).is_err());
    }

    #[test]
    fn backup_then_restore_on_an_empty_folder_reproduces_everything() {
        let root = scratch("round-trip");
        let data = root.join("data");
        fill(&data);
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();

        let fresh = root.join("fresh");
        fs::create_dir_all(&fresh).unwrap();
        let summary = restore_backup(&fresh, &out).unwrap();
        assert_eq!(summary.files, 4);
        assert_eq!(fs::read_to_string(fresh.join(PROFILES)).unwrap(), profile_text());
        assert_eq!(fs::read_to_string(fresh.join(STEM_INDEX)).unwrap(), r#"{"abc":"job1"}"#);
        assert!(fresh.join("alignments").join(format!("{HASH_A}.json")).is_file());
        assert!(!fresh.join("entitlement.json").exists(), "the Pro status belongs to one device");
        assert!(!fresh.join("stems").exists(), "stem audio is not part of a backup");
    }

    #[test]
    fn a_restore_keeps_the_file_it_replaces_as_a_dot_bak() {
        let root = scratch("bak");
        let data = root.join("data");
        fill(&data);
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        fs::write(data.join(PROFILES), r#"{"version":1,"entries":[]}"#).unwrap();
        restore_backup(&data, &out).unwrap();
        assert_eq!(fs::read_to_string(data.join(PROFILES)).unwrap(), profile_text());
        assert_eq!(fs::read_to_string(data.join("recording-profiles.json.bak")).unwrap(), r#"{"version":1,"entries":[]}"#);
    }

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, text) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn an_archive_that_is_not_a_tab_highway_backup_is_refused_and_writes_nothing() {
        let root = scratch("foreign");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let plain = root.join("plain.zip");
        write_zip(&plain, &[("readme.txt", "hello")]);
        assert!(restore_backup(&data, &plain).unwrap_err().contains("not a Tab Highway backup"));

        let wrong_app = root.join("wrong.zip");
        write_zip(&wrong_app, &[(MANIFEST, r#"{"app":"other","version":1}"#), (PROFILES, &profile_text())]);
        assert!(restore_backup(&data, &wrong_app).is_err());

        let not_a_zip = root.join("text.zip");
        fs::write(&not_a_zip, "just text").unwrap();
        assert!(restore_backup(&data, &not_a_zip).is_err());
        assert!(fs::read_dir(&data).unwrap().next().is_none(), "nothing was written");
    }

    #[test]
    fn a_backup_from_a_newer_version_asks_for_an_update() {
        let root = scratch("newer");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let archive = root.join("newer.zip");
        write_zip(&archive, &[(MANIFEST, r#"{"app":"tab-highway","version":3}"#)]);
        assert!(restore_backup(&data, &archive).unwrap_err().contains("newer version"));
    }

    #[test]
    fn names_that_are_not_ours_and_invalid_files_are_never_written() {
        let root = scratch("hostile");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let archive = root.join("hostile.zip");
        write_zip(
            &archive,
            &[
                (MANIFEST, r#"{"app":"tab-highway","version":1}"#),
                ("../escape.json", "{}"),
                ("alignments/../../escape.json", "{}"),
                ("alignments/not-a-hash.json", "{}"),
                ("stems/job1/drums.wav", "audio"),
                (PROFILES, "this is not json"),
                (STEM_INDEX, r#"["wrong","shape"]"#),
                (&format!("alignments/{HASH_A}.json"), &alignment_text(HASH_B)),
                (&format!("alignments/{HASH_B}.json"), &alignment_text(HASH_B)),
            ],
        );
        let summary = restore_backup(&data, &archive).unwrap();
        assert_eq!(summary.files, 1, "only the alignment that names its own recording was kept");
        assert!(data.join("alignments").join(format!("{HASH_B}.json")).is_file());
        assert!(!data.join("alignments").join(format!("{HASH_A}.json")).exists());
        assert!(!data.join(PROFILES).exists());
        assert!(!data.join(STEM_INDEX).exists());
        assert!(!root.join("escape.json").exists());
        assert!(!data.join("stems").exists());
    }

    // --- The song library ---

    fn sha(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        library::hex(&Sha256::digest(bytes))
    }

    fn library_index(entries: &[(&str, &str)]) -> String {
        let entries: Vec<Value> = entries.iter().map(|(tab, title)| serde_json::json!({ "tabHash": tab, "title": title })).collect();
        serde_json::json!({ "version": 1, "entries": entries }).to_string()
    }

    fn entries_by_tab(path: &Path) -> Vec<(String, String)> {
        let index: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(index["version"], 1);
        let mut out: Vec<(String, String)> = index["entries"].as_array().unwrap().iter().map(|e| (e["tabHash"].as_str().unwrap().to_string(), e["title"].as_str().unwrap().to_string())).collect();
        out.sort();
        out
    }

    /// A library with one tab and one recording of `recording_len` bytes: (tab hash, recording hash, tab, recording).
    fn fill_library(data: &Path, recording_len: usize) -> (String, String, Vec<u8>, Vec<u8>) {
        let lib = data.join("library");
        fs::create_dir_all(lib.join("tabs")).unwrap();
        fs::create_dir_all(lib.join("recordings")).unwrap();
        let tab = b"a guitar pro file".to_vec();
        // Not all one byte, so a stream that dropped or repeated a block would show.
        let recording: Vec<u8> = (0..recording_len).map(|i| (i % 251) as u8 ^ (i / 4096) as u8).collect();
        let (tab_hash, rec_hash) = (sha(&tab), sha(&recording));
        fs::write(lib.join("tabs").join(format!("{tab_hash}.bin")), &tab).unwrap();
        fs::write(lib.join("recordings").join(format!("{rec_hash}.wav")), &recording).unwrap();
        fs::write(lib.join("library.json"), library_index(&[(&tab_hash, "Song")])).unwrap();
        (tab_hash, rec_hash, tab, recording)
    }

    fn temp_files_under(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    out.extend(temp_files_under(&path));
                } else if path.extension().and_then(|e| e.to_str()) == Some("tmp") {
                    out.push(path);
                }
            }
        }
        out
    }

    fn write_binary_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn a_library_with_a_60_mb_recording_round_trips_byte_for_byte_into_an_empty_folder() {
        // Covers AE4.
        let root = scratch("library-round-trip");
        let data = root.join("data");
        fill(&data);
        let (tab_hash, rec_hash, tab, recording) = fill_library(&data, 60 * 1024 * 1024);
        let out = root.join("backup.zip");
        let summary = create_backup(&data, &out).unwrap();
        assert_eq!(summary.files, 7);

        let mut zip = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap();
        assert_eq!(zip.by_name(&format!("library/recordings/{rec_hash}.wav")).unwrap().compression(), zip::CompressionMethod::Stored, "audio is stored, not compressed");
        assert_eq!(zip.by_name(&format!("library/tabs/{tab_hash}.bin")).unwrap().compression(), zip::CompressionMethod::Stored);
        drop(zip);

        let fresh = root.join("fresh");
        fs::create_dir_all(&fresh).unwrap();
        let summary = restore_backup(&fresh, &out).unwrap();
        assert_eq!(summary.files, 7);
        let lib = fresh.join("library");
        assert_eq!(fs::read(lib.join("library.json")).unwrap(), fs::read(data.join("library").join("library.json")).unwrap());
        assert_eq!(fs::read(lib.join("tabs").join(format!("{tab_hash}.bin"))).unwrap(), tab);
        assert!(fs::read(lib.join("recordings").join(format!("{rec_hash}.wav"))).unwrap() == recording, "the recording is byte-identical");
        assert!(temp_files_under(&fresh).is_empty(), "no temp file is left behind");
        assert!(!fresh.join("stems").exists(), "stem audio is still not part of a backup");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_backup_leaves_out_the_set_aside_index_temp_files_and_unknown_library_names() {
        let root = scratch("library-contents");
        let data = root.join("data");
        let (tab_hash, rec_hash, _, _) = fill_library(&data, 10);
        let lib = data.join("library");
        fs::write(lib.join("library.json.bad"), "{corrupt").unwrap();
        fs::write(lib.join("library.json.bak"), "old").unwrap();
        fs::write(lib.join("recordings").join(format!("{rec_hash}.3.tmp")), "half").unwrap();
        fs::write(lib.join("recordings").join(format!("{}.exe", "ab".repeat(32))), "no").unwrap();
        fs::write(lib.join("recordings").join("notes.wav"), "not a hash").unwrap();
        fs::write(lib.join("tabs").join(format!("{}.mp3", "ab".repeat(32))), "a tab is always bin").unwrap();
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        let mut expected = vec![MANIFEST.to_string(), "library/library.json".to_string(), format!("library/recordings/{rec_hash}.wav"), format!("library/tabs/{tab_hash}.bin")];
        expected.sort();
        assert_eq!(names_in(&out), expected);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_recording_whose_bytes_do_not_match_its_name_is_refused_and_leaves_no_file() {
        let root = scratch("library-mismatch");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let good = b"the real recording".to_vec();
        let good_hash = sha(&good);
        let liar_hash = sha(b"something else");
        let archive = root.join("mismatch.zip");
        write_binary_zip(
            &archive,
            &[
                (MANIFEST, br#"{"app":"tab-highway","version":2}"#),
                (&format!("library/recordings/{liar_hash}.mp3"), b"tampered bytes"),
                (&format!("library/tabs/{liar_hash}.bin"), b"tampered tab"),
                (&format!("library/recordings/{good_hash}.mp3"), &good),
            ],
        );
        let summary = restore_backup(&data, &archive).unwrap();
        assert_eq!(summary.files, 1, "only the recording that matches its name");
        assert_eq!(fs::read(data.join("library").join("recordings").join(format!("{good_hash}.mp3"))).unwrap(), good);
        assert!(!data.join("library").join("recordings").join(format!("{liar_hash}.mp3")).exists());
        assert!(!data.join("library").join("tabs").join(format!("{liar_hash}.bin")).exists());
        assert!(temp_files_under(&data).is_empty(), "the refused bytes left no temp file");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn library_names_that_could_escape_or_are_not_ours_are_never_written() {
        let root = scratch("library-hostile");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let bytes = b"audio".to_vec();
        let hash = sha(&bytes);
        let archive = root.join("hostile.zip");
        write_binary_zip(
            &archive,
            &[
                (MANIFEST, br#"{"app":"tab-highway","version":2}"#),
                ("library/recordings/../../escape.mp3", &bytes),
                (&format!("library/recordings/../{hash}.mp3"), &bytes),
                (&format!("library/tabs/../recordings/{hash}.bin"), &bytes),
                (&format!("library/recordings/{hash}.exe"), &bytes),
                (&format!("library/recordings/{hash}.tmp"), &bytes),
                (&format!("library/tabs/{hash}.mp3"), &bytes),
                (&format!("library/stems/{hash}.wav"), &bytes),
                ("library/library.json.bad", br#"{"version":1,"entries":[]}"#),
                ("library/library.json", b"not an index"),
            ],
        );
        let summary = restore_backup(&data, &archive).unwrap();
        assert_eq!(summary.files, 0);
        assert!(!root.join("escape.mp3").exists());
        assert!(!data.join("library").join("library.json.bad").exists(), "a set-aside index is never restored");
        assert!(!data.join("library").join("library.json").exists(), "an index that is not an envelope is refused");
        assert!(fs::read_dir(&data).unwrap().all(|e| e.unwrap().file_name() == "library"), "nothing outside the library");
        assert!(temp_files_under(&data).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restoring_over_a_library_merges_the_index_by_tab_hash_and_deletes_no_recording() {
        let root = scratch("library-merge");
        let data = root.join("data");
        let lib = data.join("library");
        let (shared, rec_hash, _, recording) = fill_library(&data, 1000);
        let backup_only = "b".repeat(64);
        fs::write(lib.join("library.json"), library_index(&[(&shared, "Backup title"), (&backup_only, "Only in backup")])).unwrap();
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();

        // Later on this machine: the shared song was renamed and a new song saved with its own recording.
        let local_only = "c".repeat(64);
        let local_index = library_index(&[(&shared, "Local title"), (&local_only, "Only here")]);
        fs::write(lib.join("library.json"), &local_index).unwrap();
        let local_recording = b"a recording made after the backup".to_vec();
        let local_rec_hash = sha(&local_recording);
        fs::write(lib.join("recordings").join(format!("{local_rec_hash}.mp3")), &local_recording).unwrap();

        restore_backup(&data, &out).unwrap();
        let mut expected = vec![(backup_only.clone(), "Only in backup".to_string()), (shared.clone(), "Backup title".to_string()), (local_only.clone(), "Only here".to_string())];
        expected.sort();
        assert_eq!(entries_by_tab(&lib.join("library.json")), expected, "the backup's entry wins, and a song only on this machine is kept");
        assert_eq!(fs::read_to_string(lib.join("library.json.bak")).unwrap(), local_index, "the replaced index is kept as .bak");
        assert_eq!(fs::read(lib.join("recordings").join(format!("{local_rec_hash}.mp3"))).unwrap(), local_recording, "existing recordings are not deleted");
        assert!(fs::read(lib.join("recordings").join(format!("{rec_hash}.wav"))).unwrap() == recording);
        assert!(temp_files_under(&data).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_restore_over_an_unreadable_local_index_writes_the_backup_index_and_keeps_the_old_one_as_bak() {
        let root = scratch("library-merge-corrupt");
        let data = root.join("data");
        let lib = data.join("library");
        let (tab_hash, _, _, _) = fill_library(&data, 10);
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        fs::write(lib.join("library.json"), "{corrupt").unwrap();
        restore_backup(&data, &out).unwrap();
        assert_eq!(entries_by_tab(&lib.join("library.json")), vec![(tab_hash, "Song".to_string())]);
        assert_eq!(fs::read_to_string(lib.join("library.json.bak")).unwrap(), "{corrupt");
        let _ = fs::remove_dir_all(&root);
    }

    fn profiles_file(entries: &[(&str, f64)]) -> String {
        let entries: Vec<Value> = entries.iter().map(|(hash, offset)| serde_json::json!({ "hash": hash, "profile": { "version": 1, "offset": offset } })).collect();
        serde_json::json!({ "version": 1, "entries": entries }).to_string()
    }

    fn offsets_by_hash(path: &Path) -> Vec<(String, f64)> {
        let file: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(file["version"], 1);
        let mut out: Vec<(String, f64)> = file["entries"].as_array().unwrap().iter().map(|e| (e["hash"].as_str().unwrap().to_string(), e["profile"]["offset"].as_f64().unwrap())).collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    #[test]
    fn a_restore_keeps_the_profile_and_stems_of_a_song_only_on_this_machine_and_the_backup_wins_for_a_shared_one() {
        let root = scratch("profiles-merge");
        let data = root.join("data");
        let (shared_tab, _, _, _) = fill_library(&data, 10);
        fs::write(data.join(PROFILES), profiles_file(&[("shared", 0.5), ("backup-only", 1.0)])).unwrap();
        fs::write(data.join(STEM_INDEX), r#"{"shared":"job-backup","backup-only":"job-b"}"#).unwrap();
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();

        // Later on this machine: a song saved with its own recording, offset and stems, and the shared one changed.
        let local_tab = "c".repeat(64);
        fs::write(data.join(LIBRARY_INDEX), library_index(&[(&shared_tab, "Song"), (&local_tab, "Only here")])).unwrap();
        let local_profiles = profiles_file(&[("shared", 9.0), ("local-only", 2.5)]);
        fs::write(data.join(PROFILES), &local_profiles).unwrap();
        fs::write(data.join(STEM_INDEX), r#"{"shared":"job-local","local-only":"job-l"}"#).unwrap();

        restore_backup(&data, &out).unwrap();
        assert_eq!(
            offsets_by_hash(&data.join(PROFILES)),
            vec![("backup-only".to_string(), 1.0), ("local-only".to_string(), 2.5), ("shared".to_string(), 0.5)],
            "the local-only profile survives beside the backup's, and the backup's wins for the shared recording"
        );
        let stems: std::collections::HashMap<String, String> = serde_json::from_str(&fs::read_to_string(data.join(STEM_INDEX)).unwrap()).unwrap();
        assert_eq!(stems.len(), 3);
        assert_eq!(stems["shared"], "job-backup", "the backup's stems link wins");
        assert_eq!(stems["backup-only"], "job-b");
        assert_eq!(stems["local-only"], "job-l", "the local-only stems link survives");
        assert!(entries_by_tab(&data.join(LIBRARY_INDEX)).iter().any(|(tab, _)| *tab == local_tab), "the local-only song is kept too");
        assert_eq!(fs::read_to_string(data.join("recording-profiles.json.bak")).unwrap(), local_profiles, "the replaced file is still kept as .bak");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_restore_over_unreadable_local_profiles_and_stem_index_writes_the_backup_files_and_keeps_the_old_ones_as_bak() {
        let root = scratch("profiles-merge-corrupt");
        let data = root.join("data");
        fill(&data);
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        fs::write(data.join(PROFILES), "{corrupt").unwrap();
        fs::write(data.join(STEM_INDEX), [0xffu8, 0xfe, 0x00]).unwrap();
        restore_backup(&data, &out).unwrap();
        assert_eq!(fs::read_to_string(data.join(PROFILES)).unwrap(), profile_text());
        assert_eq!(fs::read_to_string(data.join(STEM_INDEX)).unwrap(), r#"{"abc":"job1"}"#);
        assert_eq!(fs::read_to_string(data.join("recording-profiles.json.bak")).unwrap(), "{corrupt");
        assert_eq!(fs::read(data.join("stem-index.json.bak")).unwrap(), vec![0xffu8, 0xfe, 0x00]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_local_profiles_file_that_cannot_be_read_stops_the_merge() {
        // A directory where the file should be: reading it is an I/O error that is not "missing".
        let root = scratch("profiles-merge-io");
        let local = root.join(PROFILES);
        fs::create_dir_all(&local).unwrap();
        assert!(merge_profiles(&profile_text(), &local).unwrap_err().contains("could not read"));
        assert!(merge_stem_index(r#"{"abc":"job1"}"#, &local).unwrap_err().contains("could not read"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_version_1_backup_still_restores_as_before() {
        let root = scratch("version-1");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let archive = root.join("v1.zip");
        let alignment = alignment_text(HASH_A);
        write_zip(&archive, &[(MANIFEST, r#"{"app":"tab-highway","version":1,"createdAt":0,"files":3}"#), (PROFILES, &profile_text()), (STEM_INDEX, r#"{"abc":"job1"}"#), (&format!("alignments/{HASH_A}.json"), &alignment)]);
        assert_eq!(restore_backup(&data, &archive).unwrap().files, 3);
        assert_eq!(fs::read_to_string(data.join(PROFILES)).unwrap(), profile_text());
        assert_eq!(fs::read_to_string(data.join("alignments").join(format!("{HASH_A}.json"))).unwrap(), alignment);
        assert!(!data.join("library").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_new_backup_says_version_2() {
        let root = scratch("version-2");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let out = root.join("backup.zip");
        create_backup(&data, &out).unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap();
        let mut text = String::new();
        zip.by_name(MANIFEST).unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap()["version"], 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_second_backup_or_restore_while_one_runs_is_refused() {
        let held = BUSY.lock().unwrap();
        assert!(exclusive(|| Ok(())).unwrap_err().contains("already running"));
        drop(held);
        assert_eq!(exclusive(|| Ok(7)).unwrap(), 7);
    }

    #[test]
    fn only_our_own_backup_names_can_be_restored_by_name() {
        assert!(is_backup_name("tab-highway-backup-2026-10-18-1305.zip"));
        assert!(is_backup_name("tab-highway-backup-2026-10-18-1305-2.zip"));
        for bad in ["..\\evil.zip", "../evil.zip", "C:\\evil.zip", "tab-highway-backup-x/y.zip", "other.zip", "tab-highway-backup-1.txt", ""] {
            assert!(!is_backup_name(bad), "{bad}");
        }
    }
}
