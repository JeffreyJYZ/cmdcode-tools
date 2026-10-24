// The other agent CLIs on this machine, as usage sources.
//
// opencode's SQLite store only records what opencode itself ran. `pi` and `dsh`
// are separate harnesses on the same providers — `opencode-go` among them — and
// each keeps its own session log, so their model calls spend the same allowance
// and belong in the same totals.
//
//   pi   ~/.pi/agent/sessions/<project>/<iso>_<uuid>.jsonl        (plain JSONL)
//   dsh  ~/.dsh/sessions/<project>/session-<uuid>/session.v4.jsonl.zstd
//
// Both write one row per model call carrying the provider, the model and the
// token counts; dsh compresses its log. Neither is a public format, so the
// readers are deliberately forgiving: an unparsable line is skipped and a store
// that is absent contributes nothing, because a half-written session is normal
// while an agent is running.
use serde::Deserialize;
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};

/// Client labels carried on every row and printed as the report's sources.
pub const DSH: &str = "dsh";
pub const PI: &str = "pi";
/// opencode's own rows, tagged by the `opencode.db` readers in `ocuse::db` and
/// `arkuse::db`.
pub const OPENCODE: &str = "opencode";

/// One model call from a client that is not opencode.
#[derive(Debug, Clone, Default)]
pub struct Turn {
    pub client: &'static str,
    pub at_ms: i64,
    /// The session id the call belongs to.
    pub session: String,
    /// The project directory the client filed the session under — the same role
    /// as a CommandCode project folder, so `cmduse session` resolves a name.
    pub project: String,
    pub provider: String,
    pub model: String,
    pub input: u64,
    pub output: u64,
    /// `pi` records reasoning separately; `dsh` does not, so it stays zero.
    pub reasoning: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// The client's own dollar figure, where it records one (`pi` does, `dsh`
    /// does not). Used only as the fallback when the model carries no rates.
    pub cost_usd: f64,
}

/// Where the extra clients keep their sessions. Explicit rather than read from
/// the environment at the call site, so a test never has to mutate `HOME`.
#[derive(Debug, Clone)]
pub struct Dirs {
    pub dsh: PathBuf,
    pub pi: PathBuf,
}

impl Dirs {
    /// Default layout, with `DSH_SESSIONS_DIR` / `PI_SESSIONS_DIR` honored for an
    /// unusual install (and for a caller that keeps its own root).
    pub fn from_env() -> Self {
        let home = std::env::var("HOME").unwrap_or_default();
        let dsh = std::env::var("DSH_SESSIONS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(format!("{home}/.dsh/sessions")));
        let pi = std::env::var("PI_SESSIONS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(format!("{home}/.pi/agent/sessions")));
        Self { dsh, pi }
    }
}

/// Every `pi` and `dsh` model call at or after `since_ms`, plus the labels of the
/// clients that actually contributed rows. A missing store is not an error.
pub fn read(dirs: &Dirs, since_ms: i64) -> Vec<Turn> {
    let mut turns = read_pi(&dirs.pi, since_ms);
    turns.extend(read_dsh(&dirs.dsh, since_ms));
    turns
}

/// `pi`: one JSON object per line; a `message` row whose `message.role` is
/// `assistant` carries `provider`, `model` and `usage`.
fn read_pi(root: &Path, since_ms: i64) -> Vec<Turn> {
    let mut turns = Vec::new();
    for path in files(root, "jsonl") {
        let Ok(file) = std::fs::File::open(&path) else {
            continue;
        };
        for line in std::io::BufReader::new(file).lines() {
            let Ok(line) = line else { continue };
            let Ok(row) = serde_json::from_str::<PiLine>(&line) else {
                continue;
            };
            if row.kind != "message" {
                continue;
            }
            let Some(message) = row.message else { continue };
            if message.role.as_deref() != Some("assistant") {
                continue;
            }
            let usage = message.usage.unwrap_or_default();
            let tokens =
                usage.input + usage.output + usage.reasoning + usage.cache_read + usage.cache_write;
            let cost = usage.cost.and_then(|c| c.total).unwrap_or(0.0);
            let at_ms = message.timestamp.unwrap_or(0);
            if tokens == 0 && cost == 0.0 {
                continue; // a row with no model call behind it
            }
            if at_ms < since_ms {
                continue;
            }
            turns.push(Turn {
                client: PI,
                at_ms,
                session: stem(&path),
                project: dir_name(path.parent()),
                provider: message.provider.unwrap_or_default(),
                model: message.model.unwrap_or_default(),
                input: usage.input,
                output: usage.output,
                reasoning: usage.reasoning,
                cache_read: usage.cache_read,
                cache_write: usage.cache_write,
                cost_usd: cost,
            });
        }
    }
    turns
}

/// `dsh`: the same idea compressed. `assistant/message` rows carry the model ref
/// under `data.message.source` and the counts under `data.usage`.
fn read_dsh(root: &Path, since_ms: i64) -> Vec<Turn> {
    let mut turns = Vec::new();
    let mut logs = files(root, "jsonl.zstd");
    // A build that writes its log plain names it `session*.jsonl`; `pi`'s logs
    // are `.jsonl` too, which is why this reader only takes session-named ones.
    logs.extend(files(root, "jsonl").into_iter().filter(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("session"))
    }));
    for path in logs {
        let Ok(text) = decode(&path) else { continue };
        for line in text.lines() {
            let Ok(row) = serde_json::from_str::<DshLine>(line) else {
                continue;
            };
            if row.kind != "assistant/message" {
                continue;
            }
            let Some(data) = row.data else { continue };
            let usage = data.usage.unwrap_or_default();
            let tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
            let at_ms = row.time.unwrap_or(0);
            if tokens == 0 || at_ms < since_ms {
                continue;
            }
            let (provider, model) = data
                .message
                .and_then(|m| m.source)
                .map(|s| (s.provider.unwrap_or_default(), s.model.unwrap_or_default()))
                .unwrap_or_default();
            turns.push(Turn {
                client: DSH,
                at_ms,
                session: session_dir(&path),
                // dsh nests one directory deeper: <project>/session-<uuid>/file.
                project: dir_name(path.parent().and_then(|p| p.parent())),
                provider,
                model,
                input: usage.input,
                output: usage.output,
                reasoning: 0,
                cache_read: usage.cache_read,
                cache_write: usage.cache_write,
                cost_usd: 0.0,
            });
        }
    }
    turns
}

