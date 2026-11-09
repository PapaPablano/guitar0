// The song library: data/library/. It holds the index library.json, the saved tab files at tabs/<sha>.bin and the
// copied recordings at recordings/<sha>.<ext>, each named by the SHA-256 of its bytes. The page owns the shape of an
// index entry; the shell guards the envelope, the names (a validated hash and an allowlisted extension, so nothing
// the page sends can name a path outside the folder) and the writes (a temp file, renamed into place only once every
// byte is on disk and matches the hash in its name).

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The envelope version the page writes. Any other version is not understood here.
pub const INDEX_VERSION: u64 = 1;
pub const INDEX_FILE: &str = "library.json";
pub const QUARANTINE_FILE: &str = "library.json.bad";
const TEMP_EXTENSION: &str = "tmp";
const TABS_DIR: &str = "tabs";
const RECORDINGS_DIR: &str = "recordings";
/// Tabs are stored as their raw bytes, whatever format they came in.
const TAB_EXTENSIONS: [&str; 1] = ["bin"];
/// The recording types the page accepts, plus `bin` for a recording whose name carries no usable extension.
const RECORDING_EXTENSIONS: [&str; 10] = ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "webm", "bin"];
/// The largest slice one read returns, so a page request can never make the shell allocate without bound.
pub const MAX_CHUNK: u64 = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Tab,
    Recording,
}

impl Kind {
    pub fn parse(kind: &str) -> Option<Kind> {
        match kind {
            "tab" => Some(Kind::Tab),
            "recording" => Some(Kind::Recording),
            _ => None,
        }
    }

    fn dir(self) -> &'static str {
        match self {
            Kind::Tab => TABS_DIR,
            Kind::Recording => RECORDINGS_DIR,
        }
    }

    fn extensions(self) -> &'static [&'static str] {
        match self {
            Kind::Tab => &TAB_EXTENSIONS,
            Kind::Recording => &RECORDING_EXTENSIONS,
        }
    }
}

pub fn is_allowed_extension(kind: Kind, extension: &str) -> bool {
    kind.extensions().contains(&extension)
}

/// Where a stored file lives, or an error when the kind, hash or extension could name anything else.
pub fn file_path(library: &Path, kind: &str, hash: &str, extension: &str) -> Result<PathBuf, String> {
    let kind = Kind::parse(kind).ok_or_else(|| "not a library file kind".to_string())?;
    file_path_for(library, kind, hash, extension)
}

/// Where a stored file of a known kind lives, or an error when the hash or extension could name anything else.
pub fn file_path_for(library: &Path, kind: Kind, hash: &str, extension: &str) -> Result<PathBuf, String> {
    if !crate::alignments::is_valid_hash(hash) {
        return Err("not a content hash".to_string());
    }
    if !is_allowed_extension(kind, extension) {
        return Err("that file type cannot be stored in the library".to_string());
    }
    Ok(library.join(kind.dir()).join(format!("{hash}.{extension}")))
}

pub fn empty_index() -> Value {
    json!({ "version": INDEX_VERSION, "entries": [] })
}

/// A stored index as JSON, or None when the text is not a version-1 envelope with an entries list. None means the
/// file must be set aside, not overwritten.
pub fn parse_index(text: &str) -> Option<Value> {
    serde_json::from_str::<Value>(text).ok().filter(is_envelope)
}

/// The text to write for an index from the page, or None when it is not a version-1 envelope with an entries list.
pub fn serialize_index(value: &Value) -> Option<String> {
    if !is_envelope(value) {
        return None;
    }
    serde_json::to_string(value).ok()
}

