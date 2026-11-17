// The refresh cadence every live frame shares: how long one interval waits, and
// when inside it the countdown line is rewritten.
//
// The countdown used to be `for remaining in (1..interval).rev()`, which is an
// EMPTY range at `interval == 1`: the frame was drawn, nothing slept, and the
// next frame was drawn as fast as the source read. oduse showed it worst
// (~196 frames/s, 2.4 MB per 10 s) because its store read is fast, but cmduse,
// ocuse and arkuse had the same hole. Deriving the wait from the interval itself
// removes it, and this module is pure arithmetic, so the cadence is testable
// without a terminal or a real sleep.
use std::time::Duration;

/// When each countdown second lands inside one refresh interval:
/// `(remaining-label, offset-from-frame)` pairs, plus the interval's own length.
///
/// `marks` is empty at `interval == 1` — there is no whole second left to
/// count down, so the frame waits the full second and redraws once.
pub fn tick_schedule(interval: u64) -> (Vec<(u64, Duration)>, Duration) {
    let total = Duration::from_secs(interval);
    let marks = (1..interval)
        .rev()
        .map(|remaining| (remaining, total - Duration::from_secs(remaining)))
        .collect();
    (marks, total)
}

/// Wait out the rest of one refresh interval, calling `at_second` once per whole
/// second still owed so the status line can be rewritten in place. Frame time
/// counts against the interval, so a slow read does not add drift.
pub fn refresh_tick(interval: u64, mut at_second: impl FnMut(u64)) {
    let (marks, total) = tick_schedule(interval);
    let start = std::time::Instant::now();
    for (remaining, offset) in marks {
        sleep_until(start + offset);
        at_second(remaining);
    }
    sleep_until(start + total);
}

/// Sleep only if the deadline is still ahead of us: a frame that took longer
/// than its own interval must not sleep at all.
fn sleep_until(deadline: std::time::Instant) {
    if let Some(wait) = deadline.checked_duration_since(std::time::Instant::now()) {
        std::thread::sleep(wait);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_second_interval_waits_a_whole_second_and_owes_no_countdown() {
        // THE redraw-storm bug, pinned: `(1..1)` is empty, so the old loop slept
        // zero and the frame redrew at the speed of the store read.
        let (marks, total) = tick_schedule(1);
        assert!(marks.is_empty(), "no countdown marks at 1s: {marks:?}");
        assert_eq!(total, Duration::from_secs(1));
    }

    #[test]
    fn each_countdown_second_lands_inside_the_interval() {
        let (marks, total) = tick_schedule(5);
        assert_eq!(total, Duration::from_secs(5));
        assert_eq!(
            marks,
            vec![
                (4, Duration::from_secs(1)),
                (3, Duration::from_secs(2)),
                (2, Duration::from_secs(3)),
                (1, Duration::from_secs(4)),
            ]
        );
    }

    #[test]
    fn no_interval_can_schedule_a_shorter_wait_than_itself() {
        // The invariant the bug broke: whatever the interval, one frame is
        // followed by at least that many seconds of waiting.
        for interval in [1u64, 2, 3, 5, 10, 60, 3_600, 86_400] {
            let (marks, total) = tick_schedule(interval);
            assert_eq!(total, Duration::from_secs(interval), "interval {interval}");
            assert_eq!(marks.len() as u64, interval - 1, "interval {interval}");
            for (remaining, offset) in marks {
                assert!(remaining < interval, "interval {interval} mark {remaining}");
                assert!(offset < total, "interval {interval} offset {offset:?}");
            }
        }
    }
}
