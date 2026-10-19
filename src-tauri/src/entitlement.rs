// Pro status. The backend signs a short-lived status document; the shell checks the signature, the device and the
// dates, and tells the page which tier it is on. The decision (`evaluate`) is pure so every rule has a test; the rest
// of this file stores the document and exposes the commands.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// How long a freshly issued status stays valid, set by the backend in the document's `expires_at`.
/// The shell only needs the refresh cadence below.
const REFRESH_AFTER_SECS: i64 = 24 * 60 * 60;
/// How far a clock may disagree with a document or with the latest time seen before the document is distrusted.
const CLOCK_SKEW_SECS: i64 = 5 * 60;
/// The latest-time-seen marker is only rewritten when it advances by at least this much.
const LAST_SEEN_WRITE_EVERY_SECS: i64 = 60 * 60;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SignedStatus {
    /// The status as JSON text. The signature covers exactly these bytes.
    pub payload: String,
    /// Base64 (URL-safe, no padding) Ed25519 signature of `payload`.
    pub signature: String,
}

#[derive(Deserialize)]
struct Payload {
    tier: String,
    issued_at: i64,
    expires_at: i64,
    device_id: String,
    #[serde(default)]
    features: Features,
}

#[derive(Deserialize)]
struct Features {
    #[serde(default = "yes")]
    youtube: bool,
}

impl Default for Features {
    fn default() -> Self {
        Features { youtube: true }
    }
}

fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Free,
    Pro,
}

/// What the page is told.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub tier: Tier,
    /// The page should ask the backend for a fresh status (none stored, expired, or older than a day).
    pub needs_refresh: bool,
    /// The remote switch for YouTube import. Only meaningful for Pro.
    pub youtube: bool,
    /// Unix seconds at which the stored status stops working, when there is a usable one.
    pub valid_until: Option<i64>,
    /// Why the tier is Free, for support and for the page's wording.
    pub reason: Option<&'static str>,
    pub device_id: String,
}

fn free(reason: &'static str, needs_refresh: bool, device_id: &str) -> View {
    View { tier: Tier::Free, needs_refresh, youtube: false, valid_until: None, reason: Some(reason), device_id: device_id.to_string() }
}

/// Decides the tier. `last_seen` is the latest wall-clock time this install has ever seen, so winding the clock back
/// does not revive an old status.
pub fn evaluate(stored: Option<&SignedStatus>, key: Option<&VerifyingKey>, device_id: &str, now: i64, last_seen: i64) -> View {
    let Some(key) = key else { return free("no-key", false, device_id) };
    let Some(signed) = stored else { return free("none", true, device_id) };
    let Some(payload) = verified_payload(signed, key) else { return free("invalid", true, device_id) };
    if payload.device_id != device_id {
        return free("other-device", true, device_id);
    }
    if payload.issued_at > now + CLOCK_SKEW_SECS {
        return free("issued-in-the-future", true, device_id);
    }
    if now + CLOCK_SKEW_SECS < last_seen {
        return free("clock-moved-back", true, device_id);
    }
    if now > payload.expires_at {
        return free("expired", true, device_id);
    }
    let needs_refresh = now - payload.issued_at >= REFRESH_AFTER_SECS;
    if payload.tier != "pro" {
        return free("free-plan", needs_refresh, device_id);
    }
    View {
        tier: Tier::Pro,
        needs_refresh,
        youtube: payload.features.youtube,
        valid_until: Some(payload.expires_at),
        reason: None,
        device_id: device_id.to_string(),
    }
}

fn verified_payload(signed: &SignedStatus, key: &VerifyingKey) -> Option<Payload> {
    let signature_bytes = URL_SAFE_NO_PAD.decode(signed.signature.as_bytes()).ok()?;
    let signature = Signature::from_slice(&signature_bytes).ok()?;
    key.verify(signed.payload.as_bytes(), &signature).ok()?;
    serde_json::from_str(&signed.payload).ok()
}

/// A stable id for this machine: a hash of the Windows machine GUID, so copying the data folder to another PC does not
/// carry the registration along. Not secret.
pub fn device_id_from_machine_guid(guid: &str) -> String {
    let digest = Sha256::digest(format!("tabhighway-device-v1:{}", guid.trim().to_lowercase()).as_bytes());
    format!("{digest:x}")[..32].to_string()
}

fn read_machine_guid() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find(|l| l.contains("MachineGuid")).and_then(|l| l.split_whitespace().last()).map(str::to_string)
}

