// Cap history: what each plan limit was before it moved, and when.
//
// The catalogue tells us today's allowance, not yesterday's. A utilization
// percentage computed against today's cap is wrong when the cap moved inside
// the period — the spend was made against the allowance that was actually in
// force at the time. So every live catalogue load compares its limits with the
// last ones seen and appends a `{model, from, to, at}` entry on a real change.
//
// Two rules keep the file honest. **First run writes a baseline, never a
// change** — there is no "from" to compare against yet. **A baked-seed load
// writes nothing at all** — the seed is a last resort whose limits are stale
// by design, so treating its values as a fresh sample would fabricate history
// on every offline run. The file is only ever appended to; recorded changes
// are never rewritten or pruned.
use super::cache::cache_dir;
use super::{Loaded, Options, Source};
use crate::ocuse::window::CapChange;
use crate::ocuse::zen::Catalog;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct HistoryFile {
    /// The last value seen for each tracked item. Keys are `model:<id>` and
    /// `share:<fiveHour|weekly|monthly>`, so a rename cannot look like a cap
    /// change and a window-split edit is recorded beside the model caps.
    #[serde(default)]
    last: BTreeMap<String, f64>,
    #[serde(default)]
    changes: Vec<CapChange>,
}

/// `<cache dir>/ocuse-cap-history.json`.
fn history_path(opts: &Options) -> PathBuf {
    cache_dir(opts).join("ocuse-cap-history.json")
}

fn read(path: &Path) -> HistoryFile {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write(path: &Path, file: &HistoryFile) {
    let Some(dir) = path.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(file) else {
        return;
    };
    // Same directory, so the rename is atomic — a reader never sees a partial
    // history, the same rule the catalogue cache follows.
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, text).is_ok() {
        let _ = std::fs::rename(&temp, path);
    }
}

/// The values worth tracking in one catalogue: the default plan's per-model
/// limits (the plan `ocuse` measures against unless `--plan` says otherwise)
/// and the shared window split. Other plans' allowances are not sampled: a
/// cap change on a plan we never use cannot describe this account's blend.
fn current(catalog: &Catalog) -> BTreeMap<String, f64> {
    let mut out = BTreeMap::new();
    if let Some(plan) = catalog.go.plans.get(crate::ocuse::zen::DEFAULT_PLAN) {
        for (model, limit) in &plan.allowance_by_model {
            out.insert(format!("model:{model}"), *limit);
        }
    }
    let share = &catalog.go.window_share;
    for (name, value) in [
        ("fiveHour", share.five_hour),
        ("weekly", share.weekly),
        ("monthly", share.monthly),
    ] {
        out.insert(format!("share:{name}"), value);
    }
    out
}

/// Compare a catalogue load with the last recorded values and append only real
/// changes. Returns every recorded change, including the ones already on disk,
/// so the caller can reconstruct the spans of the blend. A `Builtin` load is
/// read-only: its changes are returned but the file is never touched.
pub fn record(opts: &Options, loaded: &Loaded, at_ms: i64) -> Vec<CapChange> {
    let path = history_path(opts);
    if loaded.provenance.source == Source::Builtin {
        return read(&path).changes;
    }
    let mut file = read(&path);
    let now = current(&loaded.catalog);
    if file.last.is_empty() {
        // First run: establish the baseline, but there is no "from" yet.
        file.last = now;
        write(&path, &file);
        return Vec::new();
    }
    let mut changed = false;
    for (key, value) in &now {
        if file
            .last
            .get(key)
            .is_some_and(|before| (before - value).abs() > f64::EPSILON)
        {
            let model = key.strip_prefix("model:").unwrap_or(key).to_string();
            file.changes.push(CapChange {
                model,
                from: file.last[key],
                to: *value,
                at: at_ms,
            });
            changed = true;
        }
    }
    for (key, value) in now {
        file.last.insert(key, value);
    }
    if changed {
        write(&path, &file);
    }
    file.changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocuse::catalogue::tests::{converted, opts as test_opts};
    use crate::ocuse::catalogue::{Provenance, Source};
    use crate::ocuse::zen;

    fn loaded(catalog: Catalog, source: Source) -> Loaded {
        Loaded {
            catalog,
            provenance: Provenance {
                source,
                at: Some(1_000),
                age_secs: 0,
                error: None,
            },
        }
    }

    #[test]
    fn cap_history_appends_only_on_change_and_ignores_the_baked_seed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let opts = test_opts(dir.path());
        let path = history_path(&opts);
        let live = || loaded(converted(), Source::Live);

        // First run writes the baseline but no change entries.
        assert!(record(&opts, &live(), 1_000).is_empty(), "first run");
        let text = std::fs::read_to_string(&path).expect("baseline written");
        assert!(
            text.contains("\"changes\": []"),
            "no change entries: {text}"
        );

        // An unchanged reload writes nothing — no new entry, same bytes.
        assert!(record(&opts, &live(), 2_000).is_empty(), "unchanged reload");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);

        // A changed limit appends exactly one entry, with the old and new cap.
        let mut raised = converted();
        raised
            .go
            .plans
            .get_mut(zen::DEFAULT_PLAN)
            .expect("go plan")
            .allowance_by_model
            .insert("deepseek-v4.1-flash".into(), 120.0);
        let changes = record(&opts, &loaded(raised, Source::Live), 3_000);
        assert_eq!(changes.len(), 1, "{changes:?}");
        assert_eq!(changes[0].model, "deepseek-v4.1-flash");
        assert_eq!(changes[0].from, 100.0);
        assert_eq!(changes[0].to, 120.0);
        assert_eq!(changes[0].at, 3_000);
        let with_change = std::fs::read_to_string(&path).unwrap();
        assert!(with_change.contains("120.0"), "{with_change}");

        // A baked-seed load appends nothing and never rewrites the file.
        let seeded = record(&opts, &loaded(zen::builtin(), Source::Builtin), 4_000);
        assert_eq!(seeded.len(), 1, "the one real change survives");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), with_change);
    }
}
