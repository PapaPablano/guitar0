//! Pure rules for engine recovery (KTD13): how long to wait for a slow start, when one automatic restart
//! is allowed, when to rotate the engine log, and how to pull the tail out of it. No I/O lives here.

use std::time::Duration;

/// The wait never ends before this (the old fixed wait), and never continues past `HEALTH_CEILING`.
/// The engine imports its Python stack silently before it logs, so log growth is not required.
pub const HEALTH_CEILING: Duration = Duration::from_secs(300);
/// How long the engine must stay up before a later failure earns a fresh automatic restart.
pub const HEALTHY_PERIOD: Duration = Duration::from_secs(120);
/// engine.log is rotated to engine.log.1 at the next start once it passes this size.
pub const LOG_ROTATE_BYTES: u64 = 1024 * 1024;
/// How many trailing log lines, and at most how many characters, go into an error.
pub const TAIL_LINES: usize = 20;
pub const TAIL_MAX_CHARS: usize = 4000;

#[derive(Debug, PartialEq, Eq)]
pub enum HealthWait {
    Ready,
    Keep,
    Exited,
    CeilingReached,
}

/// What the health wait does next, given time spent, whether the process is alive, and whether it answered.
pub fn health_decision(elapsed: Duration, process_alive: bool, healthy: bool) -> HealthWait {
    if healthy {
        HealthWait::Ready
    } else if !process_alive {
        HealthWait::Exited
    } else if elapsed >= HEALTH_CEILING {
        HealthWait::CeilingReached
    } else {
        HealthWait::Keep
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ExitAction {
    Restart,
    GiveUp,
}

/// One automatic restart per healthy period.
#[derive(Default)]
pub struct RestartAllowance {
    used: bool,
}

impl RestartAllowance {
    /// The engine process ended. Only an unexpected exit of a ready engine, with the allowance unused, restarts.
    pub fn on_exit(&mut self, was_ready: bool, user_initiated: bool) -> ExitAction {
        if user_initiated || !was_ready || self.used {
            return ExitAction::GiveUp;
        }
        self.used = true;
        ExitAction::Restart
    }

    /// The engine has now been ready this long; a long enough stretch earns the allowance back.
    pub fn on_healthy_for(&mut self, healthy: Duration) {
        if healthy >= HEALTHY_PERIOD {
            self.used = false;
        }
    }

    pub fn on_user_retry(&mut self) {
        self.used = false;
    }
}

pub fn should_rotate(size: u64) -> bool {
    size > LOG_ROTATE_BYTES
}

/// The last `n` non-trailing-blank lines, capped to `TAIL_MAX_CHARS` characters (cut from the front).
pub fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end()).collect();
    let end = lines.iter().rposition(|l| !l.is_empty()).map_or(0, |i| i + 1);
    let start = end.saturating_sub(n);
    let joined = lines[start..end].join("\n");
    let count = joined.chars().count();
    if count > TAIL_MAX_CHARS {
        joined.chars().skip(count - TAIL_MAX_CHARS).collect()
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: fn(u64) -> Duration = Duration::from_secs;

    #[test]
    fn a_silent_but_alive_engine_keeps_the_wait_going_past_the_old_90_seconds() {
        assert_eq!(health_decision(S(91), true, false), HealthWait::Keep);
        assert_eq!(health_decision(S(299), true, false), HealthWait::Keep);
        assert!(HEALTH_CEILING >= S(90));
    }

    #[test]
    fn the_ceiling_ends_the_wait_for_an_engine_that_never_answers() {
        assert_eq!(health_decision(HEALTH_CEILING, true, false), HealthWait::CeilingReached);
    }

    #[test]
    fn an_exited_process_ends_the_wait_at_once() {
        assert_eq!(health_decision(S(1), false, false), HealthWait::Exited);
    }

    #[test]
    fn healthy_wins_even_at_the_ceiling() {
        assert_eq!(health_decision(HEALTH_CEILING + S(1), true, true), HealthWait::Ready);
    }

    #[test]
    fn the_first_unexpected_exit_after_ready_restarts_and_a_second_does_not() {
        let mut a = RestartAllowance::default();
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
        assert_eq!(a.on_exit(true, false), ExitAction::GiveUp);
    }

    #[test]
    fn a_user_stop_or_an_exit_before_ready_never_restarts_and_keeps_the_allowance() {
        let mut a = RestartAllowance::default();
        assert_eq!(a.on_exit(true, true), ExitAction::GiveUp);
        assert_eq!(a.on_exit(false, false), ExitAction::GiveUp);
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
    }

    #[test]
    fn the_allowance_resets_after_a_healthy_period_but_not_before() {
        let mut a = RestartAllowance::default();
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
        a.on_healthy_for(HEALTHY_PERIOD - S(1));
        assert_eq!(a.on_exit(true, false), ExitAction::GiveUp);
        a.on_healthy_for(HEALTHY_PERIOD);
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
    }

    #[test]
    fn a_user_retry_resets_the_allowance() {
        let mut a = RestartAllowance::default();
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
        a.on_user_retry();
        assert_eq!(a.on_exit(true, false), ExitAction::Restart);
    }

    #[test]
    fn rotation_happens_only_past_the_size_limit() {
        assert!(!should_rotate(LOG_ROTATE_BYTES));
        assert!(should_rotate(LOG_ROTATE_BYTES + 1));
    }

    #[test]
    fn the_tail_is_the_last_lines_without_trailing_blanks() {
        let text = "a\nb\nc\nd\n\n";
        assert_eq!(tail_lines(text, 2), "c\nd");
        assert_eq!(tail_lines(text, 10), "a\nb\nc\nd");
        assert_eq!(tail_lines("", 3), "");
        assert_eq!(tail_lines("x\r\ny\r\n", 1), "y");
    }

    #[test]
    fn a_long_line_in_the_tail_is_cut_from_the_front() {
        let line = "x".repeat(TAIL_MAX_CHARS + 50);
        let tail = tail_lines(&line, 5);
        assert_eq!(tail.chars().count(), TAIL_MAX_CHARS);
    }
}
