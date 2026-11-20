// The live half of the OpenDesign catalogue: token rates fetched from Open
// Design's own public price list, with the baked `core/od.json` as the offline
// seed.
//
// Why this exists: the baked table is frozen at whatever the last release
// shipped, so a rate the publisher changes makes every dollar and credit figure
// `oduse` prints wrong until someone notices and cuts a release. The price list
// is public and needs no credential:
//
//   GET https://amr-api.open-design.ai/api/v1/public/model-prices
//   200, body `{"data":[{"model":"<wire id>","pricing":{...}}]}`, no header.
//
// One parse path serves both answers: the payload (fetched or cached) becomes
// the same row shape the baked file carries and is merged over it. The merge is
// deliberately field-by-field, because the two sources cover different halves:
//
//   * token rates, cache rates and long-context tiers come from the price list;
//   * plan caps, model labels, `catalogId` and the credit multiplier come from
//     `core/od.json` — the price list publishes none of them, so none is
//     invented for a row the baked table does not carry (such a row is counted
//     as `unlisted` and named in the provenance instead).
//
// Failure is soft and loud in the same breath: no answer means the baked seed,
// marked `builtin` with the reason, so a stale table never renders as `live`.
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Deserialize;

use crate::oduse::od::{Catalog, LongContext, Origin, Provenance};

/// The published price list. Public: no key, no cookie, no account.
pub const PRICE_URL: &str = "https://amr-api.open-design.ai/api/v1/public/model-prices";
/// One remote call, bounded. A dashboard that waits longer is worse than one
/// that says `builtin` and moves on.
pub const TIMEOUT_SECS: u64 = 8;
/// How long a cached payload stays usable. Rates move on a plan change, not on
/// a minute, so six hours keeps a five-second watch loop off the network while
/// still picking a change up the same day.
pub const TTL_SECS: i64 = 6 * 3600;
/// One file, one shape: the fetched body verbatim. The file's mtime is its age.
pub const CACHE_FILE: &str = "od-model-prices.json";

/// `--no-catalog` and `--cache <dur>`: what the run is allowed to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    /// Bypass the live list and the cache; answer from the baked seed.
    pub no_catalog: bool,
    /// Cache TTL in seconds; `0` disables reading and writing it.
    pub cache_secs: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            no_catalog: false,
            cache_secs: TTL_SECS,
        }
    }
}

/// The cache directory: `$CMDUSE_CACHE_DIR`, else `~/.cache/cmduse`.
pub fn cache_dir() -> PathBuf {
    match std::env::var("CMDUSE_CACHE_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => crate::paths::home().join(".cache").join("cmduse"),
    }
}

/// Public entry point: resolve the table for this run.
pub fn resolve(settings: Settings, now_secs: i64) -> Catalog {
    resolve_with(settings, now_secs, &cache_dir(), fetch_live)
}

/// The same resolution with the cache directory and the transport injected, so
/// every branch — live, cache, expiry, failure, empty answer — is testable
/// without a network or the user's home directory.
pub fn resolve_with(
    settings: Settings,
    now_secs: i64,
    dir: &Path,
    mut fetch: impl FnMut(&str) -> Result<String, String>,
) -> Catalog {
    let mut seed = crate::oduse::od::baked();
    if settings.no_catalog {
        seed.provenance.error = Some("--no-catalog".into());
        return seed;
    }

    if settings.cache_secs > 0 {
        if let Some((body, age)) = read_cache(dir, now_secs, settings.cache_secs) {
            if let Ok(merged) = merge(seed.clone(), &body) {
                return stamped(merged, Origin::Cache, Some(now_secs - age), Some(age), None);
            }
        }
    }

    match fetch(PRICE_URL) {
        Ok(body) => match merge(seed.clone(), &body) {
            Ok(merged) => {
                // Only a parsed, non-empty answer is persisted: an empty body
                // written to the cache would answer every run inside the TTL.
                if settings.cache_secs > 0 {
                    write_cache(dir, &body);
                }
                stamped(merged, Origin::Live, Some(now_secs), None, None)
            }
            Err(why) => {
                seed.provenance.error = Some(why);
                seed
            }
        },
        Err(why) => {
            seed.provenance.error = Some(why);
            seed
        }
    }
}

/// One merged catalog with its provenance stamped on.
fn stamped(
    merged: Merged,
    origin: Origin,
    at: Option<i64>,
    age_secs: Option<i64>,
    error: Option<String>,
) -> Catalog {
    let mut catalog = merged.catalog;
    catalog.provenance = Provenance {
        origin,
        at,
        age_secs,
        models: catalog.models.iter().filter(|m| m.live_rates).count(),
        unlisted: merged.unlisted,
        error,
    };
    catalog
}

