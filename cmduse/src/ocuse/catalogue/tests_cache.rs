// The cache and fallback paths: what is written, what is read, and what a
// failure looks like. Hermetic by construction — the fetch and the clock are
// injected, and every file lives in a temp dir.
use super::tests::{opts, SAMPLE};
use super::*;
use crate::ocuse::window::now_ms;

#[test]
fn a_failed_fetch_falls_back_to_the_seed_and_says_why() {
    let dir = tempfile::tempdir().expect("tempdir");
    let loaded = resolve_with(
        &opts(dir.path()),
        || Err("catalogue: HTTP 503".into()),
        now_ms(),
    );
    assert_eq!(loaded.provenance.source, Source::Builtin);
    assert_eq!(loaded.provenance.label(), "builtin");
    assert_eq!(
        loaded.provenance.error.as_deref(),
        Some("catalogue: HTTP 503")
    );
    assert!(loaded.provenance.describe().contains("catalogue: HTTP 503"));
    assert_eq!(loaded.catalog.extracted_at, zen::builtin().extracted_at);
    assert_eq!(
        loaded.catalog.go.models.len(),
        zen::builtin().go.models.len()
    );
}

#[test]
fn an_unusable_payload_never_reaches_the_cache() {
    let dir = tempfile::tempdir().expect("tempdir");
    for body in [
        // The shape changed: no models at all.
        r#"{"object":"list","data":[]}"#,
        // Models, but nothing naming a plan or a limit.
        r#"{"object":"list","data":[{"id":"x","cost":{"text":{"input":{"price":1},"output":{"price":2}}}}]}"#,
        "not json at all",
    ] {
        let path = cache_path(&opts(dir.path()));
        let loaded = resolve_with(&opts(dir.path()), || Ok(body.to_string()), now_ms());
        assert_eq!(loaded.provenance.source, Source::Builtin, "{body}");
        assert!(loaded.provenance.error.is_some(), "{body} names a reason");
        assert!(!path.exists(), "an unusable result is never cached: {body}");
    }
}

#[test]
fn a_fresh_cache_answers_without_fetching() {
    let dir = tempfile::tempdir().expect("tempdir");
    let first = resolve_with(&opts(dir.path()), || Ok(SAMPLE.to_string()), now_ms());
    assert_eq!(first.provenance.source, Source::Live);
    let hit = resolve_with(
        &opts(dir.path()),
        || panic!("a fresh cache must not fetch"),
        now_ms() + 90_000,
    );
    assert_eq!(hit.provenance.source, Source::Cache);
    assert_eq!(hit.provenance.label(), "cache, 1m old");
    assert_eq!(
        hit.catalog.go_limit("go", "deepseek-v4.1-flash"),
        Some(100.0)
    );
}

#[test]
fn a_stale_cache_is_not_used() {
    let dir = tempfile::tempdir().expect("tempdir");
    let written = resolve_with(&opts(dir.path()), || Ok(SAMPLE.to_string()), now_ms());
    assert_eq!(written.provenance.source, Source::Live);
    // Seven hours on, past the 6h TTL: a failed fetch falls back to the seed,
    // never to the file it can no longer vouch for.
    let seven_hours = now_ms() + 7 * 3600 * 1000;
    let loaded = resolve_with(
        &opts(dir.path()),
        || Err("catalogue: transport".into()),
        seven_hours,
    );
    assert_eq!(loaded.provenance.source, Source::Builtin);
    assert_eq!(
        loaded.provenance.error.as_deref(),
        Some("catalogue: transport")
    );
}

#[test]
fn a_poisoned_cache_is_ignored_not_trusted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = cache_path(&opts(dir.path()));
    std::fs::create_dir_all(dir.path()).expect("tempdir exists");
    std::fs::write(&path, r#"{"object":"list","data":[]}"#).expect("write");
    // Inside its TTL by mtime, but carrying no limit: a miss, so the fetch runs.
    let loaded = resolve_with(&opts(dir.path()), || Ok(SAMPLE.to_string()), now_ms());
    assert_eq!(loaded.provenance.source, Source::Live);
    assert!(has_limits(&loaded.catalog));
    // …and the good result replaced it.
    let again = resolve_with(&opts(dir.path()), || panic!("must not fetch"), now_ms());
    assert_eq!(again.provenance.source, Source::Cache);
}

#[test]
fn zero_ttl_disables_the_cache_in_both_directions() {
    let dir = tempfile::tempdir().expect("tempdir");
    let options = Options {
        ttl_secs: 0,
        ..opts(dir.path())
    };
    let live = resolve_with(&options, || Ok(SAMPLE.to_string()), now_ms());
    assert_eq!(live.provenance.source, Source::Live);
    assert!(
        !cache_path(&options).exists(),
        "a disabled cache is not written"
    );
    let again = resolve_with(&options, || Err("catalogue: HTTP 500".into()), now_ms());
    assert_eq!(again.provenance.source, Source::Builtin, "and not read");
}

#[test]
fn no_catalog_forces_the_seed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let options = Options {
        no_catalog: true,
        ..opts(dir.path())
    };
    // A cache that would otherwise answer must be ignored too.
    let _ = resolve_with(&opts(dir.path()), || Ok(SAMPLE.to_string()), now_ms());
    let forced = resolve_with(&options, || panic!("--no-catalog must not fetch"), now_ms());
    assert_eq!(forced.provenance.source, Source::Builtin);
    assert_eq!(forced.provenance.error, None, "a choice is not a fault");
    assert_eq!(forced.catalog.extracted_at, zen::builtin().extracted_at);
}
