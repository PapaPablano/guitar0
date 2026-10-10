// Saving an export into the player's Videos folder. The shell chooses the folder and the final file name; the page
// supplies a song name, a local time stamp, an extension and the bytes (in slices). The name is made safe here, an
// existing file is never overwritten, and only the file types the app produces are accepted, so nothing the page
// sends can name a path outside the Tab Highway folder.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::InvokeBody, Manager};

/// The folder, under the player's Videos folder, that exports are saved into.
pub const FOLDER_NAME: &str = "Tab Highway";
const EXTENSIONS: [&str; 2] = ["mp4", "wav"];
const MAX_NAME_CHARS: usize = 80;
const DEFAULT_NAME: &str = "tab";

/// A name that is safe in a file name: letters, digits, hyphens and underscores, with runs of spaces as one hyphen.
pub fn sanitize_name(name: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            if gap && !out.is_empty() {
                out.push('-');
            }
            gap = false;
            out.push(ch);
        } else if ch.is_whitespace() {
            gap = true;
        }
        // Anything else (separators, colons, dots, other scripts) is dropped.
    }
    let trimmed: String = out.trim_matches('-').chars().take(MAX_NAME_CHARS).collect();
    if trimmed.is_empty() {
        DEFAULT_NAME.to_string()
    } else {
        trimmed
    }
}

/// A local date and time as the page writes it, `YYYY-MM-DD-HHMM`: digits and hyphens in exactly that shape.
pub fn is_valid_stamp(stamp: &str) -> bool {
    let b = stamp.as_bytes();
    b.len() == 15 && b.iter().enumerate().all(|(i, c)| if matches!(i, 4 | 7 | 10) { *c == b'-' } else { c.is_ascii_digit() })
}

pub fn is_allowed_extension(extension: &str) -> bool {
    EXTENSIONS.contains(&extension)
}

/// The file name to try for the given attempt: the first is plain, later ones add `-2`, `-3`, and so on.
pub fn candidate_name(name: &str, stamp: &str, extension: &str, attempt: u32) -> String {
    let base = format!("{}-{}", sanitize_name(name), stamp);
    if attempt <= 1 {
        format!("{base}.{extension}")
    } else {
        format!("{base}-{attempt}.{extension}")
    }
}

/// Where exports go: the player's Videos folder plus the Tab Highway folder.
fn export_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let videos = app.path().video_dir().map_err(|e| format!("could not find the Videos folder: {e}"))?;
    Ok(videos.join(FOLDER_NAME))
}

struct Open {
    file: File,
    path: PathBuf,
}

/// The saves in progress, by the handle the page was given.
#[derive(Default)]
pub struct Exports {
    next: Mutex<u64>,
    open: Mutex<HashMap<u64, Open>>,
}

#[derive(Serialize)]
pub struct Saved {
    file_name: String,
    folder: String,
}

/// Creates the file, never over an existing one, and returns the handle to append slices to.
#[tauri::command]
pub fn export_begin(app: tauri::AppHandle, state: tauri::State<Exports>, name: String, stamp: String, extension: String) -> Result<u64, String> {
    if !is_allowed_extension(&extension) {
        return Err("that file type cannot be saved".to_string());
    }
    if !is_valid_stamp(&stamp) {
        return Err("that is not a time stamp".to_string());
    }
    let dir = export_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the Tab Highway folder: {e}"))?;
    for attempt in 1..=1000 {
        let path = dir.join(candidate_name(&name, &stamp, &extension, attempt));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                let mut next = state.next.lock().unwrap();
                *next += 1;
                let id = *next;
                state.open.lock().unwrap().insert(id, Open { file, path });
                return Ok(id);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("could not create the file: {e}")),
        }
    }
    Err("could not find a free file name".to_string())
}

/// Appends one slice of raw bytes to a save in progress. The handle travels in the `x-save-id` header.
#[tauri::command]
pub fn export_append(request: tauri::ipc::Request<'_>, state: tauri::State<Exports>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".to_string());
    };
    let id: u64 = request
        .headers()
        .get("x-save-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "missing save handle".to_string())?;
    let mut open = state.open.lock().unwrap();
    let entry = open.get_mut(&id).ok_or_else(|| "unknown save handle".to_string())?;
    entry.file.write_all(bytes).map_err(|e| format!("could not write the file: {e}"))
}