/// Decompress a dsh log, or read it as-is when a build wrote it plain.
fn decode(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    if path.extension().and_then(|e| e.to_str()) == Some("zstd") {
        let mut out = String::new();
        Read::read_to_string(
            &mut zstd::stream::read::Decoder::new(file)
                .map_err(|e| format!("decompress {}: {e}", path.display()))?,
            &mut out,
        )
        .map_err(|e| format!("decompress {}: {e}", path.display()))?;
        return Ok(out);
    }
    std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}

/// Session logs under `root`, at most three levels deep (project dir, session
/// dir, file). A missing root yields nothing.
fn files(root: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    walk(root, 3, &mut found);
    let tail = format!(".{suffix}");
    found.retain(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(&tail))
    });
    found
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth - 1, out);
        } else {
            out.push(path);
        }
    }
}

/// The log's own name, so `session` and `model` group a client's rows apart.
fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

/// dsh names each session directory `session-<uuid>`; that is its id.
fn session_dir(path: &Path) -> String {
    dir_name(path.parent())
}

/// A directory's own name, for the project a client filed a session under.
fn dir_name(path: Option<&Path>) -> String {
    path.and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

#[derive(Deserialize)]
struct PiLine {
    #[serde(rename = "type")]
    kind: String,
    message: Option<PiMessage>,
}

#[derive(Deserialize)]
struct PiMessage {
    role: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    usage: Option<PiUsage>,
    timestamp: Option<i64>,
}

#[derive(Deserialize, Default)]
struct PiUsage {
    #[serde(default)]
    input: u64,
    #[serde(default)]
    output: u64,
    #[serde(default)]
    reasoning: u64,
    #[serde(rename = "cacheRead", default)]
    cache_read: u64,
    #[serde(rename = "cacheWrite", default)]
    cache_write: u64,
    cost: Option<PiCost>,
}

#[derive(Deserialize)]
struct PiCost {
    total: Option<f64>,
}

#[derive(Deserialize)]
struct DshLine {
    #[serde(rename = "type")]
    kind: String,
    time: Option<i64>,
    data: Option<DshData>,
}

#[derive(Deserialize)]
struct DshData {
    message: Option<DshMessage>,
    usage: Option<DshUsage>,
}

#[derive(Deserialize)]
struct DshMessage {
    source: Option<DshSource>,
}

#[derive(Deserialize)]
struct DshSource {
    provider: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize, Default)]
