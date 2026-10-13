use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::cli::Binary;

#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct Config {
    pub interval_secs: u64,
    pub bar_width: usize,
    pub burst_enabled: bool,
    pub burst_samples: usize,
    pub notify_on_cap: bool,
    pub statusline_template: String,
    pub statusline_colors: bool,
    pub statusline_ascii: bool,
    pub check_updates: bool,
    /// Version whose update notice the user dismissed (resumes on the next one).
    pub dismissed_update: Option<String>,
}

/// cmduse's defaults — unchanged; `Config::default()` is kept for that binary.
impl Default for Config {
    fn default() -> Self {
        Config {
            interval_secs: 5,
            bar_width: 20,
            burst_enabled: true,
            burst_samples: 40,
            notify_on_cap: true,
            statusline_template: "{plan} {credits}/{cap} \u{b7} 5h {5h_bar} \u{b7} wk {wk_bar}"
                .into(),
            statusline_colors: true,
            statusline_ascii: false,
            check_updates: true,
            dismissed_update: None,
        }
    }
}

/// ocuse's statusline default: its `Report` has spend/window totals, not
/// cmduse's `{plan} {credits}/{cap}` credit pool.
const OCUSE_STATUSLINE: &str = "{period} {month} \u{b7} 5h {five_hour} \u{b7} wk {weekly}";

/// The defaults for a given binary. Identical to cmduse's except the refresh
/// interval (ocuse's live frame has always redrawn every 10s) and the statusline
/// template, which follows what that binary's report actually carries.
pub fn default_for(binary: Binary) -> Config {
    match binary {
        Binary::Cmduse => Config::default(),
        Binary::Ocuse => Config {
            interval_secs: 10,
            statusline_template: OCUSE_STATUSLINE.into(),
            ..Config::default()
        },
    }
}

/// Config file for a binary: `~/.config/<bin>/config.json`, honouring
/// `XDG_CONFIG_HOME` exactly as before. `cmduse` keeps `cmd-usage` (its crate
/// name, not its binary name); `ocuse` uses its own directory.
pub fn config_path(binary: Binary) -> PathBuf {
    let rel = match binary {
        Binary::Cmduse => "cmd-usage/config.json",
        Binary::Ocuse => "ocuse/config.json",
    };
    std::env::var("XDG_CONFIG_HOME")
        .map(|d| PathBuf::from(d).join(rel))
        .unwrap_or_else(|_| crate::paths::home().join(".config").join(rel))
}

pub fn load(binary: Binary) -> Config {
    let path = config_path(binary);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("warn: bad config {}: {e}; using defaults", path.display());
            default_for(binary)
        }),
        Err(_) => default_for(binary),
    }
}

/// Persist any subset of settings; missing keys keep current values.
pub fn set(binary: Binary, cs: &crate::cli::ConfigSet) -> Result<(), String> {
    if [
        cs.interval.is_some(),
        cs.width.is_some(),
        cs.sl_template.is_some(),
        cs.sl_colors.is_some(),
        cs.sl_ascii.is_some(),
        cs.burst_on.is_some(),
        cs.bursts.is_some(),
        cs.notify.is_some(),
        cs.update_check.is_some(),
        cs.dismissed_update.is_some(),
    ]
    .iter()
    .all(|set| !set)
    {
        return Err("nothing to set".into());
    }
    if let Some(v) = cs.interval {
        if v == 0 || v > 86_400 {
            return Err("interval must be 1–86400 seconds".into());
        }
    }
    if let Some(v) = cs.width {
        if !(5..=200).contains(&v) {
            return Err("bar width must be 5–200".into());
        }
    }
    if let Some(v) = cs.bursts {
        if !(5..=240).contains(&v) {
            return Err("burst samples must be 5–240".into());
        }
    }

    let cur = load(binary);
    let cfg = Config {
        interval_secs: cs.interval.unwrap_or(cur.interval_secs),
        bar_width: cs.width.unwrap_or(cur.bar_width),
        burst_enabled: cs.burst_on.unwrap_or(cur.burst_enabled),
        burst_samples: cs.bursts.unwrap_or(cur.burst_samples),
        notify_on_cap: cs.notify.unwrap_or(cur.notify_on_cap),
        statusline_template: cs.sl_template.clone().unwrap_or(cur.statusline_template),
        statusline_colors: cs.sl_colors.unwrap_or(cur.statusline_colors),
        statusline_ascii: cs.sl_ascii.unwrap_or(cur.statusline_ascii),
        check_updates: cs.update_check.unwrap_or(cur.check_updates),
        dismissed_update: cs.dismissed_update.clone().or(cur.dismissed_update),
    };
    save(binary, &cfg)?;
    println!("saved {}", config_path(binary).display());
    println!("  interval_secs       = {}", cfg.interval_secs);
    println!("  bar_width           = {}", cfg.bar_width);
    println!("  burst_enabled       = {}", cfg.burst_enabled);
    println!("  burst_samples       = {}", cfg.burst_samples);
    println!("  notify_on_cap       = {}", cfg.notify_on_cap);
    println!("  statusline_template = {}", cfg.statusline_template);
    println!("  statusline_colors   = {}", cfg.statusline_colors);
    println!("  statusline_ascii    = {}", cfg.statusline_ascii);
    println!("  check_updates       = {}", cfg.check_updates);
    println!(
        "  dismissed_update    = {}",
        cfg.dismissed_update.as_deref().unwrap_or("(none)")
    );
    Ok(())
}

/// Persist `cfg` to disk (pretty JSON + trailing newline).
fn save(binary: Binary, cfg: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let path = config_path(binary);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, json + "\n").map_err(|e| e.to_string())?;
    Ok(())
}

/// Record `version` as dismissed (used by `--dismiss-update`).
pub fn set_dismissed(binary: Binary, version: &str) -> Result<(), String> {
    let mut cfg = load(binary);
    cfg.dismissed_update = Some(version.to_string());
    save(binary, &cfg)
}