/// Closes a save and says where it went.
#[tauri::command]
pub fn export_finish(state: tauri::State<Exports>, id: u64) -> Result<Saved, String> {
    let entry = state.open.lock().unwrap().remove(&id).ok_or_else(|| "unknown save handle".to_string())?;
    entry.file.sync_all().map_err(|e| format!("could not finish the file: {e}"))?;
    let name = entry.path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let folder = entry.path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Saved { file_name: name, folder })
}

/// Drops a save that failed partway, removing the partial file.
#[tauri::command]
pub fn export_cancel(state: tauri::State<Exports>, id: u64) {
    if let Some(entry) = state.open.lock().unwrap().remove(&id) {
        drop(entry.file);
        let _ = fs::remove_file(&entry.path);
    }
}

/// Opens the Tab Highway folder in the file manager. The path is the shell's own, never the page's.
#[tauri::command]
pub fn export_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = export_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the Tab Highway folder: {e}"))?;
    open_in_file_manager(&dir)
}

fn open_in_file_manager(dir: &Path) -> Result<(), String> {
    // Explorer reports a nonzero exit even when it opens the folder, so only a failure to start it is an error.
    std::process::Command::new("explorer").arg(dir).spawn().map(|_| ()).map_err(|e| format!("could not open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizing_drops_separators_colons_and_dots() {
        assert_eq!(sanitize_name("../../Windows/System32"), "WindowsSystem32");
        assert_eq!(sanitize_name("C:\\evil\\name.exe"), "Cevilnameexe");
        assert_eq!(sanitize_name("Purple Rain: live"), "Purple-Rain-live");
    }

    #[test]
    fn sanitizing_collapses_spaces_and_trims_hyphens() {
        assert_eq!(sanitize_name("  a   b  "), "a-b");
        assert_eq!(sanitize_name("--x--"), "x");
    }

    #[test]
    fn an_empty_or_all_invalid_name_falls_back() {
        assert_eq!(sanitize_name(""), DEFAULT_NAME);
        assert_eq!(sanitize_name("???///"), DEFAULT_NAME);
        assert_eq!(sanitize_name("日本語"), DEFAULT_NAME);
    }

    #[test]
    fn a_long_name_is_cut() {
        assert_eq!(sanitize_name(&"a".repeat(500)).len(), MAX_NAME_CHARS);
    }

    #[test]
    fn the_stamp_has_a_fixed_sortable_shape() {
        assert!(is_valid_stamp("2026-10-10-1750"));
        for bad in ["", "2026-10-10", "2026-10-10-17:50", "2026/10/10-1750", "../../../etc/p", "2026-10-10-175x", "2026-10-10-17500"] {
            assert!(!is_valid_stamp(bad), "{bad}");
        }
    }

    #[test]
    fn only_the_files_the_app_makes_are_allowed() {
        assert!(is_allowed_extension("mp4"));
        assert!(is_allowed_extension("wav"));
        for bad in ["exe", "bat", "MP4", "mp4.exe", "", "../x"] {
            assert!(!is_allowed_extension(bad), "{bad}");
        }
    }

    #[test]
    fn a_taken_name_gets_the_next_free_suffix() {
        assert_eq!(candidate_name("Song", "2026-10-10-1750", "mp4", 1), "Song-2026-10-10-1750.mp4");
        assert_eq!(candidate_name("Song", "2026-10-10-1750", "mp4", 2), "Song-2026-10-10-1750-2.mp4");
        assert_eq!(candidate_name("Song", "2026-10-10-1750", "mp4", 3), "Song-2026-10-10-1750-3.mp4");
    }

    #[test]
    fn creating_never_overwrites_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("tabhighway-export-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = dir.join(candidate_name("Song", "2026-10-10-1750", "wav", 1));
        fs::write(&first, b"original").unwrap();
        let again = OpenOptions::new().write(true).create_new(true).open(&first);
        assert_eq!(again.unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&first).unwrap(), b"original");
        fs::remove_dir_all(&dir).unwrap();
    }
}