struct DshUsage {
    #[serde(rename = "inputTokens", default)]
    input: u64,
    #[serde(rename = "outputTokens", default)]
    output: u64,
    #[serde(rename = "cacheReadTokens", default)]
    cache_read: u64,
    #[serde(rename = "cacheWriteTokens", default)]
    cache_write: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One `pi` session as the real client writes it: an assistant call with
    /// usage, a user row with none, and a line no parser should trust.
    fn write_pi(root: &Path) {
        let dir = root.join("--Users-someone-project--");
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("2026-10-22T04-46-39-503Z_01a161ee.jsonl");
        std::fs::write(
            log,
            concat!(
                r#"{"type":"message","message":{"role":"assistant","provider":"opencode-go","model":"deepseek-v4.1-flash","timestamp":1000,"usage":{"input":100,"output":10,"reasoning":5,"cacheRead":900,"cacheWrite":0,"cost":{"total":0.25}}}}"#,
                "\n",
                r#"{"type":"message","message":{"role":"user","timestamp":900}}"#,
                "\n",
                "{not json}\n",
            ),
        )
        .unwrap();
    }

    /// One `dsh` session: the real shape, compressed the way dsh writes it.
    fn write_dsh(root: &Path) {
        let dir = root.join("--Users-someone-project--/session-02b087ed");
        std::fs::create_dir_all(&dir).unwrap();
        let log = concat!(
            r#"{"type":"assistant/message","time":2000,"data":{"message":{"source":{"provider":"opencode-go","model":"glm-5.2"}},"usage":{"inputTokens":50,"outputTokens":5,"cacheReadTokens":500,"totalTokens":555}}}"#,
            "\n",
            r#"{"type":"user/message","time":1900,"data":{"content":[]}}"#,
            "\n",
        );
        let compressed = zstd::encode_all(log.as_bytes(), 3).unwrap();
        std::fs::write(dir.join("session.v4.jsonl.zstd"), compressed).unwrap();
    }

    fn dirs(root: &Path) -> Dirs {
        Dirs {
            dsh: root.join("dsh"),
            pi: root.join("pi"),
        }
    }

    #[test]
    fn reads_both_clients_and_tags_each_row() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = dirs(tmp.path());
        write_pi(&dirs.pi);
        write_dsh(&dirs.dsh);
        let mut turns = read(&dirs, 0);
        turns.sort_by_key(|t| t.at_ms);
        assert_eq!(turns.len(), 2, "one billed row per client: {turns:?}");
        assert_eq!(turns[0].client, PI);
        assert_eq!(turns[0].provider, "opencode-go");
        assert_eq!(turns[0].input, 100);
        assert_eq!(turns[0].cache_read, 900);
        assert_eq!(turns[0].reasoning, 5);
        assert_eq!(turns[0].cost_usd, 0.25);
        assert!(turns[0].session.contains("01a161ee"));
        assert_eq!(turns[1].client, DSH);
        assert_eq!(turns[1].model, "glm-5.2");
        assert_eq!(turns[1].input, 50);
        assert_eq!(turns[1].cache_read, 500);
        assert_eq!(turns[1].session, "session-02b087ed");
    }

    #[test]
    fn since_keeps_only_later_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = dirs(tmp.path());
        write_pi(&dirs.pi);
        write_dsh(&dirs.dsh);
        let turns = read(&dirs, 1_500);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].client, DSH);
    }

    #[test]
    fn a_missing_store_contributes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read(&dirs(tmp.path()), 0).is_empty());
    }

    #[test]
    fn a_plain_dsh_log_reads_like_a_compressed_one() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("--Users-someone-project--/session-x");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("session.v4.jsonl"),
            concat!(
                r#"{"type":"assistant/message","time":2000,"data":{"message":{"source":{"provider":"opencode-go","model":"glm-5.2"}},"usage":{"inputTokens":50,"outputTokens":5}}}"#,
                "\n",
            ),
        )
        .unwrap();
        let turns = read(
            &Dirs {
                dsh: tmp.path().to_path_buf(),
                pi: tmp.path().join("none"),
            },
            0,
        );
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].input, 50);
    }

    #[test]
    fn a_recording_without_counts_is_not_a_request() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("--p--");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("s.jsonl"),
            concat!(
                r#"{"type":"message","message":{"role":"assistant","provider":"opencode-go","model":"x","timestamp":1000,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reasoning":0,"cost":{"total":0}}}}"#,
                "\n",
            ),
        )
        .unwrap();
        assert!(read(
            &Dirs {
                dsh: tmp.path().join("none"),
                pi: tmp.path().to_path_buf(),
            },
            0
        )
        .is_empty());
    }
}
