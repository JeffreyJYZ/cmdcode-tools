//! Where the Command Code API key comes from.
//!
//! One account can leave several keys on disk, and only one of them is the live
//! one: opencode keeps provider credentials in its store's `credential` table,
//! `~/.local/share/opencode/auth.json` is the legacy v1 file, and the official
//! CLI writes `~/.commandcode/auth.json`. Re-connecting through opencode's
//! `/connect` writes the replacement into the store and leaves both files
//! holding the superseded key, which is what made the dashboard answer
//! `status code 401` on all three endpoints while inference kept working.
//!
//! So every source is offered, in the order most likely to be current:
//! `CMD_API_KEY` (explicit override), then opencode's store (active rows first,
//! newest first), then the two legacy files. `api::get` walks the rest of the
//! list when the first key is refused, so a stale head costs one 401, not a
//! dead dashboard.
use std::path::Path;

/// Every key this machine can offer, most likely current first, no duplicates.
pub fn candidates() -> Vec<String> {
    let mut keys = Vec::new();

    // Explicit override: a caller naming a key means only that key.
    if let Ok(key) = std::env::var("CMD_API_KEY") {
        if !key.is_empty() {
            keys.push(key);
        }
    }

    keys.extend(
        crate::ocuse::db::credential_keys(&["commandcode", "command-code"])
            .into_iter()
            .filter(|k| !k.is_empty()),
    );
    for path in [
        format!("{}/auth.json", crate::ocuse::db::opencode_home()),
        format!(
            "{}/.commandcode/auth.json",
            std::env::var("HOME").unwrap_or_default()
        ),
    ] {
        if let Some(key) = auth_json_key(&path) {
            keys.push(key);
        }
    }

    keys.dedup();
    keys
}

/// A key out of a JSON file of the `{"<provider>": {"type": "api", "key": "…"}}`
/// shape, or `{"apiKey": "…"}` for the CLI's own file.
fn auth_json_key(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(Path::new(path)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    for provider in ["commandcode", "command-code"] {
        if let Some(key) = value
            .get(provider)
            .and_then(|entry| entry.get("key"))
            .and_then(|key| key.as_str())
        {
            if !key.is_empty() {
                return Some(key.to_string());
            }
        }
    }
    value
        .get("apiKey")
        .and_then(|key| key.as_str())
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// A store with the columns `credential_keys` reads, holding `rows` of
    /// `(id, provider, active, updated, key)`.
    fn store(rows: &[(&str, &str, i64, i64, &str)]) -> String {
        let path = std::env::temp_dir().join(format!(
            "cmduse-credentials-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT \
                 NOT NULL, value TEXT NOT NULL, active INTEGER, time_created INTEGER NOT NULL, \
                 time_updated INTEGER NOT NULL);",
            )
            .unwrap();
        for (id, provider, active, updated, key) in rows {
            let value = format!(r#"{{"type":"api","key":"{key}"}}"#);
            connection
                .execute(
                    "INSERT INTO credential (id, integration_id, label, value, active, \
                     time_created, time_updated) VALUES (?1, ?2, 'x', ?3, ?4, ?5, ?5)",
                    rusqlite::params![id, provider, value, active, updated],
                )
                .unwrap();
        }
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn store_offers_the_active_key_before_an_inactive_one() {
        // The measured shape: the re-connected key is active and newest, the
        // superseded one is still in the table but inactive.
        let path = store(&[
            ("cred_new", "commandcode", 1, 200, "user_live"),
            ("cred_old", "commandcode", 0, 100, "user_dead"),
        ]);
        let keys = crate::ocuse::db::credential_keys_at(&path, &["commandcode", "command-code"]);
        assert_eq!(keys, vec!["user_live".to_string(), "user_dead".to_string()]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn cli_file_and_opencode_file_both_parse() {
        let dir = std::env::temp_dir().join(format!("cmduse-authjson-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let v1 = dir.join("v1.json");
        std::fs::write(
            &v1,
            r#"{"command-code":{"type":"api","key":"sk_v1"},"other":{"type":"api","key":"no"}}"#,
        )
        .unwrap();
        let cli = dir.join("cli.json");
        std::fs::write(&cli, r#"{"apiKey":"sk_cli","keyName":"cli"}"#).unwrap();
        assert_eq!(auth_json_key(&v1.to_string_lossy()), Some("sk_v1".into()));
        assert_eq!(auth_json_key(&cli.to_string_lossy()), Some("sk_cli".into()));
        let _ = std::fs::remove_dir_all(dir);
    }
}
