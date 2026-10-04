//! Model download progress (KTD14). torch writes the checkpoint to a randomly named temporary file under
//! `TORCH_HOME/hub/checkpoints` and renames it only when complete, so the size of the largest file in that
//! folder, against the known model size, estimates how far the download is. The mapping is pure; the folder
//! read is the only I/O here. When the layout does not match, the answer is "indeterminate", never a stuck value.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Where FFmpeg's step ends and the model download begins on the overall setup bar.
pub const FFMPEG_END: f64 = 0.5;
/// The model download never reports past this; the last stretch is the warm-up finishing and the marker write.
pub const MODEL_END: f64 = 0.95;
/// ESTIMATE, not verified against a real download: the size in bytes of the htdemucs_6s checkpoint that
/// `app.pipeline.warmup` fetches through demucs (about 55 MB). If it is wrong the bar still moves and caps at
/// `MODEL_END`; if the cache layout differs from this, the result falls back to indeterminate.
pub const KNOWN_MODEL_BYTES: u64 = 55 * 1024 * 1024;

/// How long the checkpoint folder may stay exactly the same size before the download counts as hung. Generous on
/// purpose: the warm-up imports its Python stack silently before the first byte arrives, and a slow link may crawl.
pub const STALL_LIMIT: Duration = Duration::from_secs(300);

#[derive(Debug, PartialEq)]
pub enum ModelProgress {
    /// Not enough information to show a percentage; the page shows an indeterminate bar.
    Indeterminate,
    /// Overall setup progress, between `FFMPEG_END` and `MODEL_END`.
    Fraction(f64),
}

/// `largest` is the size of the biggest file in the checkpoint folder, or `None` when the folder is missing
/// or holds no file yet.
pub fn model_progress(largest: Option<u64>, known_total: u64) -> ModelProgress {
    match largest {
        Some(size) if known_total > 0 => {
            let share = (size as f64 / known_total as f64).clamp(0.0, 1.0);
            ModelProgress::Fraction(FFMPEG_END + (MODEL_END - FFMPEG_END) * share)
        }
        _ => ModelProgress::Indeterminate,
    }
}

/// torch's temporary download files have a random name with no extension (`tmpab12cd34`); finished
/// checkpoints keep their `.th`/`.pth` name. Only the former are stale partials.
pub fn is_partial_name(name: &str) -> bool {
    name.starts_with("tmp") && !name.contains('.')
}

pub fn checkpoint_dir(torch_home: &Path) -> PathBuf {
    torch_home.join("hub").join("checkpoints")
}

/// Largest file size in the folder, or `None` when it is missing, unreadable or has no files.
pub fn largest_file_size(dir: &Path) -> Option<u64> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .max()
}

