// Backup and restore of a player's own practice data: saved recording profiles, per-recording alignments and the
// saved-stems index. The stem audio itself is not included (it is large and can be made again; the page already forgets
// an index entry whose stems are gone), and neither are the models, FFmpeg or the Pro status, which belongs to one device.
//
// A backup is one zip with a small manifest. A restore reads only names it knows, checks each file before it writes
// anything, and keeps the file it replaces as `.bak`, so a bad or hostile archive can never write outside the data folder
// or leave half a restore behind.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;
use zip::write::SimpleFileOptions;

const MANIFEST: &str = "tabhighway-backup.json";
const APP_NAME: &str = "tab-highway";
const BACKUP_VERSION: u64 = 1;
const PROFILES: &str = "recording-profiles.json";
const STEM_INDEX: &str = "stem-index.json";
const ALIGNMENTS_DIR: &str = "alignments";
/// No single file in a backup is larger than this; a bigger entry is not ours.
const MAX_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// How many files the backup holds or the restore wrote.
    pub files: usize,
    /// File name of the archive.
    pub name: String,
}

/// Which names in a backup are ours: the profile file, the stem index and `alignments/<64 hex>.json`.
fn is_user_content(name: &str) -> bool {
    if name == PROFILES || name == STEM_INDEX {
        return true;
    }
    name.strip_prefix("alignments/")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(crate::alignments::is_valid_hash)
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Writes a backup of `data` to `out`. Fails if `out` already exists, so a backup is never overwritten.
pub fn create_backup(data: &Path, out: &Path) -> Result<Summary, String> {
    let mut names: Vec<(String, PathBuf)> = Vec::new();
    for name in [PROFILES, STEM_INDEX] {
        let path = data.join(name);
        if path.is_file() {
            names.push((name.to_string(), path));
        }
    }
    if let Ok(entries) = fs::read_dir(data.join(ALIGNMENTS_DIR)) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let name = format!("{ALIGNMENTS_DIR}/{file_name}");
            if is_user_content(&name) && entry.path().is_file() {
                names.push((name, entry.path()));
            }
        }
    }
    names.sort();

    let file = fs::OpenOptions::new().write(true).create_new(true).open(out).map_err(|e| format!("could not create the backup file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let manifest = serde_json::json!({ "app": APP_NAME, "version": BACKUP_VERSION, "createdAt": now_secs(), "files": names.len() });
    zip.start_file(MANIFEST, options).map_err(|e| e.to_string())?;
    zip.write_all(manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
    for (name, path) in &names {
        let bytes = fs::read(path).map_err(|e| format!("could not read {name}: {e}"))?;
        zip.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| format!("could not finish the backup: {e}"))?;
    Ok(Summary { files: names.len(), name: out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() })
}

/// A file from the archive that passed its checks and is ready to write.
struct Checked {
    name: String,
    text: String,
}

fn check_entry(name: &str, text: String) -> Option<Checked> {
    let ok = match name {
        PROFILES => serde_json::from_str::<Value>(&text).ok().and_then(|v| crate::profiles::serialize_profiles(&v)).is_some(),
        STEM_INDEX => serde_json::from_str::<std::collections::HashMap<String, String>>(&text).is_ok(),
        _ => {
            let hash = name.strip_prefix("alignments/").and_then(|r| r.strip_suffix(".json"))?;
            crate::alignments::parse_alignment(&text, hash).is_some()
        }
    };
    ok.then(|| Checked { name: name.to_string(), text })
}

/// Restores from `archive` into `data`. Everything is read and checked before the first write; an invalid file is
/// skipped, an archive that is not a Tab Highway backup is refused whole.
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
        Some(BACKUP_VERSION) => {}
        Some(_) => return Err("that backup was made by a newer version of Tab Highway; update the app to restore it".to_string()),
        None => return Err("that file is not a Tab Highway backup".to_string()),
    }

    let mut checked = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("the backup is damaged: {e}"))?;
        let name = entry.name().to_string();
        if name == MANIFEST || !entry.is_file() || !is_user_content(&name) || entry.size() > MAX_ENTRY_BYTES {
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

    for item in &checked {
        let path = data.join(&item.name);
        if path.is_file() {
            let _ = fs::copy(&path, path.with_extension("json.bak"));
        }
        crate::write_atomic(&path, item.text.clone())?;
    }
    Ok(Summary { files: checked.len(), name: archive.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() })
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
pub fn backup_create(app: tauri::AppHandle, stamp: String) -> Result<Summary, String> {
    if !crate::exports::is_valid_stamp(&stamp) {
        return Err("that is not a time stamp".to_string());
    }
    let data = crate::engine::Layout::locate()?.data;
    let dir = backups_dir(&app)?;
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
pub fn backup_restore(app: tauri::AppHandle, name: String) -> Result<Summary, String> {
    if !is_backup_name(&name) {
        return Err("that is not one of the backups in the Backups folder".to_string());
    }
    let data = crate::engine::Layout::locate()?.data;
    restore_backup(&data, &backups_dir(&app)?.join(name))
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
        write_zip(&archive, &[(MANIFEST, r#"{"app":"tab-highway","version":2}"#)]);
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

    #[test]
    fn only_our_own_backup_names_can_be_restored_by_name() {
        assert!(is_backup_name("tab-highway-backup-2026-10-18-1305.zip"));
        assert!(is_backup_name("tab-highway-backup-2026-10-18-1305-2.zip"));
        for bad in ["..\\evil.zip", "../evil.zip", "C:\\evil.zip", "tab-highway-backup-x/y.zip", "other.zip", "tab-highway-backup-1.txt", ""] {
            assert!(!is_backup_name(bad), "{bad}");
        }
    }
}