/// The live payload and the baked table, merged along the field split the
/// module comment describes.
pub struct Merged {
    pub catalog: Catalog,
    /// Live rows with no baked row, therefore no published multiplier: counted,
    /// never listed at an invented 1x.
    pub unlisted: usize,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(default)]
    data: Vec<Row>,
}

#[derive(Debug, Deserialize)]
struct Row {
    model: String,
    #[serde(default)]
    pricing: Option<Pricing>,
}

/// Rates as the list publishes them. Every rate is optional so one malformed row
/// is skipped rather than throwing away the other forty-five.
#[derive(Debug, Deserialize)]
struct Pricing {
    #[serde(default)]
    input: Option<f64>,
    #[serde(default)]
    output: Option<f64>,
    #[serde(default, rename = "cacheRead")]
    cache_read: Option<f64>,
    #[serde(default, rename = "cacheWrite")]
    cache_write: Option<f64>,
    #[serde(default, rename = "longContext")]
    long_context: Option<LongContext>,
}

impl Pricing {
    /// A usable row needs the two flat rates; a rate that is not a finite,
    /// non-negative number is no rate at all.
    fn usable(&self) -> Option<(f64, f64)> {
        let input = self.input.filter(|v| v.is_finite() && *v >= 0.0)?;
        let output = self.output.filter(|v| v.is_finite() && *v >= 0.0)?;
        Some((input, output))
    }
}

/// Parse the payload and merge its rates over the baked table. `Err` when the
/// body yields no usable row — that is a failed answer, never a table of zeros,
/// and the caller falls back to the seed.
pub fn merge(mut seed: Catalog, body: &str) -> Result<Merged, String> {
    let envelope: Envelope =
        serde_json::from_str(body).map_err(|e| format!("price list unparseable ({e})"))?;
    let mut live: std::collections::HashMap<String, Pricing> = std::collections::HashMap::new();
    for row in envelope.data {
        if let Some(pricing) = row.pricing {
            live.insert(row.model, pricing);
        }
    }
    if live.values().filter(|p| p.usable().is_some()).count() == 0 {
        return Err("price list carried no usable row".into());
    }

    let mut listed = 0usize;
    for model in &mut seed.models {
        let Some(pricing) = live.get(&model.id) else {
            continue;
        };
        let Some((input, output)) = pricing.usable() else {
            continue;
        };
        model.input = input;
        model.output = output;
        model.cache_read = pricing.cache_read;
        model.cache_write = pricing.cache_write;
        model.long_context = pricing.long_context.clone();
        model.rate_source = Some("published".into());
        model.live_rates = true;
        listed += 1;
    }
    // Rows the list carries and the baked table does not: no label, no
    // multiplier, so no row. Named in the provenance instead of guessed at.
    let unlisted = listable(&live).saturating_sub(listed);
    Ok(Merged {
        catalog: seed,
        unlisted,
    })
}

/// Live rows that are priced (a row with no usable rate cannot be listed either).
fn listable(live: &std::collections::HashMap<String, Pricing>) -> usize {
    live.values().filter(|p| p.usable().is_some()).count()
}

/// Read the cache when it is younger than `ttl`; returns the body and its age.
fn read_cache(dir: &Path, now_secs: i64, ttl: i64) -> Option<(String, i64)> {
    let path = dir.join(CACHE_FILE);
    let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
    let written = modified.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    // A clock that moved backwards reads as fresh rather than negative.
    let age = (now_secs - written).max(0);
    if age > ttl {
        return None;
    }
    let body = std::fs::read_to_string(&path).ok()?;
    Some((body, age))
}