/// The public key that checks statuses, compiled in from `TABHIGHWAY_STATUS_PUBLIC_KEY` (base64, URL-safe, 32 bytes).
/// A debug build may also read it at run time so a local backend can be tried. With no key, nobody is Pro.
fn configured_key() -> Option<VerifyingKey> {
    #[cfg(debug_assertions)]
    let runtime = std::env::var("TABHIGHWAY_STATUS_PUBLIC_KEY").ok();
    #[cfg(not(debug_assertions))]
    let runtime: Option<String> = None;
    let text = runtime.or_else(|| option_env!("TABHIGHWAY_STATUS_PUBLIC_KEY").map(str::to_string))?;
    let bytes: [u8; 32] = URL_SAFE_NO_PAD.decode(text.trim().as_bytes()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFile {
    status: Option<SignedStatus>,
    last_seen: i64,
}

struct Inner {
    stored: Option<SignedStatus>,
    last_seen: i64,
    last_seen_written: i64,
}

pub struct Entitlements {
    inner: Mutex<Inner>,
    key: Option<VerifyingKey>,
    device_id: String,
    path: Option<PathBuf>,
    /// Pre-launch builds only: treat every install as Pro. See `dev_unlock`.
    dev_unlock: bool,
}

/// A build made with `TABHIGHWAY_DEV_PRO=1` is Pro for everyone, so the owner can use stems before billing exists.
/// A release build must never carry it; `scripts/package-windows.ps1` warns when it is set.
fn dev_unlock() -> bool {
    option_env!("TABHIGHWAY_DEV_PRO") == Some("1")
}

impl Entitlements {
    /// Loads the stored status from the data folder. A missing or unreadable file reads as no status.
    pub fn load(data_dir: Option<PathBuf>) -> Entitlements {
        let path = data_dir.map(|d| d.join("entitlement.json"));
        let file: StoredFile = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let device_id = read_machine_guid().map(|g| device_id_from_machine_guid(&g)).unwrap_or_else(|| "unknown-device".to_string());
        let mut entitlements = Entitlements::with(configured_key(), device_id, path, file);
        entitlements.dev_unlock = dev_unlock();
        entitlements
    }

    fn with(key: Option<VerifyingKey>, device_id: String, path: Option<PathBuf>, file: StoredFile) -> Entitlements {
        let last_seen_written = file.last_seen;
        Entitlements { inner: Mutex::new(Inner { stored: file.status, last_seen: file.last_seen, last_seen_written }), key, device_id, path, dev_unlock: false }
    }

    pub fn view(&self) -> View {
        self.view_at(now_secs())
    }

    fn view_at(&self, now: i64) -> View {
        if self.dev_unlock {
            return View { tier: Tier::Pro, needs_refresh: false, youtube: true, valid_until: None, reason: Some("dev-unlock"), device_id: self.device_id.clone() };
        }
        let mut inner = self.inner.lock().unwrap();
        let view = evaluate(inner.stored.as_ref(), self.key.as_ref(), &self.device_id, now, inner.last_seen);
        if now > inner.last_seen {
            inner.last_seen = now;
            if now - inner.last_seen_written >= LAST_SEEN_WRITE_EVERY_SECS {
                inner.last_seen_written = now;
                let _ = self.persist(&inner);
            }
        }
        view
    }

    pub fn is_pro(&self) -> bool {
        self.view().tier == Tier::Pro
    }

    /// Keeps a status only if it checks out for this device right now; anything else is refused and changes nothing.
    pub fn store(&self, signed: SignedStatus) -> Result<View, String> {
        self.store_at(signed, now_secs())
    }

    fn store_at(&self, signed: SignedStatus, now: i64) -> Result<View, String> {
        let probe = evaluate(Some(&signed), self.key.as_ref(), &self.device_id, now, 0);
        if let Some(reason) = probe.reason {
            if reason != "free-plan" {
                return Err(format!("that status was not accepted ({reason})"));
            }
        }
        let mut inner = self.inner.lock().unwrap();
        inner.stored = Some(signed);
        inner.last_seen = inner.last_seen.max(now);
        inner.last_seen_written = inner.last_seen;
        self.persist(&inner)?;
        let view = evaluate(inner.stored.as_ref(), self.key.as_ref(), &self.device_id, now, inner.last_seen);
        Ok(view)
    }

    pub fn clear(&self) -> Result<View, String> {
        let now = now_secs();
        let mut inner = self.inner.lock().unwrap();
        inner.stored = None;
        self.persist(&inner)?;
        Ok(evaluate(None, self.key.as_ref(), &self.device_id, now, inner.last_seen))
    }

    fn persist(&self, inner: &Inner) -> Result<(), String> {
        let Some(path) = &self.path else { return Ok(()) };
        let text = serde_json::to_string(&StoredFile { status: inner.stored.clone(), last_seen: inner.last_seen }).map_err(|e| e.to_string())?;
        crate::write_atomic(path, text)
    }
}

#[tauri::command]
pub fn entitlement_status(state: tauri::State<Entitlements>) -> View {
    state.view()
}

#[tauri::command]
pub fn entitlement_store(signed: SignedStatus, state: tauri::State<Entitlements>) -> Result<View, String> {
    state.store(signed)
}

#[tauri::command]
pub fn entitlement_clear(state: tauri::State<Entitlements>) -> Result<View, String> {
    state.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const DEVICE: &str = "device-one";
    const DAY: i64 = 24 * 60 * 60;
    const NOW: i64 = 1_800_000_000;

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn other_signing_key() -> SigningKey {
        SigningKey::from_bytes(&[9u8; 32])
    }

    fn sign_with(key: &SigningKey, payload: &str) -> SignedStatus {
        SignedStatus { payload: payload.to_string(), signature: URL_SAFE_NO_PAD.encode(key.sign(payload.as_bytes()).to_bytes()) }
    }

    fn status(tier: &str, issued_at: i64, expires_at: i64, device: &str, youtube: Option<bool>) -> String {
        let features = youtube.map(|y| format!(r#","features":{{"youtube":{y}}}"#)).unwrap_or_default();
        format!(r#"{{"account":"a","tier":"{tier}","issued_at":{issued_at},"expires_at":{expires_at},"device_id":"{device}"{features}}}"#)
    }

    fn pro_issued(days_ago: i64) -> SignedStatus {
        let issued = NOW - days_ago * DAY;
        sign_with(&signing_key(), &status("pro", issued, issued + 30 * DAY, DEVICE, None))
    }

    fn check(stored: Option<&SignedStatus>, now: i64, last_seen: i64) -> View {
        evaluate(stored, Some(&signing_key().verifying_key()), DEVICE, now, last_seen)
    }

    #[test]
    fn a_correctly_signed_status_for_this_device_is_pro() {
        let view = check(Some(&pro_issued(0)), NOW, 0);
        assert_eq!(view.tier, Tier::Pro);
        assert_eq!(view.reason, None);
        assert_eq!(view.valid_until, Some(NOW + 30 * DAY));
        assert!(!view.needs_refresh);
    }

    #[test]
    fn a_tampered_tier_reads_as_free() {
        let good = pro_issued(0);
        let tampered = SignedStatus { payload: good.payload.replace(r#""tier":"pro""#, r#""tier":"pro ""#), signature: good.signature.clone() };
        assert_eq!(check(Some(&tampered), NOW, 0).tier, Tier::Free);
        let forged_tier = SignedStatus { payload: good.payload.replace("pro", "max"), signature: good.signature };
        assert_eq!(check(Some(&forged_tier), NOW, 0).reason, Some("invalid"));
    }

    #[test]
    fn a_status_signed_by_a_different_key_reads_as_free() {
        let issued = NOW;
        let forged = sign_with(&other_signing_key(), &status("pro", issued, issued + 30 * DAY, DEVICE, None));
        let view = check(Some(&forged), NOW, 0);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("invalid"));
    }

    #[test]
    fn garbage_signatures_and_payloads_read_as_free_without_panicking() {
        for signature in ["", "!!!", "AAAA"] {
            let bad = SignedStatus { payload: "{}".to_string(), signature: signature.to_string() };
            assert_eq!(check(Some(&bad), NOW, 0).tier, Tier::Free);
        }
        let not_json = sign_with(&signing_key(), "not json");
        assert_eq!(check(Some(&not_json), NOW, 0).reason, Some("invalid"));
    }

    #[test]
    fn a_status_for_another_device_reads_as_free() {
        let issued = NOW;
        let other = sign_with(&signing_key(), &status("pro", issued, issued + 30 * DAY, "device-two", None));
        let view = check(Some(&other), NOW, 0);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("other-device"));
    }

    #[test]
    fn offline_for_five_days_is_still_pro_but_thirty_one_days_needs_a_refresh() {
        let five = check(Some(&pro_issued(5)), NOW, NOW - DAY);
        assert_eq!(five.tier, Tier::Pro);
        assert!(five.needs_refresh);
        let thirty_one = check(Some(&pro_issued(31)), NOW, NOW - DAY);
        assert_eq!(thirty_one.tier, Tier::Free);
        assert_eq!(thirty_one.reason, Some("expired"));
        assert!(thirty_one.needs_refresh);
    }

    #[test]
    fn a_status_issued_in_the_future_is_rejected() {
        let future = sign_with(&signing_key(), &status("pro", NOW + 2 * DAY, NOW + 32 * DAY, DEVICE, None));
        assert_eq!(check(Some(&future), NOW, 0).reason, Some("issued-in-the-future"));
        let within_skew = sign_with(&signing_key(), &status("pro", NOW + 60, NOW + 30 * DAY, DEVICE, None));
        assert_eq!(check(Some(&within_skew), NOW, 0).tier, Tier::Pro);
    }

    #[test]
    fn winding_the_clock_back_does_not_revive_an_old_status() {
        // Issued 40 days ago (expired), but the clock now claims it is 20 days ago.
        let old = pro_issued(40);
        let rolled_back = NOW - 20 * DAY;
        let view = check(Some(&old), rolled_back, NOW);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("clock-moved-back"));
    }

    #[test]
    fn no_stored_status_is_free_and_asks_for_a_refresh() {
        let view = check(None, NOW, 0);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("none"));
        assert!(view.needs_refresh);
    }

    #[test]
    fn without_a_compiled_in_key_nobody_is_pro() {
        let view = evaluate(Some(&pro_issued(0)), None, DEVICE, NOW, 0);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("no-key"));
        assert!(!view.needs_refresh);
    }

    #[test]
    fn a_free_plan_status_is_free() {
        let issued = NOW;
        let free_plan = sign_with(&signing_key(), &status("free", issued, issued + 30 * DAY, DEVICE, None));
        let view = check(Some(&free_plan), NOW, 0);
        assert_eq!(view.tier, Tier::Free);
        assert_eq!(view.reason, Some("free-plan"));
    }

    #[test]
    fn the_youtube_switch_comes_from_the_status() {
        let on = sign_with(&signing_key(), &status("pro", NOW, NOW + 30 * DAY, DEVICE, Some(true)));
        let off = sign_with(&signing_key(), &status("pro", NOW, NOW + 30 * DAY, DEVICE, Some(false)));
        assert!(check(Some(&on), NOW, 0).youtube);
        assert!(!check(Some(&off), NOW, 0).youtube);
        assert!(check(Some(&pro_issued(0)), NOW, 0).youtube, "a status that does not mention the switch leaves it on");
    }

    #[test]
    fn the_device_id_is_stable_and_differs_per_machine() {
        let a = device_id_from_machine_guid("ABCDEF-1");
        assert_eq!(a, device_id_from_machine_guid(" abcdef-1\r\n"));
        assert_ne!(a, device_id_from_machine_guid("abcdef-2"));
        assert_eq!(a.len(), 32);
    }

    fn store_for(file: StoredFile, path: Option<PathBuf>) -> Entitlements {
        Entitlements::with(Some(signing_key().verifying_key()), DEVICE.to_string(), path, file)
    }

    #[test]
    fn storing_accepts_a_good_status_and_refuses_bad_ones_without_changing_anything() {
        let ent = store_for(StoredFile::default(), None);
        let forged = sign_with(&other_signing_key(), &status("pro", NOW, NOW + 30 * DAY, DEVICE, None));
        assert!(ent.store_at(forged, NOW).is_err());
        assert_eq!(ent.view_at(NOW).tier, Tier::Free);
        let view = ent.store_at(pro_issued(0), NOW).unwrap();
        assert_eq!(view.tier, Tier::Pro);
        assert_eq!(ent.view_at(NOW + DAY).tier, Tier::Pro);
        assert_eq!(ent.clear().map(|v| v.tier), Ok(Tier::Free));
    }

    #[test]
    fn a_dev_unlock_build_is_pro_without_any_status() {
        let mut ent = Entitlements::with(None, DEVICE.to_string(), None, StoredFile::default());
        assert_eq!(ent.view_at(NOW).tier, Tier::Free);
        ent.dev_unlock = true;
        let view = ent.view_at(NOW);
        assert_eq!(view.tier, Tier::Pro);
        assert_eq!(view.reason, Some("dev-unlock"));
    }

    #[test]
    fn a_stored_status_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("tabhighway-entitlement-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("entitlement.json");
        {
            let ent = store_for(StoredFile::default(), Some(path.clone()));
            ent.store_at(pro_issued(0), NOW).unwrap();
        }
        let file: StoredFile = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let again = store_for(file, Some(path));
        assert_eq!(again.view_at(NOW + DAY).tier, Tier::Pro);
        let _ = fs::remove_dir_all(&dir);
    }
}
