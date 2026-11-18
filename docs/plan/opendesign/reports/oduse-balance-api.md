# oduse balance API — lane log

Brief: `docs/plan/opendesign/briefs/oduse-balance-api.md`.

## 2026-11-17 — start

Scope confirmed: `cmduse/src/oduse/**`, `cmduse/README.md`, `cmduse/cmduse.1`. Tree on `main` at `6dedfc5`; only unrelated untracked briefs/reports present. Existing wallet path is the local daemon only (`oduse/wallet.rs`), resolved once in `cli/mod.rs::read_wallet`, carried through `Report.wallet` / `wallet_error`.

Design: add a separate API meter module (console session cookie supplied by env or a 0600 file, never scraped), a resolution module that prefers API then daemon, `walletSource` on `--json` and the frame, and a stub-driven test file. `--session-cookie` is stripped in `oduse/args.rs` before the shared parser so all Rust edits stay under `oduse/**`.

## 2026-11-17 — implementation

- `oduse/api_wallet.rs`: `GET $OD_API_URL/api/v1/wallet/balance` with a `Cookie` header; `balanceUsd` parsed from the decimal string, `expiresAt`/`updatedAt` carried through. Named failures: `NoCredential`, `Credential`, `Http`, `BadBody`, `Transport` — never a zero. Absent credential returns before opening a socket.
- `oduse/meter.rs`: API first when a credential exists, daemon fallback, both reasons named when both fail; `Source::{Api,Daemon}`. Reused each watch tick.
- `oduse/args.rs::split_session_cookie`: pulls `--session-cookie <path>` / `--session-cookie=<path>` out of argv before the shared parser. No secret in argv; a bare flag is left for the parser to refuse.
- `Wallet` gains `expires_at`/`updated_at`; `Report` gains `wallet_source`; frame prints `(api)`/`(daemon)` and the expiry date; `--json` and `statusline --json` gain `walletSource`.
- `--no-wallet` now skips both routes. Env `OD_SESSION`/`OD_SESSION_COOKIE` win over the file; the file must be mode 0600.
- Tests: `tests/api_wallet.rs` covers the real body, decimal-string value, 401/404, garbage, timeout, file-mode refusal and "absent credential → zero requests". Existing render/json/cli tests updated for the new fields.

## 2026-11-17 — verification

- `cargo test`: 312 passed, 0 failed on this lane's first full run; 318 passed, 0 failed after the sibling snapshot lane landed its own tests.
- `cargo clippy --all-targets -- -D warnings`: clean.
- `cargo fmt --all -- --check`: my files are clean (`rustfmt --check --config skip_children=true` on each edited file). Whole-tree check reports diffs only in a **sibling session's in-flight** `cli/ctx.rs`, `snapshot.rs` and `tests/snapshot.rs` (a separate snapshot-meter lane). Per house rule those files were not touched.
- `OD_SESSION` and `OD_SESSION_COOKIE` are both unset in this environment, so no real-account probe was possible. The stub path is the proof: 200 with the brief's exact body yields `$1.00`, `expiresAt` `2026-12-16T13:21:22.000Z`, `updatedAt` `2026-11-16T13:21:30.404Z`, and the frame line renders `wallet: $1.00 (api) · expires 2026-12-16`.
