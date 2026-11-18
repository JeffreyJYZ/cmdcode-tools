# Lane report — `billing/snapshot` as the window meter

Date: 2026-11-17. Scope: `cmduse/src/oduse/**`, `cmduse/README.md`, `cmduse/cmduse.1`. No commit, push or branch.

## Coordination

Read `git status` first. The balance lane was already editing `api_wallet.rs`, `meter.rs`, `wallet.rs`, `args.rs`, `cli/ctx.rs`, `cli/mod.rs`, `mod.rs`, `window/mod.rs`, `render/json.rs`, `render/status.rs`, and the docs. I reused its `api_wallet::{Credential, credential, base_url, Unavailable, TIMEOUT_MS}` verbatim — no second cookie path, no second secret source, no duplicate env/flag parsing. `--session-cookie <path>` and `OD_SESSION`/`OD_SESSION_COOKIE` come from that lane.

New files: `snapshot.rs`, `snapshot_window.rs`, `render/snapshot.rs`, `tests/snapshot.rs`. Surgical edits to shared files only (`mod.rs`, `render/mod.rs`, `render/dash.rs`, `render/json.rs`, `window/mod.rs`, `cli/ctx.rs`, `tests/mod.rs`) — no whole-file rewrites.

## Implementation

- `GET <base>/api/v1/workspaces/current/billing/snapshot` with the same `Cookie` header and 2 s timeout as the balance call. `OD_WORKSPACE` substitutes a named workspace id; `current` is the default because sibling routes (`workspaces/current/billing/usage`, `/wallet/balance`, `/credits/me`, `/dashboard`) answer 401 — route exists — while unknown paths answer 404.
- `designPlanWindows` parsed as decimal strings: `5h` 4149/50000, `7d` 29491/150000, each with `windowStart` and the server's `resetsAt`. `resetsAt` formats as `14:21Z` from `parse_iso_utc`, never from a local clock.
- `CREDIT_TO_USD = 0.0001`, one named constant with the ledger proof in the comment (`listChargedUsd 0.0043` ↔ `listChargeCredits 43`). Both raw credit counts and derived dollars are printed and carried in `--json`.
- Snapshot windows replace the local 5-hour and Weekly rows in the dashboard. Monthly stays local: the snapshot has no monthly window. The local store rows are still computed and still in `--json` under `totals`; the authoritative figures are under `snapshot`, and `meterSource` is `"snapshot" | "local"`.
- One dim source line: `windows: account snapshot` when it answered, `windows: local estimate — <reason>` on a named failure, `windows: local estimate — no session cookie` with no credential (and no request at all).
- Failures use `api_wallet::Unavailable`: 401/403/404 → `api HTTP <status>` (401 names the dead cookie), malformed body → `api bad response (…)`, hang → `api transport (…)`. Never a zero, never a panic.

## Tests

`oduse::tests::snapshot` (7 tests, stub TCP listener with injected base): real body parse incl. unit proof and reset label; 401/403/404 named; malformed body named; timeout named; no credential sends no request; snapshot beats local in rendered text. Full-suite result recorded below.

## Gate

- `cargo test` — run 1: 317 passed, 1 failed (my own rounding assertion, `p.round()/10` instead of `(p*10).round()/10`); fixed. Run 2: **318 passed, 0 failed** (plus 22 core tests).
- `cargo fmt --all` applied (only my files), then `cargo fmt --all -- --check`: **clean**. `cargo clippy --all-targets -- -D warnings`: **clean**.

## Real-account proof

No `OD_SESSION`, `OD_SESSION_COOKIE`, `OD_API_URL` or `OD_WORKSPACE` in this environment, so no real request was made. The exact brief body is the stub fixture. The window path uses `current` rather than the brief's concrete workspace id; the usage-hunt report shows `workspaces/current/...` is a valid alias on this host (401 vs 404 for an unknown route). If a cookie is later available, verify with `OD_SESSION=… oduse -1` and expect `$4.59 used of $5.00 · 8.3% left · resets 14:21Z`.
