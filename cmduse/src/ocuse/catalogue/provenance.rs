// Where the catalogue in use came from — never an aside.
//
// The defect this module exists for was silent: a baked file that had not moved
// in a month printed limits as if they were current, and nothing on screen said
// otherwise. So the source travels with the numbers, in text for a person and in
// JSON for a consumer, and a fallback carries its reason.
use super::cache::{age_label, stamp};
use crate::ocuse::zen::Catalog;

/// Which catalogue produced the numbers on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Fetched from the endpoint this run.
    Live,
    /// Read from the disk cache, inside its TTL.
    Cache,
    /// The baked `core/zen.json` — the last resort, and the whole of `--no-catalog`.
    Builtin,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Live => "live",
            Source::Cache => "cache",
            Source::Builtin => "builtin",
        }
    }
}

/// Where the catalogue came from, in the shape every output needs.
#[derive(Debug, Clone)]
pub struct Provenance {
    pub source: Source,
    /// Fetch time (`live`), write time (`cache`) or the seed's own `extractedAt`
    /// (`builtin`), epoch ms. `None` when the seed's stamp will not parse.
    pub at: Option<i64>,
    /// How old a cached copy is; 0 for live and builtin.
    pub age_secs: u64,
    /// Why the live fetch did not produce the answer, when it did not.
    pub error: Option<String>,
}

impl Provenance {
    /// "live", "cache, 3h old", "builtin".
    pub fn label(&self) -> String {
        match self.source {
            Source::Live => "live".into(),
            Source::Cache => format!("cache, {} old", age_label(self.age_secs)),
            Source::Builtin => "builtin".into(),
        }
    }

    /// The one line the dashboard prints, including the failure that caused a
    /// fallback — the difference between "an hour stale" and "a month stale".
    pub fn describe(&self) -> String {
        let when = self.at.map(stamp).unwrap_or_else(|| "unknown".into());
        let mut line = match self.source {
            Source::Live => format!("live · fetched {when}"),
            Source::Cache => format!("cache · written {when}, {} old", age_label(self.age_secs)),
            Source::Builtin => format!("builtin · generated {when}"),
        };
        if let Some(why) = &self.error {
            line.push_str(&format!(" · {why}"));
        }
        line
    }

    /// The machine shape: `{source, at, ageSecs, error}`.
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "source": self.source.label(),
            "at": self.at,
            "ageSecs": self.age_secs,
            "error": self.error,
        })
    }

    /// The seed's provenance; `why` names a failed fetch when there was one.
    pub fn builtin(catalog: &Catalog, why: Option<String>) -> Self {
        Provenance {
            source: Source::Builtin,
            at: cmduse_core::dates::parse_iso_utc(&catalog.extracted_at).map(|ms| ms as i64),
            age_secs: 0,
            error: why,
        }
    }
}
