// Per-recording alignment files: data/alignments/<content hash>.json. The page owns the shape and the hand-editable
// fields; the shell only guards the envelope (the hash that names the file, and the file's own version and recording)
// so an unreadable or foreign file reads as no alignment and a hash can never name a path outside the folder.

use serde_json::Value;

/// The file version the page writes. Any other version is not understood here.
pub const FILE_VERSION: u64 = 1;

/// A recording's content hash: 64 lowercase hex characters (SHA-256), nothing that could be a path.
pub fn is_valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_file_for(value: &Value, hash: &str) -> bool {
    value.get("version").and_then(Value::as_u64) == Some(FILE_VERSION) && value.get("recording").and_then(Value::as_str) == Some(hash)
}

/// A stored alignment file as JSON, or None when the text is unreadable, is not an object, or is for another version or recording.
pub fn parse_alignment(text: &str, hash: &str) -> Option<Value> {
    serde_json::from_str::<Value>(text).ok().filter(|value| is_file_for(value, hash))
}

/// The text to write for a recording's alignment file, indented so a person can read and edit it, or None when the
/// value is not a version-1 file for exactly this recording.
pub fn serialize_alignment(value: &Value, hash: &str) -> Option<String> {
    if !is_file_for(value, hash) {
        return None;
    }
    serde_json::to_string_pretty(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hash() -> String {
        "ab".repeat(32)
    }

    #[test]
    fn only_a_64_character_lowercase_hex_hash_is_valid() {
        assert!(is_valid_hash(&hash()));
        assert!(!is_valid_hash(""));
        assert!(!is_valid_hash(&"ab".repeat(31)));
        assert!(!is_valid_hash(&"AB".repeat(32)));
        assert!(!is_valid_hash(&"zz".repeat(32)));
        assert!(!is_valid_hash("../../../../etc/passwd"));
        assert!(!is_valid_hash(&format!("{}/", "a".repeat(63))));
        assert!(!is_valid_hash(&format!("..\\{}", "a".repeat(61))));
    }

    #[test]
    fn a_valid_file_round_trips_and_is_indented_for_reading() {
        let h = hash();
        let value = json!({ "version": 1, "recording": h, "source": "auto", "holds": [], "bars": [{ "bar": 1, "start": 1.5 }] });
        let text = serialize_alignment(&value, &h).unwrap();
        assert!(text.contains('\n'));
        assert_eq!(parse_alignment(&text, &h), Some(value));
    }

    #[test]
    fn a_file_for_another_recording_or_version_reads_as_none() {
        let h = hash();
        let other = "cd".repeat(32);
        let text = serde_json::to_string(&json!({ "version": 1, "recording": other })).unwrap();
        assert_eq!(parse_alignment(&text, &h), None);
        assert_eq!(parse_alignment(r#"{"version":2,"recording":"x"}"#, &h), None);
        assert_eq!(parse_alignment(&format!(r#"{{"recording":"{h}"}}"#), &h), None);
    }

    #[test]
    fn unreadable_text_reads_as_none() {
        let h = hash();
        assert_eq!(parse_alignment("{not json", &h), None);
        assert_eq!(parse_alignment("", &h), None);
        assert_eq!(parse_alignment("[1,2]", &h), None);
    }

    #[test]
    fn serialize_refuses_a_value_it_would_not_read_back() {
        let h = hash();
        assert!(serialize_alignment(&json!({ "version": 2, "recording": h }), &h).is_none());
        assert!(serialize_alignment(&json!({ "version": 1, "recording": "other" }), &h).is_none());
        assert!(serialize_alignment(&json!("x"), &h).is_none());
    }
}
