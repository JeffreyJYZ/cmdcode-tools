// The ARK control plane, through `arkcli`.
//
// Unit of truth: AFP. `arkcli usage plan` answers the rolling windows
// (5h / daily / weekly / monthly) with `used`, `total`, `percent` and the
// server's own `reset_at` — the same numbers the Volcengine console shows, and
// the only view that can see traffic from another machine or another harness.
//
// Two design rules, both learned on the OpenCode side of this crate:
//
// * the *percent* the server hands us is printed verbatim, never re-rounded;
// * the local estimate never claims to be the meter. When `arkcli` cannot
//   answer, `Unavailable::reason` says why and the renderers label the rows
//   `estimated locally`.
//
// Shelling out, not HTTP: `arkcli` already owns the credential chain (SSO,
// profile pinning, region/project selection), and re-implementing it here would
// duplicate a signed control-plane client for no gain. One process per poll,
// bounded by `CLI_TIMEOUT_SECS` so a hung CLI cannot pin a watch frame.
use crate::arkuse::window::days_from_civil;
use serde::Deserialize;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Hard cap on one `arkcli` call. The control plane answers in ~2s; anything
/// past this is a hang, and the frame must repaint with the local estimate.
pub const CLI_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Clone)]
pub struct Meter {
    /// `ok` / `exceeded` — ARK reports no status, so it is derived from percent.
    pub status: String,
    /// The server's own percentage, as served.
    pub percent: f64,
    pub used: f64,
    pub quota: f64,
    /// The raw instant, for JSON and the header.
    pub resets_at: Option<String>,
    reset_ms: Option<i64>,
    offset_secs: i64,
}

impl Meter {
    pub fn from_parts(
        status: &str,
        percent: f64,
        used: f64,
        quota: f64,
        resets_at: Option<&str>,
        offset_secs: Option<i64>,
    ) -> Self {
        let parsed = resets_at.and_then(parse_instant);
        Self {
            status: status.into(),
            percent,
            used,
            quota,
            resets_at: resets_at.map(str::to_string),
            reset_ms: parsed.map(|(ms, _)| ms),
            offset_secs: offset_secs
                .or(parsed.map(|(_, off)| off))
                .unwrap_or(8 * 3600),
        }
    }

    pub fn reset_ms(&self) -> Option<i64> {
        self.reset_ms
    }

    /// The server's UTC offset for this window, seconds east-positive.
    pub fn offset_secs(&self) -> i64 {
        self.offset_secs
    }

    pub fn exceeded(&self) -> bool {
        self.percent >= 100.0
    }

    /// AFP still available in this window, floored at zero.
    pub fn remaining(&self) -> f64 {
        (self.quota - self.used).max(0.0)
    }
}

#[derive(Debug, Clone)]
pub struct Usage {
    pub five_hour: Meter,
    /// Present only for plans/workloads that expose a daily window (media and
    /// Harness items); a text-only workload answers 5h/weekly/monthly.
    pub daily: Option<Meter>,
    pub weekly: Meter,
    pub monthly: Meter,
    /// The tier the subscription is on, from the control plane itself — the one
    /// fact no local derivation can know.
    pub tier: Option<String>,
    pub profile: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unavailable {
    /// `--no-api`: deliberate, not a fault.
    Disabled,
    /// No `agent-plan` profile and no `--profile`.
    NoProfile,
    /// `arkcli` is not on PATH.
    CliMissing,
    Failed(String),
}

impl Unavailable {
    pub fn reason(&self) -> String {
        match self {
            Unavailable::Disabled => "API disabled (--no-api)".into(),
            Unavailable::NoProfile => "no agent-plan arkcli profile".into(),
            Unavailable::CliMissing => "arkcli not found on PATH".into(),
            Unavailable::Failed(why) => format!("arkcli: {why}"),
        }
    }
}

#[derive(Deserialize)]
struct ProfileList {
    profiles: Vec<ProfileEntry>,
}

#[derive(Deserialize)]
struct ProfileEntry {
    name: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "plan_tier")]
    tier: Option<String>,
}