/// Persist the body. Written beside the target and renamed, so a torn write
/// cannot leave a half payload that parses to nothing. A failure here is
/// silent: the cache is an optimisation, not the source.
fn write_cache(dir: &Path, body: &str) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = dir.join(CACHE_FILE);
    let tmp = dir.join(format!("{CACHE_FILE}.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, body).is_err() {
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// The live call: bounded, one retry on a transport error or a 5xx, none on a
/// 4xx (a refusal will be a refusal), and a user agent so the publisher's logs
/// can tell this client from a browser.
fn fetch_live(url: &str) -> Result<String, String> {
    let agent = format!("oduse/{}", env!("CARGO_PKG_VERSION"));
    let timeout = Duration::from_secs(TIMEOUT_SECS);
    let mut last = String::from("no attempt made");
    for attempt in 0..2 {
        match ureq::get(url)
            .set("User-Agent", &agent)
            .timeout(timeout)
            .call()
        {
            Ok(response) => match response.into_string() {
                Ok(body) => return Ok(body),
                Err(e) => last = format!("read: {e}"),
            },
            // A 4xx is final; a 5xx gets the one retry the transport error does.
            Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) => {
                return Err(format!("HTTP {code}"));
            }
            Err(ureq::Error::Status(code, _)) => last = format!("HTTP {code}"),
            Err(e) => last = format!("transport: {}", short_error(&e)),
        }
        if attempt == 1 {
            break;
        }
    }
    Err(last)
}

/// `ureq`'s message carries the request line and so the URL; report only the
/// cause, which is what a dashboard line can show.
fn short_error(error: &ureq::Error) -> String {
    let text = error.to_string();
    text.rsplit(": ").next().unwrap_or(&text).to_string()
}

/// A rounded span for a cache age, one unit: `3h`, `2d`, `5m`. Deliberately not
/// `cmduse_core::duration`, whose two-part `3h 0m` reads like noise for an age.
pub fn short_age(secs: i64) -> String {
    let secs = secs.max(0);
    let days = secs / 86_400;
    if days > 0 {
        format!("{days}d")
    } else if secs >= 3600 {
        format!("{}h", secs / 3600)
    } else {
        format!("{}m", secs / 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: &str = r#"{"data":[
        {"model":"deepseek-v4.1-flash","pricing":{"unit":"1m_tokens","currency":"USD",
         "input":9.5,"output":19.5,"cacheRead":0.25,"cacheWrite":1.5,
         "longContext":{"inputTokensAbove":100000,"input":19,"output":39,"cacheRead":0.5}}},
        {"model":"claude-haiku-5.5","pricing":{"input":0.2,"output":0.9,"cacheRead":0.02}}
    ]}"#;

    fn seed() -> Catalog {
        crate::oduse::od::baked()
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("oduse-catalogue-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn live_rates_override_the_seed_and_the_seed_keeps_the_multiplier() {
        let baked = seed();
        let before = baked.model("deepseek-v4.1-flash").unwrap().multiplier;
        let merged = merge(baked, LIVE).unwrap();
        let row = merged.catalog.model("deepseek-v4.1-flash").unwrap();
        assert_eq!(row.input, 9.5);
        assert_eq!(row.output, 19.5);
        assert_eq!(row.cache_read, Some(0.25));
        assert_eq!(row.cache_write, Some(1.5));
        // 1M input above the published threshold reprices the whole turn.
        let tier = row.long_context.as_ref().unwrap();
        assert_eq!(tier.input_tokens_above, 100_000);
        assert_eq!(tier.input, 19.0);
        // The price list publishes no multiplier: it is the baked row's, untouched.
        assert_eq!(row.multiplier, before);
        assert!(row.live_rates);
        // A model the payload does not carry keeps the seed's rates and label.
        let untouched = merged.catalog.model("claude-opus-5").unwrap();
        assert!(!untouched.live_rates);
        assert_eq!(untouched.rate_source.as_deref(), Some("published"));
        assert_eq!(merged.unlisted, 0);
    }

    #[test]
    fn a_live_row_with_no_baked_multiplier_is_counted_never_listed() {
        let body = r#"{"data":[
            {"model":"deepseek-v4.1-flash","pricing":{"input":1,"output":2}},
            {"model":"brand-new-model","pricing":{"input":3,"output":4}}
        ]}"#;
        let baked = seed();
        let count = baked.models.len();
        let merged = merge(baked, body).unwrap();
        assert_eq!(merged.catalog.models.len(), count);
        assert!(merged.catalog.model("brand-new-model").is_none());
        assert_eq!(merged.unlisted, 1);
    }

    #[test]
    fn an_empty_or_unparseable_payload_is_a_failed_answer() {
        assert!(merge(seed(), r#"{"data":[]}"#).is_err());
        assert!(merge(seed(), "not json").is_err());
        assert!(merge(seed(), r#"{"data":[{"model":"x"}]}"#).is_err());
    }

    #[test]
    fn a_failed_fetch_falls_back_to_the_seed_labelled_builtin() {
        let dir = temp_dir("fallback");
        let resolved = resolve_with(Settings::default(), 1_000, &dir, |_| {
            Err("HTTP 500".to_string())
        });
        let baked = seed();
        assert_eq!(resolved.provenance.origin, Origin::Builtin);
        assert_eq!(resolved.provenance.kind(), "builtin");
        assert_eq!(resolved.provenance.error.as_deref(), Some("HTTP 500"));
        // The seed carries only its build date, so there is no fetch instant.
        assert_eq!(resolved.provenance.at, None);
        let row = resolved.model("deepseek-v4.1-flash").unwrap();
        assert_eq!(row.input, baked.model("deepseek-v4.1-flash").unwrap().input);
        assert!(!row.live_rates);
    }

    #[test]
    fn only_a_parsed_answer_is_persisted() {
        let dir = temp_dir("nocache");
        // Empty payload: fails, so nothing is written — an empty cache file
        // would answer every run inside the TTL with nothing.
        let resolved = resolve_with(Settings::default(), 1_000, &dir, |_| {
            Ok(r#"{"data":[]}"#.to_string())
        });
        assert_eq!(resolved.provenance.origin, Origin::Builtin);
        assert!(!dir.join(CACHE_FILE).exists());
        // A good one is written, and the next run reads it as `cache`.
        let live = resolve_with(Settings::default(), 2_000, &dir, |_| Ok(LIVE.to_string()));
        assert_eq!(live.provenance.origin, Origin::Live);
        assert_eq!(live.provenance.at, Some(2_000));
        assert!(dir.join(CACHE_FILE).exists());
    }

    #[test]
    fn the_cache_is_read_with_its_age_and_expires() {
        let dir = temp_dir("aged");
        let live = resolve_with(Settings::default(), 0, &dir, |_| Ok(LIVE.to_string()));
        assert_eq!(live.provenance.origin, Origin::Live);
        // The age is the file's mtime against the run's clock, so a cache hit is
        // tested by moving the clock the same way a later run would.
        let written = written_secs(&dir);
        let fresh = resolve_with(Settings::default(), written, &dir, |_| {
            panic!("a fresh cache must not fetch")
        });
        assert_eq!(fresh.provenance.origin, Origin::Cache);
        assert_eq!(fresh.provenance.age_secs, Some(0));
        // `at` is when the payload was written, not when this run read it.
        assert_eq!(fresh.provenance.at, Some(written));
        assert_eq!(fresh.provenance.label(), "cache, 0m old");
        assert!(fresh.model("deepseek-v4.1-flash").unwrap().live_rates);
        // Three hours in, the label names the age rather than looking fresh.
        let later = resolve_with(Settings::default(), written + 3 * 3600, &dir, |_| {
            panic!("a cache inside the TTL must not fetch")
        });
        assert_eq!(later.provenance.kind(), "cache");
        assert_eq!(later.provenance.label(), "cache, 3h old");
    }

    #[test]
    fn an_expired_cache_is_not_used() {
        let dir = temp_dir("expired");
        resolve_with(Settings::default(), 0, &dir, |_| Ok(LIVE.to_string()));
        // Six hours + a second past its mtime: the transport is asked again.
        let later = written_secs(&dir) + TTL_SECS + 1;
        let mut asked = false;
        let resolved = resolve_with(Settings::default(), later, &dir, |_| {
            asked = true;
            Ok(LIVE.to_string())
        });
        assert!(asked);
        assert_eq!(resolved.provenance.origin, Origin::Live);
    }

    #[test]
    fn the_cache_can_be_disabled_and_the_live_list_bypassed() {
        let dir = temp_dir("off");
        resolve_with(Settings::default(), 0, &dir, |_| Ok(LIVE.to_string()));
        assert!(dir.join(CACHE_FILE).exists());
        // `--cache 0` neither reads nor writes it.
        let off = Settings {
            no_catalog: false,
            cache_secs: 0,
        };
        let fetched = resolve_with(off, 0, &dir, |_| Ok(LIVE.to_string()));
        assert_eq!(fetched.provenance.origin, Origin::Live);
        // `--no-catalog` answers from the seed with its reason.
        let baked = Settings {
            no_catalog: true,
            cache_secs: 0,
        };
        let resolved = resolve_with(baked, 0, &dir, |_| panic!("must not fetch"));
        assert_eq!(resolved.provenance.origin, Origin::Builtin);
        assert_eq!(resolved.provenance.error.as_deref(), Some("--no-catalog"));
    }

    /// The cache file's mtime in epoch seconds — the clock the age is measured
    /// against.
    fn written_secs(dir: &Path) -> i64 {
        std::fs::metadata(dir.join(CACHE_FILE))
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    #[test]
    fn ages_read_as_one_unit() {
        assert_eq!(short_age(0), "0m");
        assert_eq!(short_age(59), "0m");
        assert_eq!(short_age(300), "5m");
        assert_eq!(short_age(3 * 3600), "3h");
        assert_eq!(short_age(2 * 86_400), "2d");
        assert_eq!(short_age(-5), "0m");
    }
}