fn is_envelope(value: &Value) -> bool {
    value.get("version").and_then(Value::as_u64) == Some(INDEX_VERSION) && value.get("entries").map_or(false, Value::is_array)
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct IndexRead {
    pub index: Value,
    /// True when an unreadable index was just renamed to library.json.bad and the library reads as empty.
    pub quarantined: bool,
}

/// Reads the index. A missing file is an empty library. An unreadable one is renamed to library.json.bad (replacing
/// an earlier one) and reads as empty with the flag set. Any other read error is an error, so the page skips the save
/// instead of overwriting a file it could not read.
pub fn read_index(library: &Path) -> Result<IndexRead, String> {
    let path = library.join(INDEX_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(IndexRead { index: empty_index(), quarantined: false }),
        Err(e) => return Err(format!("could not read the library index: {e}")),
    };
    // Bytes that are not UTF-8 are unreadable content like any other bad index, not an I/O failure.
    if let Some(index) = std::str::from_utf8(&bytes).ok().and_then(parse_index) {
        return Ok(IndexRead { index, quarantined: false });
    }
    // Set the file aside so the next save cannot overwrite it. If that fails, saving must not go ahead.
    fs::rename(&path, library.join(QUARANTINE_FILE)).map_err(|e| format!("could not set aside the unreadable library index: {e}"))?;
    Ok(IndexRead { index: empty_index(), quarantined: true })
}

/// Deletes temp files a closed or crashed app left in the library, so no partial file stays behind. Returns how many
/// it removed. Run at startup, before the page can begin a write.
pub fn sweep_temp(library: &Path) -> usize {
    let mut removed = 0;
    for dir in [library.to_path_buf(), library.join(TABS_DIR), library.join(RECORDINGS_DIR)] {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_temp = path.extension().and_then(|e| e.to_str()) == Some(TEMP_EXTENSION);
            if is_temp && path.is_file() && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

struct Pending {
    file: File,
    temp: PathBuf,
    target: PathBuf,
    hash: String,
    hasher: Sha256,
}

/// The library writes in progress, by the handle the page was given.
#[derive(Default)]
pub struct Writes {
    next: Mutex<u64>,
    open: Mutex<HashMap<u64, Pending>>,
}

impl Writes {
    /// Opens a temp file for a stored file and returns the handle to append slices to.
    pub fn begin(&self, library: &Path, kind: &str, hash: &str, extension: &str) -> Result<u64, String> {
        let target = file_path(library, kind, hash, extension)?;
        let dir = target.parent().ok_or_else(|| "no library folder".to_string())?;
        fs::create_dir_all(dir).map_err(|e| format!("could not create the library folder: {e}"))?;
        let id = {
            let mut next = self.next.lock().unwrap();
            *next += 1;
            *next
        };
        let temp = dir.join(format!("{hash}.{id}.{TEMP_EXTENSION}"));
        let file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| format!("could not create the library file: {e}"))?;
        self.open.lock().unwrap().insert(id, Pending { file, temp, target, hash: hash.to_string(), hasher: Sha256::new() });
        Ok(id)
    }

    /// Appends one slice of bytes to a write in progress.
    pub fn append(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
        let mut open = self.open.lock().unwrap();
        let entry = open.get_mut(&id).ok_or_else(|| "unknown library write handle".to_string())?;
        entry.file.write_all(bytes).map_err(|e| format!("could not write the library file: {e}"))?;
        entry.hasher.update(bytes);
        Ok(())
    }

    /// Puts the file in place once its bytes are on disk and match the hash in its name. Returns true when the file is
    /// new, and false when the library already had it (the temp file is discarded and the original kept). On any
    /// failure the temp file is removed, so the library never holds a partial file under a real name.
    pub fn finish(&self, id: u64) -> Result<bool, String> {
        let Pending { file, temp, target, hash, hasher } = self.open.lock().unwrap().remove(&id).ok_or_else(|| "unknown library write handle".to_string())?;
        // The handle is gone from here on, so every failure removes the temp file itself.
        let discard = |message: String| {
            let _ = fs::remove_file(&temp);
            Err(message)
        };
        let synced = file.sync_all();
        drop(file);
        if let Err(e) = synced {
            return discard(format!("could not finish the library file: {e}"));
        }
        if hex(&hasher.finalize()) != hash {
            return discard("the stored bytes do not match their hash".to_string());
        }
        if target.exists() {
            // Same name means same bytes: keep the original.
            let _ = fs::remove_file(&temp);
            return Ok(false);
        }
        if let Err(e) = fs::rename(&temp, &target) {
            return discard(format!("could not put the library file in place: {e}"));
        }
        Ok(true)
    }

    /// Drops a write that failed partway, removing its temp file.
    pub fn cancel(&self, id: u64) {
        if let Some(entry) = self.open.lock().unwrap().remove(&id) {
            drop(entry.file);
            let _ = fs::remove_file(&entry.temp);
        }
    }
}

/// Up to `len` bytes of a stored file from `offset`. Past the end it returns the bytes that remain, then nothing.
pub fn read_chunk(library: &Path, kind: &str, hash: &str, extension: &str, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let path = file_path(library, kind, hash, extension)?;
    let mut file = File::open(&path).map_err(|e| format!("could not open the library file: {e}"))?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| format!("could not read the library file: {e}"))?;
    let mut out = Vec::new();
    file.take(len.min(MAX_CHUNK)).read_to_end(&mut out).map_err(|e| format!("could not read the library file: {e}"))?;
    Ok(out)
}

/// Whether the library already holds this file.
pub fn exists(library: &Path, kind: &str, hash: &str, extension: &str) -> Result<bool, String> {
    let path = file_path(library, kind, hash, extension)?;
    Ok(path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tabhighway-library-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn temp_files(dir: &Path) -> Vec<PathBuf> {
        match fs::read_dir(dir) {
            Ok(entries) => entries.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("tmp")).collect(),
            Err(_) => Vec::new(),
        }
    }

    #[test]
    fn a_version_1_index_round_trips() {
        let text = r#"{"version":1,"entries":[{"tabHash":"t","title":"Song","extra":{"kept":true}}]}"#;
        let parsed = parse_index(text).unwrap();
        assert_eq!(parsed["entries"][0]["title"], "Song");
        let out = serialize_index(&parsed).unwrap();
        assert_eq!(parse_index(&out), Some(parsed));
    }

    #[test]
    fn an_index_written_then_read_comes_back_unchanged() {
        let lib = scratch("index-file");
        let value = json!({ "version": 1, "entries": [{ "tabHash": "t" }] });
        fs::write(lib.join(INDEX_FILE), serialize_index(&value).unwrap()).unwrap();
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: value, quarantined: false });
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn a_missing_index_reads_as_an_empty_library() {
        let lib = scratch("missing");
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: empty_index(), quarantined: false });
        // Nor does a library folder that does not exist yet count as an error.
        assert_eq!(read_index(&lib.join("never-made")).unwrap(), IndexRead { index: empty_index(), quarantined: false });
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn text_that_is_not_a_version_1_envelope_is_not_an_index() {
        for bad in ["{not json", "", "[1,2]", r#"{"entries":[]}"#, r#"{"version":1}"#, r#"{"version":1,"entries":{}}"#, r#"{"version":2,"entries":[]}"#] {
            assert_eq!(parse_index(bad), None, "{bad}");
        }
    }

    #[test]
    fn serialize_refuses_an_index_it_would_not_read_back() {
        assert!(serialize_index(&json!({ "version": 2, "entries": [] })).is_none());
        assert!(serialize_index(&json!({ "version": 1, "entries": {} })).is_none());
        assert!(serialize_index(&json!("x")).is_none());
        assert!(serialize_index(&empty_index()).is_some());
    }

    #[test]
    fn an_unreadable_index_is_set_aside_and_reads_as_empty_with_the_flag() {
        let lib = scratch("quarantine");
        fs::write(lib.join(INDEX_FILE), "{corrupt one").unwrap();
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: empty_index(), quarantined: true });
        assert!(!lib.join(INDEX_FILE).exists());
        assert_eq!(fs::read_to_string(lib.join(QUARANTINE_FILE)).unwrap(), "{corrupt one");

        // A second corrupt index replaces the earlier .bad.
        fs::write(lib.join(INDEX_FILE), "{corrupt two").unwrap();
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: empty_index(), quarantined: true });
        assert_eq!(fs::read_to_string(lib.join(QUARANTINE_FILE)).unwrap(), "{corrupt two");

        // With the bad file set aside, the next read is a plain empty library.
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: empty_index(), quarantined: false });
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn an_index_that_is_not_utf8_is_set_aside_too() {
        let lib = scratch("not-utf8");
        fs::write(lib.join(INDEX_FILE), [0xff, 0xfe, 0x00, 0x7b]).unwrap();
        assert_eq!(read_index(&lib).unwrap(), IndexRead { index: empty_index(), quarantined: true });
        assert_eq!(fs::read(lib.join(QUARANTINE_FILE)).unwrap(), [0xff, 0xfe, 0x00, 0x7b]);
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn an_index_from_a_newer_app_is_set_aside_rather_than_overwritten() {
        let lib = scratch("newer");
        let newer = r#"{"version":2,"entries":[{"tabHash":"t"}]}"#;
        fs::write(lib.join(INDEX_FILE), newer).unwrap();
        assert!(read_index(&lib).unwrap().quarantined);
        assert_eq!(fs::read_to_string(lib.join(QUARANTINE_FILE)).unwrap(), newer);
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn an_index_that_cannot_be_read_for_another_reason_is_an_error() {
        let lib = scratch("unreadable");
        // A folder where the file should be cannot be read as text, and is not a missing file.
        fs::create_dir_all(lib.join(INDEX_FILE)).unwrap();
        assert!(read_index(&lib).is_err());
        assert!(lib.join(INDEX_FILE).is_dir());
        assert!(!lib.join(QUARANTINE_FILE).exists());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn a_hash_that_is_not_64_lowercase_hex_is_refused() {
        let lib = Path::new("lib");
        let good = "ab".repeat(32);
        assert_eq!(file_path(lib, "tab", &good, "bin").unwrap(), lib.join("tabs").join(format!("{good}.bin")));
        assert_eq!(file_path(lib, "recording", &good, "mp3").unwrap(), lib.join("recordings").join(format!("{good}.mp3")));
        for bad in [String::new(), "ab".repeat(31), "AB".repeat(32), "zz".repeat(32), "../../../../etc/passwd".to_string(), format!("..\\{}", "a".repeat(61)), format!("{}/", "a".repeat(63))] {
            assert!(file_path(lib, "recording", &bad, "mp3").is_err(), "{bad}");
        }
    }

    #[test]
    fn an_extension_or_kind_outside_the_allowlist_is_refused() {
        let lib = Path::new("lib");
        let good = "ab".repeat(32);
        for bad in ["exe", "MP3", "mp3.exe", "", "../x", "json", "tmp", "/mp3", "mp3/../../x"] {
            assert!(file_path(lib, "recording", &good, bad).is_err(), "{bad}");
        }
        // A tab is always stored as bin.
        assert!(file_path(lib, "tab", &good, "mp3").is_err());
        for bad in ["", "tabs", "Tab", "../tab", "stems"] {
            assert!(file_path(lib, bad, &good, "bin").is_err(), "{bad}");
        }
    }

    #[test]
    fn begin_three_appends_and_finish_store_exactly_the_input() {
        let lib = scratch("write");
        let parts: [&[u8]; 3] = [b"first slice ", b"second slice ", b"third"];
        let all: Vec<u8> = parts.concat();
        let hash = sha(&all);
        let writes = Writes::default();
        let id = writes.begin(&lib, "recording", &hash, "wav").unwrap();
        for part in parts {
            writes.append(id, part).unwrap();
        }
        assert!(!exists(&lib, "recording", &hash, "wav").unwrap(), "nothing is in place before finish");
        assert!(writes.finish(id).unwrap());
        assert_eq!(fs::read(lib.join("recordings").join(format!("{hash}.wav"))).unwrap(), all);
        assert!(exists(&lib, "recording", &hash, "wav").unwrap());
        assert!(temp_files(&lib.join("recordings")).is_empty());
        // The handle is spent.
        assert!(writes.append(id, b"more").is_err());
        assert!(writes.finish(id).is_err());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn cancel_leaves_no_file() {
        let lib = scratch("cancel");
        let hash = sha(b"whole");
        let writes = Writes::default();
        let id = writes.begin(&lib, "tab", &hash, "bin").unwrap();
        writes.append(id, b"who").unwrap();
        writes.cancel(id);
        assert!(!exists(&lib, "tab", &hash, "bin").unwrap());
        assert!(temp_files(&lib.join("tabs")).is_empty());
        // Cancelling an unknown or spent handle does nothing.
        writes.cancel(id);
        writes.cancel(9999);
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn finish_onto_an_existing_hash_keeps_the_original_and_removes_the_temp() {
        let lib = scratch("dedupe");
        let bytes = b"same recording";
        let hash = sha(bytes);
        let target = lib.join("recordings").join(format!("{hash}.mp3"));
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, bytes).unwrap();
        let before = fs::metadata(&target).unwrap().modified().unwrap();
        let writes = Writes::default();
        let id = writes.begin(&lib, "recording", &hash, "mp3").unwrap();
        writes.append(id, bytes).unwrap();
        assert!(!writes.finish(id).unwrap());
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(fs::metadata(&target).unwrap().modified().unwrap(), before);
        assert!(temp_files(&lib.join("recordings")).is_empty());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn finish_refuses_bytes_that_do_not_match_the_hash_and_leaves_nothing() {
        let lib = scratch("mismatch");
        let hash = sha(b"the whole recording");
        let writes = Writes::default();
        let id = writes.begin(&lib, "recording", &hash, "flac").unwrap();
        writes.append(id, b"the whole rec").unwrap();
        assert!(writes.finish(id).is_err());
        assert!(!exists(&lib, "recording", &hash, "flac").unwrap());
        assert!(temp_files(&lib.join("recordings")).is_empty());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn begin_refuses_a_bad_name_and_append_an_unknown_handle() {
        let lib = scratch("refuse");
        let writes = Writes::default();
        assert!(writes.begin(&lib, "recording", "../../evil", "mp3").is_err());
        assert!(writes.begin(&lib, "recording", &"ab".repeat(32), "exe").is_err());
        assert!(writes.append(42, b"x").is_err());
        assert!(!lib.join("recordings").exists());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn two_writes_of_the_same_file_at_once_do_not_collide() {
        let lib = scratch("parallel");
        let bytes = b"shared";
        let hash = sha(bytes);
        let writes = Writes::default();
        let a = writes.begin(&lib, "tab", &hash, "bin").unwrap();
        let b = writes.begin(&lib, "tab", &hash, "bin").unwrap();
        writes.append(a, bytes).unwrap();
        writes.append(b, bytes).unwrap();
        assert!(writes.finish(a).unwrap());
        assert!(!writes.finish(b).unwrap());
        assert_eq!(fs::read(lib.join("tabs").join(format!("{hash}.bin"))).unwrap(), bytes);
        assert!(temp_files(&lib.join("tabs")).is_empty());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn the_startup_sweep_deletes_temp_files_and_leaves_completed_files_alone() {
        let lib = scratch("sweep");
        let hash = "ab".repeat(32);
        fs::create_dir_all(lib.join("tabs")).unwrap();
        fs::create_dir_all(lib.join("recordings")).unwrap();
        fs::write(lib.join("tabs").join(format!("{hash}.bin")), b"tab").unwrap();
        fs::write(lib.join("recordings").join(format!("{hash}.mp3")), b"audio").unwrap();
        fs::write(lib.join(INDEX_FILE), empty_index().to_string()).unwrap();
        fs::write(lib.join(QUARANTINE_FILE), "bad").unwrap();
        fs::write(lib.join("tabs").join(format!("{hash}.1.tmp")), b"half").unwrap();
        fs::write(lib.join("recordings").join(format!("{hash}.7.tmp")), b"half").unwrap();
        fs::write(lib.join("library.json.tmp"), b"half").unwrap();
        assert_eq!(sweep_temp(&lib), 3);
        assert!(temp_files(&lib).is_empty() && temp_files(&lib.join("tabs")).is_empty() && temp_files(&lib.join("recordings")).is_empty());
        assert_eq!(fs::read(lib.join("tabs").join(format!("{hash}.bin"))).unwrap(), b"tab");
        assert_eq!(fs::read(lib.join("recordings").join(format!("{hash}.mp3"))).unwrap(), b"audio");
        assert!(lib.join(INDEX_FILE).exists() && lib.join(QUARANTINE_FILE).exists());
        // A library that does not exist yet is nothing to sweep.
        assert_eq!(sweep_temp(&lib.join("never-made")), 0);
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn a_chunk_read_past_the_end_returns_what_remains_then_nothing() {
        let lib = scratch("read");
        let bytes: Vec<u8> = (0..10u8).collect();
        let hash = sha(&bytes);
        fs::create_dir_all(lib.join("recordings")).unwrap();
        fs::write(lib.join("recordings").join(format!("{hash}.ogg")), &bytes).unwrap();
        assert_eq!(read_chunk(&lib, "recording", &hash, "ogg", 0, 4).unwrap(), &bytes[0..4]);
        assert_eq!(read_chunk(&lib, "recording", &hash, "ogg", 4, 4).unwrap(), &bytes[4..8]);
        assert_eq!(read_chunk(&lib, "recording", &hash, "ogg", 8, 4).unwrap(), &bytes[8..10]);
        assert!(read_chunk(&lib, "recording", &hash, "ogg", 10, 4).unwrap().is_empty());
        assert!(read_chunk(&lib, "recording", &hash, "ogg", 500, 4).unwrap().is_empty());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn a_chunk_read_of_a_missing_or_badly_named_file_is_an_error() {
        let lib = scratch("read-missing");
        assert!(read_chunk(&lib, "recording", &"ab".repeat(32), "mp3", 0, 4).is_err());
        assert!(read_chunk(&lib, "recording", "../library", "json", 0, 4).is_err());
        assert!(exists(&lib, "recording", "../library", "json").is_err());
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn a_chunk_read_never_returns_more_than_the_cap() {
        let lib = scratch("read-cap");
        let bytes = vec![7u8; (MAX_CHUNK + 10) as usize];
        let hash = sha(&bytes);
        fs::create_dir_all(lib.join("tabs")).unwrap();
        fs::write(lib.join("tabs").join(format!("{hash}.bin")), &bytes).unwrap();
        assert_eq!(read_chunk(&lib, "tab", &hash, "bin", 0, u64::MAX).unwrap().len() as u64, MAX_CHUNK);
        fs::remove_dir_all(&lib).unwrap();
    }
}