/// Total size of every file in the folder, or `None` when it is missing or unreadable. Unlike the largest file,
/// it moves whenever any download in the folder grows, which is what a stall check needs.
pub fn folder_total_size(dir: &Path) -> Option<u64> {
    let entries = fs::read_dir(dir).ok()?;
    Some(entries.filter_map(|e| e.ok()).filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
}

/// Notices a download that has stopped moving. Feed it the folder's total size and the time since setup began; it
/// reports a stall once the size has not changed for `STALL_LIMIT`. Pure, so the timing is testable without a clock.
pub struct StallWatch {
    last_total: Option<u64>,
    last_change: Duration,
}

impl StallWatch {
    pub fn new() -> Self {
        StallWatch { last_total: None, last_change: Duration::ZERO }
    }

    /// Records the folder's total size at `now`; true when it has not changed for the limit.
    pub fn observe(&mut self, total: Option<u64>, now: Duration) -> bool {
        if total != self.last_total {
            self.last_total = total;
            self.last_change = now;
        }
        now.saturating_sub(self.last_change) >= STALL_LIMIT
    }
}

/// Removes leftover partial downloads so a retry starts from zero and the bar does not start at the old size.
pub fn clear_partials(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_str().is_some_and(is_partial_name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: u64 = 1000;

    fn fraction(v: ModelProgress) -> f64 {
        match v {
            ModelProgress::Fraction(f) => f,
            ModelProgress::Indeterminate => panic!("expected a fraction"),
        }
    }

    #[test]
    fn covers_ae12_zero_forty_and_hundred_percent_rise_between_ffmpeg_end_and_completion() {
        let zero = fraction(model_progress(Some(0), TOTAL));
        let forty = fraction(model_progress(Some(400), TOTAL));
        let full = fraction(model_progress(Some(1000), TOTAL));
        assert!((zero - FFMPEG_END).abs() < 1e-9);
        assert!((full - MODEL_END).abs() < 1e-9);
        assert!(zero < forty && forty < full);
        assert!((forty - (FFMPEG_END + 0.4 * (MODEL_END - FFMPEG_END))).abs() < 1e-9);
    }

    #[test]
    fn a_partial_file_larger_than_the_known_size_is_capped() {
        assert!((fraction(model_progress(Some(5000), TOTAL)) - MODEL_END).abs() < 1e-9);
    }

    #[test]
    fn a_missing_or_empty_folder_is_indeterminate() {
        assert_eq!(model_progress(None, TOTAL), ModelProgress::Indeterminate);
        assert_eq!(model_progress(Some(10), 0), ModelProgress::Indeterminate);
    }

    #[test]
    fn largest_file_size_of_a_missing_folder_is_none() {
        assert_eq!(largest_file_size(Path::new("this/folder/does/not/exist")), None);
    }

    #[test]
    fn largest_file_size_reads_the_biggest_file_and_clear_partials_keeps_finished_checkpoints() {
        let dir = std::env::temp_dir().join(format!("tabhighway-mp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(largest_file_size(&dir), None);
        fs::write(dir.join("tmpab12cd"), vec![0u8; 300]).unwrap();
        fs::write(dir.join("abc.th"), vec![0u8; 100]).unwrap();
        assert_eq!(largest_file_size(&dir), Some(300));
        clear_partials(&dir);
        assert!(!dir.join("tmpab12cd").exists());
        assert!(dir.join("abc.th").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn partial_names_are_random_extensionless_temp_files() {
        assert!(is_partial_name("tmpk3j2h1"));
        assert!(!is_partial_name("5c90dfd2-34c22ccb.th"));
        assert!(!is_partial_name("tmp.th"));
    }

    use std::time::Duration;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn a_download_that_stops_growing_is_stalled_only_after_the_limit() {
        let mut watch = StallWatch::new();
        assert!(!watch.observe(Some(100), secs(0)));
        // The same size for just under the limit is not yet a stall.
        assert!(!watch.observe(Some(100), STALL_LIMIT - secs(1)));
        assert!(watch.observe(Some(100), STALL_LIMIT));
    }

    #[test]
    fn any_change_in_the_folder_resets_the_clock() {
        let mut watch = StallWatch::new();
        assert!(!watch.observe(Some(100), secs(0)));
        assert!(!watch.observe(Some(150), STALL_LIMIT - secs(10)));
        // The clock restarted at the change, so the limit counts from there, not from the start.
        assert!(!watch.observe(Some(150), STALL_LIMIT * 2 - secs(11)));
        assert!(watch.observe(Some(150), STALL_LIMIT * 2 - secs(10)));
    }

    #[test]
    fn a_folder_that_never_appears_stalls_from_the_start_and_the_first_file_counts_as_progress() {
        let mut watch = StallWatch::new();
        assert!(!watch.observe(None, secs(10)));
        assert!(!watch.observe(Some(0), secs(20)));
        assert!(watch.observe(Some(0), secs(20) + STALL_LIMIT));
        let mut silent = StallWatch::new();
        assert!(silent.observe(None, STALL_LIMIT));
    }

    #[test]
    fn folder_total_size_adds_every_file_so_a_second_smaller_download_counts() {
        let dir = std::env::temp_dir().join(format!("tabhighway-mp-total-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(folder_total_size(&dir), None);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(folder_total_size(&dir), Some(0));
        fs::write(dir.join("big.th"), vec![0u8; 500]).unwrap();
        fs::write(dir.join("tmpab12cd"), vec![0u8; 20]).unwrap();
        assert_eq!(folder_total_size(&dir), Some(520));
        // The largest file is unchanged while the second download grows, but the total moves.
        fs::write(dir.join("tmpab12cd"), vec![0u8; 80]).unwrap();
        assert_eq!(largest_file_size(&dir), Some(500));
        assert_eq!(folder_total_size(&dir), Some(580));
        let _ = fs::remove_dir_all(&dir);
    }
}
