// The fetched catalogue on disk, so a 5s watch loop does not refetch.
//
// Two rules are load-bearing. **A result is written only when it carries
// limits**: one empty write once poisoned mpc's cache for a week, so a payload
// with no plan allowances never reaches disk, and a file that no longer parses
// or carries no limits is treated as a miss rather than trusted. And **the write
// is atomic** (temp file in the same directory, then rename), so a reader never
// sees half a catalogue.
//
// Freshness is the file's mtime against the caller's clock, which is what makes
// the TTL honest across processes: the 6h default is measured from the write,
// not from when this process started.
use super::{Loaded, Options, Provenance, Source};
use crate::ocuse::zen::Catalog;
use std::path::{Path, PathBuf};

/// The cache directory: `--cache-dir` override, else `$CMDUSE_CACHE_DIR`,
/// else `~/.cache/cmduse`. Shared with the cap-history file so the two live
/// together and one `CMDUSE_CACHE_DIR` moves both.
pub(super) fn cache_dir(opts: &Options) -> PathBuf {
    opts.cache_dir
        .clone()
        .or_else(|| std::env::var_os("CMDUSE_CACHE_DIR").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from(cache_root()))
}

/// `<cache dir>/ocuse-catalogue.json`.
pub fn cache_path(opts: &Options) -> PathBuf {
    cache_dir(opts).join("ocuse-catalogue.json")
}

/// `$CMDUSE_CACHE_DIR`, else `~/.cache/cmduse` — the shared cmduse cache root.
fn cache_root() -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() => format!("{home}/.cache/cmduse"),
        _ => ".cache/cmduse".into(),
    }
}

/// A cache hit inside `ttl_secs`; `None` when absent, older, or unusable.
pub(super) fn read(path: &Path, ttl_secs: u64, now_ms: i64) -> Option<Loaded> {
    let written = std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    let age_ms = now_ms.saturating_sub(written).max(0);
    if age_ms > (ttl_secs as i64) * 1000 {
        return None;
    }
    let catalog: Catalog = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    if !has_limits(&catalog) {
        return None;
    }
    Some(Loaded {
        provenance: Provenance {
            source: Source::Cache,
            at: Some(written),
            age_secs: (age_ms / 1000) as u64,
            error: None,
        },
        catalog,
    })
}

/// Write the cache — never an empty result, never a partial file.
pub(super) fn write(path: &Path, catalog: &Catalog) {
    if !has_limits(catalog) {
        return;
    }
    let Ok(text) = serde_json::to_string(catalog) else {
        return;
    };
    let Some(dir) = path.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    // Same directory, so the rename is atomic.
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, text).is_ok() {
        let _ = std::fs::rename(&temp, path);
    }
}

/// At least one priced model *and* one plan's per-model limits — the bar a live
/// result must clear before it may reach the cache.
pub fn has_limits(catalog: &Catalog) -> bool {
    !catalog.go.models.is_empty()
        && catalog
            .go
            .plans
            .values()
            .any(|plan| !plan.allowance_by_model.is_empty())
}

/// "3h", "12m", "2d" — the cache age, in the unit that reads best.
pub(super) fn age_label(secs: u64) -> String {
    match secs {
        0..=59 => format!("{secs}s"),
        60..=3599 => format!("{}m", secs / 60),
        3600..=86_399 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86_400),
    }
}

/// "YYYY-MM-DDTHH:MMZ" — minute precision is enough to judge freshness.
pub(super) fn stamp(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let iso = cmduse_core::dates::iso_instant(secs.max(0) as u64);
    // iso_instant is "YYYY-MM-DDTHH:MM:SS.000Z"; drop seconds and millis.
    iso.get(..16).map(|head| format!("{head}Z")).unwrap_or(iso)
}
