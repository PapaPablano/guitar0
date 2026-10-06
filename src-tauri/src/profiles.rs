// Per-recording profile file helpers. The file is recording-profiles.json, separate from stem-index.json.
// The page owns the shape; the shell only guards the envelope so an unreadable or newer file reads as empty.

use serde_json::{json, Value};

/// The envelope version the page writes. Any other version is not understood here.
pub const FILE_VERSION: u64 = 1;

pub fn empty_file() -> Value {
    json!({ "version": FILE_VERSION, "entries": [] })
}

/// A stored profile file as JSON. Unreadable text, a non-object, an unknown version or a missing entries list all read as empty.
pub fn parse_profiles(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(value) if value.get("version").and_then(Value::as_u64) == Some(FILE_VERSION) && value.get("entries").map_or(false, Value::is_array) => value,
        _ => empty_file(),
    }
}

/// The text to write for a profile file from the page, or None when it is not a version-1 file with an entries list.
pub fn serialize_profiles(value: &Value) -> Option<String> {
    if value.get("version").and_then(Value::as_u64) != Some(FILE_VERSION) || !value.get("entries").map_or(false, Value::is_array) {
        return None;
    }
    serde_json::to_string(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_valid_file_round_trips() {
        let text = r#"{"version":1,"entries":[{"hash":"h","profile":{"version":1,"offset":0.5}}]}"#;
        let parsed = parse_profiles(text);
        assert_eq!(parsed["entries"][0]["hash"], "h");
        let out = serialize_profiles(&parsed).unwrap();
        assert_eq!(parse_profiles(&out), parsed);
    }

    #[test]
    fn extra_fields_inside_an_entry_survive_a_read_and_write() {
        let text = r#"{"version":1,"entries":[{"hash":"h","profile":{"version":1,"offset":0.5,"alignment":{"source":"auto","holds":[],"anchors":[1.0,3.0],"endAnchor":5.0,"revision":1,"fingerprint":"6:0f0f0f0f","tier":"lined-up","attempt":{"revision":1,"fingerprint":"6:0f0f0f0f"},"previousOffset":0.4}}}]}"#;
        let parsed = parse_profiles(text);
        let out = serialize_profiles(&parsed).unwrap();
        let back = parse_profiles(&out);
        let alignment = &back["entries"][0]["profile"]["alignment"];
        assert_eq!(alignment["revision"], 1);
        assert_eq!(alignment["fingerprint"], "6:0f0f0f0f");
        assert_eq!(alignment["tier"], "lined-up");
        assert_eq!(alignment["attempt"]["revision"], 1);
        assert_eq!(alignment["previousOffset"], 0.4);
    }

    #[test]
    fn unreadable_text_reads_as_empty() {
        assert_eq!(parse_profiles("{not json"), empty_file());
        assert_eq!(parse_profiles(""), empty_file());
        assert_eq!(parse_profiles("[1,2]"), empty_file());
    }

    #[test]
    fn an_unknown_version_reads_as_empty() {
        assert_eq!(parse_profiles(r#"{"version":2,"entries":[{"hash":"h"}]}"#), empty_file());
        assert_eq!(parse_profiles(r#"{"entries":[]}"#), empty_file());
        assert_eq!(parse_profiles(r#"{"version":1}"#), empty_file());
    }

    #[test]
    fn serialize_refuses_a_file_it_would_not_read_back() {
        assert!(serialize_profiles(&json!({ "version": 2, "entries": [] })).is_none());
        assert!(serialize_profiles(&json!({ "version": 1, "entries": {} })).is_none());
        assert!(serialize_profiles(&json!("x")).is_none());
        assert!(serialize_profiles(&empty_file()).is_some());
    }
}
