# Lane E — `ocuse`: fetch the Go catalogue live instead of trusting a baked snapshot

Repo `/Users/jyz/dev/cmdcode-tools`. Rust workspace: `core/` (`cmduse-core`), `cmduse/` (bins `cmduse`,
`ocuse`, `arkuse`, `oduse`).

## The defect

`core/zen.json` is baked into every binary with `include_str!` (`core/src/lib.rs:45`), so `ocuse`'s
per-model limits and token rates only change when a release ships. They did not, and the file sat a month
stale: DeepSeek V4.1 Flash reported `$80 / 70.8%` when the live limit is `$100` (a 14-point overstatement),
GLM-5.3 reported `$15 / 2.4%` when the live limit is `$500`, 11 retired models were still listed and 10 new
ones were missing. Worse, `cmduse/src/ocuse/zen.rs` opens with a comment claiming the numbers "move with
upstream instead of living in code", which is only true at release time.

The endpoint needs no key: `GET https://opencode.ai/zen/go/v1/models` answers 200 anonymously, and mpc
already reads it every run. So there is no technical reason for the baked copy to be the source of truth.

## Task

Make the live endpoint the source and the baked file the offline seed.

1. New module `cmduse/src/ocuse/catalogue.rs` (keep it inside the ocuse module — do not add a shared helper,
   another lane is doing the oduse half in parallel):
   - `fetch() -> Result<Json, Unavailable>` against `https://opencode.ai/zen/go/v1/models`, bounded
     (`AbortSignal` equivalent: a reqwest timeout of ~8s, one retry on transport error, no retry on 4xx),
     with a `user-agent` naming the tool.
   - A disk cache under `~/.cache/cmduse/` (env override `CMDUSE_CACHE_DIR`): write only after a parse that
     produced at least one model with a limit, **never write an empty result** (an empty write once poisoned
     mpc's cache for a week), TTL 6 h by default, `--cache <dur>` to override and `0` to disable.
   - On any failure, fall back to `cmduse_core::ZEN_JSON` and mark the result `builtin`.
2. `cmduse/src/ocuse/zen.rs` keeps its types and parsing, but takes the JSON text from the loader rather
   than `const RAW: &str = cmduse_core::ZEN_JSON;`. One code path for both sources — do not fork the parser.
3. Provenance must reach the user: the dashboard, `--json` and `statusline --json` say which catalogue is in
   use (`live`, `builtin`, or `cache, 3h old`) and carry the endpoint's own `extractedAt`/fetch time. A
   stale fallback must never be silently indistinguishable from fresh data.
4. New flag `--no-catalog` (or the naming the sibling flags already use — check `cmduse/src/ocuse/cli.rs`
   first) forces the baked file, for offline use and for tests. Wire it through `ocuse/cli.rs` only; that
   file is yours, `cmduse/src/cli.rs` and the oduse module belong to other lanes.
5. The endpoint also carries `go-teams`; keep every plan it publishes, and keep `--plan` accepting them.
6. Update `cmduse/README.md` and `cmduse/cmduse.1` in the same edit (a documented-behaviour change is not
   finished without them), plus the misleading comment in `zen.rs`.

## Constraints

- Tests must not hit the network: pin a fixture payload and test the pure conversion plus the
  fallback-on-failure path and the "never write an empty cache" rule.
- Keep `cmduse-core` free of I/O — the fetch lives in `cmduse/`, never in `core/`.
- Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`. Foreground,
  wait for them.
- No version bump, tag or publish. Do not edit `AGENTS.md` (record in `docs/agents/aa-e.md` or the report).
- `rg`/`fd` only, explicit paths. No `grep`/`find`/`sed`. One tree, no worktree. Do not touch other lanes'
  files (`aa-models/**`, `oc-cmd-compare/**`, `cmduse/src/oduse/**`, `core/zen.json` is already correct).

Report to `docs/plan/aa-cli/reports/lane-e.md`: the flag, the cache path and TTL, how provenance renders,
the fixture's model count, and a live run showing `live` with the current deepseek-v4.1-flash limit.
