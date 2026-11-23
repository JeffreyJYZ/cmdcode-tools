// The Go catalogue: fetched live, seeded from the baked file.
//
// `core/zen.json` is compiled into every binary (`cmduse_core::ZEN_JSON`), so its
// per-model limits and rates only moved when a release shipped — and they
// stopped moving: DeepSeek V4.1 Flash printed `$80 / 70.8%` against a live
// `$100`, GLM-5.3 printed `$15` against `$500`, eleven retired models were still
// listed and ten new ones were missing. `GET /zen/go/v1/models` answers
// anonymously (mpc already reads it every run) and carries everything the file
// has: membership, `cost.text`, the peak multiplier, and each plan's
// `go.monthly_usage`. So the endpoint leads and the baked file is the offline
// seed.
//
// What the endpoint does *not* carry stays from the seed: each plan's $/month
// price, the 5h/weekly/monthly window split (both from the docs article), and
// the Zen pay-as-you-go table (a second endpoint, `/zen/v1/models`).
//
// Provenance is part of the answer: a catalogue that fell back to the seed must
// never be indistinguishable from a fresh fetch, so every surface that shows
// numbers also shows where they came from — see [`Provenance`].
mod cache;
mod convert;
mod fetch;
mod history;
mod payload;
mod provenance;
mod rates;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_cache;

use crate::ocuse::window::{now_ms, CapChange};
use crate::ocuse::zen::{self, Catalog};
use std::path::PathBuf;
use std::sync::OnceLock;

pub use cache::{cache_path, has_limits};
pub use fetch::MODELS_URL;
pub use provenance::{Provenance, Source};

/// Default cache lifetime. Long enough to keep a 5s watch loop off the network,
/// short enough that a limit change upstream lands the same working day.
pub const DEFAULT_TTL_SECS: u64 = 6 * 3600;

/// How to resolve the catalogue this run.
#[derive(Debug, Clone)]
pub struct Options {
    /// `--no-catalog`: never fetch and never read the cache — the baked file only.
    pub no_catalog: bool,
    /// Cache TTL. `0` disables the cache in both directions.
    pub ttl_secs: u64,
    /// Cache directory; `None` = `$CMDUSE_CACHE_DIR`, else `~/.cache/cmduse`.
    pub cache_dir: Option<PathBuf>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            no_catalog: false,
            ttl_secs: DEFAULT_TTL_SECS,
            cache_dir: None,
        }
    }
}

/// A catalogue plus where it came from.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub catalog: Catalog,
    pub provenance: Provenance,
}

static LOADED: OnceLock<Loaded> = OnceLock::new();
static CAP_CHANGES: OnceLock<Vec<CapChange>> = OnceLock::new();

/// Resolve once, at startup. A second call keeps the first answer: the watch
/// loop must not refetch on every tick. The same load samples the cap history:
/// a live or cached catalogue can reveal a limit change, a baked seed never
/// can (it is stale by design), so only the former may append to the file.
pub fn init(opts: &Options) {
    let loaded = resolve(opts);
    let changes = history::record(opts, &loaded, now_ms());
    let _ = CAP_CHANGES.set(changes);
    let _ = LOADED.set(loaded);
}

/// Cap changes sampled from the catalogue on this run, oldest first. Empty
/// before [`init`] — library callers and tests get the server's percentage as
/// the only available blend, which is exactly the fresh-install case.
pub fn cap_changes() -> &'static [CapChange] {
    CAP_CHANGES.get().map(Vec::as_slice).unwrap_or(&[])
}

/// The catalogue in force. Before [`init`] — library callers and every test —
/// this is the baked seed, which is also why no test touches the network.
pub fn loaded() -> &'static Loaded {
    LOADED.get_or_init(|| {
        let catalog = zen::builtin();
        let provenance = Provenance::builtin(&catalog, None);
        Loaded {
            catalog,
            provenance,
        }
    })
}

pub fn catalog() -> &'static Catalog {
    &loaded().catalog
}

pub fn provenance() -> &'static Provenance {
    &loaded().provenance
}

/// Fetch, or fall back. Order: a cache inside its TTL, then the endpoint, then
/// the baked seed (the brief's rule — a seed refreshed by `extract-zen` is a
/// known quantity, and a stale cache is not).
pub fn resolve(opts: &Options) -> Loaded {
    resolve_with(opts, fetch::zen_go, crate::ocuse::window::now_ms())
}

/// [`resolve`] with the fetch and the clock injected, so tests are hermetic.
pub fn resolve_with(
    opts: &Options,
    fetch: impl FnOnce() -> Result<String, String>,
    now_ms: i64,
) -> Loaded {
    let seed = zen::builtin();
    if opts.no_catalog {
        return Loaded {
            provenance: Provenance::builtin(&seed, None),
            catalog: seed,
        };
    }
    let path = cache_path(opts);
    if opts.ttl_secs > 0 {
        if let Some(hit) = cache::read(&path, opts.ttl_secs, now_ms) {
            return hit;
        }
    }
    match fetch().and_then(|body| convert::convert(&body, &seed, now_ms)) {
        Ok(catalog) => {
            if opts.ttl_secs > 0 {
                cache::write(&path, &catalog);
            }
            Loaded {
                provenance: Provenance {
                    source: Source::Live,
                    at: Some(now_ms),
                    age_secs: 0,
                    error: None,
                },
                catalog,
            }
        }
        Err(why) => Loaded {
            provenance: Provenance::builtin(&seed, Some(why)),
            catalog: seed,
        },
    }
}
