// The report period: which span the figures cover, and where it ends.
//
// Same precedence as the other three binaries — an explicit `--since` instant,
// then `--period-start`, then `--window`, then the inferred anniversary — so one
// habit works everywhere. Only the source-forced difference remains: the 7-day
// window resets from a subscription start nothing local records, which is why the
// frame labels its rolling cut instead of printing a reset instant.
use crate::cli;
use crate::oduse::window;

/// `YYYY-MM-DD` -> epoch ms at 00:00 UTC.
pub fn parse_day(value: &str) -> Option<i64> {
    let mut parts = value.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    (1..=12).contains(&m).then_some(())?;
    (1..=31).contains(&d).then_some(())?;
    Some(window::days_from_civil(y, m, d) * 86_400_000)
}

#[derive(Debug, Clone)]
pub struct Period {
    /// `None` only for the inferred anniversary, which `window::build` resolves
    /// from the rows it reads.
    pub start: Option<i64>,
    pub label: String,
    pub inferred: bool,
    /// The `--window` mode that produced it ("month", "all", "<n>d"), so `end`
    /// can resolve from the report's own start.
    pub mode: String,
}

pub fn resolve(
    args: &cli::Args,
    now_ms: i64,
    since_override: Option<i64>,
) -> Result<Period, String> {
    let mode = args.window.clone().unwrap_or_else(|| "month".into());
    let label = |mode: &str| match mode {
        "all" => "all time".to_string(),
        "month" => "calendar month".to_string(),
        other => other.to_string(),
    };
    if let Some(ms) = since_override {
        return Ok(Period {
            start: Some(ms),
            label: format!("since {}", args.since.clone().unwrap_or_default()),
            inferred: false,
            mode,
        });
    }
    if let Some(day) = args.period_start.as_deref() {
        let Some(ms) = parse_day(day) else {
            return Err(format!("--period-start needs YYYY-MM-DD (got '{day}')"));
        };
        return Ok(Period {
            start: Some(ms),
            label: "period start (pinned)".into(),
            inferred: false,
            mode,
        });
    }
    // Inference outranks the window mode: it pins the start itself.
    if args.infer_anniversary {
        return Ok(Period {
            start: None,
            label: "subscription anniversary (inferred)".into(),
            inferred: true,
            mode,
        });
    }
    if mode == "all" {
        return Ok(Period {
            start: Some(0),
            label: label("all"),
            inferred: false,
            mode,
        });
    }
    if mode == "month" {
        return Ok(Period {
            start: Some(window::calendar_month_start(now_ms)),
            label: label("month"),
            inferred: false,
            mode,
        });
    }
    if let Some(d) = mode.strip_suffix('d').and_then(|v| v.parse::<i64>().ok()) {
        return Ok(Period {
            start: Some(now_ms - d * 86_400_000),
            label: label(&mode),
            inferred: false,
            mode,
        });
    }
    Err(format!(
        "oduse: --window expects month, all, or <n>d (got {mode})"
    ))
}

/// The period's end, resolved from the report's own start so an inferred
/// anniversary gets one too. `--window all` has no boundary (`None`).
pub fn end(since_ms: i64, mode: &str, inferred: bool) -> Option<i64> {
    if inferred {
        return Some(window::next_month(since_ms));
    }
    if mode == "all" {
        return None;
    }
    match mode.strip_suffix('d').and_then(|v| v.parse::<i64>().ok()) {
        Some(d) => Some(since_ms + d * 86_400_000),
        None => Some(window::next_month(since_ms)),
    }
}