/// Resolve the profile to query: `--profile`, then `$ARKUSE_PROFILE`, then the
/// first `agent-plan` profile arkcli lists. Also returns that profile's tier,
/// which is the default for `--plan`.
pub fn resolve(explicit: Option<&str>) -> Option<(String, Option<String>)> {
    let name = explicit.map(str::to_string).or_else(|| {
        std::env::var("ARKUSE_PROFILE")
            .ok()
            .filter(|v| !v.is_empty())
    });
    let listed = profiles();
    if let Some(name) = name {
        let tier = listed
            .iter()
            .find(|(n, _, _)| n == &name)
            .and_then(|(_, _, t)| t.clone());
        return Some((name, tier));
    }
    listed
        .into_iter()
        .find(|(_, kind, _)| kind.as_deref() == Some("agent-plan"))
        .map(|(name, _, tier)| (name, tier))
}

fn profiles() -> Vec<(String, Option<String>, Option<String>)> {
    let Ok(out) = run_cli(&["profile", "list", "--format", "json"]) else {
        return Vec::new();
    };
    serde_json::from_str::<ProfileList>(&out)
        .map(|list| {
            list.profiles
                .into_iter()
                .map(|p| (p.name, p.kind, p.tier))
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct UsageEnvelope {
    items: Vec<UsageItem>,
}

#[derive(Deserialize)]
struct UsageItem {
    edition: Option<String>,
    tier: Option<String>,
    subscribed: Option<bool>,
    #[serde(default)]
    periods: Vec<Period>,
}

#[derive(Deserialize)]
struct Period {
    label: String,
    /// A window can be reported without its figures: measured 2026-10-20, the
    /// just-reset 5-hour block answered `{"label":"5h","total":10000,
    /// "percent":0}` — no `used`, no `reset_at`. Making these required turned
    /// the whole answer into a parse error and dropped the dashboard to the
    /// local estimate, so each is derived from the others when absent.
    #[serde(default)]
    used: Option<f64>,
    #[serde(default)]
    total: f64,
    #[serde(default)]
    percent: Option<f64>,
    reset_at: Option<String>,
}

impl Period {
    /// `(used, percent)`; the server's own percentage wins whenever it is
    /// present, because it is the figure the console prints.
    fn figures(&self) -> (f64, f64) {
        let used = self
            .used
            .unwrap_or_else(|| self.total * self.percent.unwrap_or(0.0) / 100.0);
        let percent = self.percent.unwrap_or_else(|| {
            if self.total > 0.0 {
                used / self.total * 100.0
            } else {
                0.0
            }
        });
        (used, percent)
    }
}

/// Ask the control plane for the plan's meters.
pub fn fetch(profile: &str) -> Result<Usage, Unavailable> {
    let raw = run_cli(&[
        "usage",
        "plan",
        "--profile",
        profile,
        "--product",
        "agent-plan",
        "--format",
        "json",
    ])?;
    parse_usage(&raw, profile)
}

fn parse_usage(raw: &str, profile: &str) -> Result<Usage, Unavailable> {
    let envelope: UsageEnvelope =
        serde_json::from_str(raw).map_err(|e| Unavailable::Failed(format!("parse: {e}")))?;
    // Prefer the personal edition when the account holds several SKUs.
    let item = envelope
        .items
        .iter()
        .find(|i| i.edition.as_deref() == Some("personal"))
        .or_else(|| envelope.items.first())
        .ok_or_else(|| Unavailable::Failed("no plan items in the answer".into()))?;
    if item.subscribed == Some(false) {
        return Err(Unavailable::Failed("no active subscription".into()));
    }
    let meter = |label: &str| -> Option<Meter> {
        item.periods.iter().find(|p| p.label == label).map(|p| {
            let (used, percent) = p.figures();
            let status = if percent >= 100.0 { "exceeded" } else { "ok" };
            Meter::from_parts(status, percent, used, p.total, p.reset_at.as_deref(), None)
        })
    };
    let missing = |label: &str| Unavailable::Failed(format!("the answer has no {label} window"));
    Ok(Usage {
        five_hour: meter("5h").ok_or_else(|| missing("5h"))?,
        daily: meter("daily"),
        weekly: meter("weekly").ok_or_else(|| missing("weekly"))?,
        monthly: meter("monthly").ok_or_else(|| missing("monthly"))?,
        tier: item.tier.clone(),
        profile: profile.into(),
    })
}

/// Run `arkcli` with a hard timeout, returning stdout. Unix-only process kill is
/// fine here: this crate already requires a Unix terminal for its watch mode.
fn run_cli(args: &[&str]) -> Result<String, Unavailable> {
    let mut child = Command::new("arkcli")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Unavailable::CliMissing
            } else {
                Unavailable::Failed(e.to_string())
            }
        })?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = child
                    .wait_with_output()
                    .map_err(|e| Unavailable::Failed(format!("read stdout: {e}")))?;
                if !status.success() {
                    let err = String::from_utf8_lossy(&out.stderr);
                    return Err(Unavailable::Failed(cli_error(&err)));
                }
                return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
            }
            Ok(None) => {
                if started.elapsed() > Duration::from_secs(CLI_TIMEOUT_SECS) {
                    let _ = child.kill();
                    return Err(Unavailable::Failed(format!(
                        "timed out after {CLI_TIMEOUT_SECS}s"
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(Unavailable::Failed(e.to_string())),
        }
    }
}

/// `arkcli` reports failures as a JSON envelope on stderr
/// (`{"ok":false,"error":{"message":…}}`), so the first line is just `{`. Take
/// the message when there is one, else the last non-empty line — the actionable
/// sentence, not the brace.
fn cli_error(stderr: &str) -> String {
    #[derive(Deserialize)]
    struct Envelope {
        error: Option<Inner>,
    }
    #[derive(Deserialize)]
    struct Inner {
        message: Option<String>,
    }
    if let Ok(env) = serde_json::from_str::<Envelope>(stderr.trim()) {
        if let Some(text) = env.error.and_then(|e| e.message) {
            if !text.trim().is_empty() {
                return text.trim().to_string();
            }
        }
    }
    stderr
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("failed")
        .to_string()
}

/// Parse an ISO-8601 instant with a numeric offset (`2026-10-20T00:24:37+08:00`)
/// into epoch ms plus the offset in seconds east of UTC.
pub fn parse_instant(value: &str) -> Option<(i64, i64)> {
    let (date, rest) = value.split_once('T')?;
    let (time, offset) = match rest.find(['+', '-']) {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest.trim_end_matches('Z'), "+00:00"),
    };
    let mut dp = date.split('-');
    let y: i64 = dp.next()?.parse().ok()?;
    let m: i64 = dp.next()?.parse().ok()?;
    let d: i64 = dp.next()?.parse().ok()?;
    let time = time.trim_end_matches('Z');
    let mut tp = time.split(':');
    let hh: i64 = tp.next().unwrap_or("0").parse().unwrap_or(0);
    let mm: i64 = tp.next().unwrap_or("0").parse().unwrap_or(0);
    let ss: i64 = tp
        .next()
        .unwrap_or("0")
        .split('.')
        .next()?
        .parse()
        .unwrap_or(0);
    let (sign, off) = match offset.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, offset.trim_start_matches('+')),
    };
    let mut op = off.split(':');
    let oh: i64 = op.next().unwrap_or("0").parse().unwrap_or(0);
    let om: i64 = op.next().unwrap_or("0").parse().unwrap_or(0);
    let offset_secs = sign * (oh * 3600 + om * 60);
    let local_secs = days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss;
    Some(((local_secs - offset_secs) * 1000, offset_secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_servers_offset_instant() {
        let (ms, off) = parse_instant("2026-10-20T00:24:37+08:00").unwrap();
        assert_eq!(off, 8 * 3600);
        assert_eq!(
            ms,
            (days_from_civil(2026, 10, 19) * 86_400 + 16 * 3600 + 24 * 60 + 37) * 1000
        );
        let (ms, off) = parse_instant("2026-10-20T00:24:37Z").unwrap();
        assert_eq!(off, 0);
        assert_eq!(
            ms,
            (days_from_civil(2026, 10, 20) * 86_400 + 24 * 60 + 37) * 1000
        );
    }

    #[test]
    fn reads_the_four_windows_and_the_tier() {
        let raw = r#"{"items":[{"edition":"personal","tier":"medium","subscribed":true,
            "periods":[
              {"label":"5h","used":2975.67,"total":10000,"percent":29.75,"reset_at":"2026-10-20T00:24:37+08:00"},
              {"label":"daily","used":100.0,"total":50000,"percent":0.2,"reset_at":"2026-10-20T00:00:00+08:00"},
              {"label":"weekly","used":2975.67,"total":35000,"percent":8.5,"reset_at":"2026-10-26T00:00:00+08:00"},
              {"label":"monthly","used":2975.67,"total":100000,"percent":2.98,"reset_at":"2026-11-19T23:59:59+08:00"}]}]}"#;
        let usage = parse_usage(raw, "agent-plan_cn-beijing_medium").unwrap();
        assert_eq!(usage.tier.as_deref(), Some("medium"));
        assert_eq!(usage.five_hour.quota, 10_000.0);
        assert!(usage.daily.is_some());
        assert!(usage.five_hour.reset_ms().is_some());
    }

    #[test]
    fn a_text_only_plan_has_no_daily_window() {
        let raw = r#"{"items":[{"edition":"personal","tier":"small","subscribed":true,
            "periods":[
              {"label":"5h","used":1,"total":2000,"percent":0.05,"reset_at":"2026-10-20T00:24:37+08:00"},
              {"label":"weekly","used":1,"total":7000,"percent":0.01,"reset_at":"2026-10-26T00:00:00+08:00"},
              {"label":"monthly","used":1,"total":20000,"percent":0.005,"reset_at":"2026-11-19T23:59:59+08:00"}]}]}"#;
        let usage = parse_usage(raw, "p").unwrap();
        assert!(usage.daily.is_none());
    }

    #[test]
    fn a_window_without_figures_is_derived_not_rejected() {
        // Measured 2026-10-20: the just-reset 5-hour block came back as
        // `{"label":"5h","total":10000,"percent":0}` — no `used`, no `reset_at`.
        // Requiring `used` made the whole answer a parse error, which silently
        // dropped the dashboard to the local estimate.
        let raw = r#"{"items":[{"edition":"personal","tier":"medium","subscribed":true,
            "periods":[
              {"label":"5h","total":10000,"percent":0},
              {"label":"weekly","used":2975.67,"total":35000,"percent":8.5,"reset_at":"2026-10-26T00:00:00+08:00"},
              {"label":"monthly","used":2975.67,"total":100000,"percent":2.98,"reset_at":"2026-11-19T23:59:59+08:00"}]}]}"#;
        let usage = parse_usage(raw, "p").expect("a figureless window is still an answer");
        assert_eq!(usage.five_hour.used, 0.0);
        assert_eq!(usage.five_hour.quota, 10_000.0);
        assert_eq!(usage.five_hour.percent, 0.0);
        assert!(usage.five_hour.reset_ms().is_none());
    }

    #[test]
    fn a_missing_percentage_is_computed_from_used_and_total() {
        let raw = r#"{"items":[{"edition":"personal","tier":"medium","subscribed":true,
            "periods":[
              {"label":"5h","used":2500,"total":10000},
              {"label":"weekly","used":1,"total":35000},
              {"label":"monthly","used":1,"total":100000}]}]}"#;
        let usage = parse_usage(raw, "p").unwrap();
        assert_eq!(usage.five_hour.percent, 25.0);
        assert_eq!(usage.five_hour.used, 2_500.0);
    }

    #[test]
    fn an_unsubscribed_item_is_an_error() {
        let raw =
            r#"{"items":[{"edition":"personal","tier":"medium","subscribed":false,"periods":[]}]}"#;
        assert!(matches!(parse_usage(raw, "p"), Err(Unavailable::Failed(_))));
    }
}
