# Lane N — the release-grade end-to-end proof, and the version bump

## Why this exists

Six documentation and code lanes have landed into one uncommitted tree. Every claim has been verified in isolation. Nothing has verified the **product** the user will actually install: that a freshly built set of four binaries, run against this machine's real stores, produces the numbers the account itself reports and the surfaces agree with each other.

That is what this lane is. It also performs the one step that has been deliberately withheld from every other lane: **the version bump**.

## Step 1 — the version bump (do this first, it gates everything else)

The tree is at `cmd-usage 0.8.3` / `cmduse-core 2.3.0` / `@jeffreyjyz/opencode-command-code 0.5.35` / `mpc 0.1.13`, which are exactly what the registries already carry:

```
crates.io cmd-usage     max_version 0.8.3
crates.io cmduse-core   max_version 2.3.0
npm plugin              latest      0.5.35
```

Bump, per the repo's versioning rules:

- `cmduse/Cargo.toml` `0.8.3` → `0.8.4`, and `Cargo.lock`'s `cmd-usage` entry in the same edit (the release workflow builds `--locked`; a `Cargo.toml` that moves without the lock fails all six targets).
- `core/Cargo.toml` `2.3.0` → **`2.4.0`** — `core/od.json` changed structurally (a new `cacheRead` field, `longContext`, `rateSource` gaining `published`), and core's semver is deliberately loose so an internal breaking change rides a MINOR. Core's major must stay ahead of the CLI's.
- `opencode-plugin/package.json` `0.5.35` → `0.5.36`.
- `oc-cmd-compare/package.json` `0.1.13` → `0.1.14` (it gained a generated file and new source modules — PATCH is right for incremental work).
- Rebuild after every bump: `dist/` embeds the plugin's version string, so the plugin needs its build run.
- `cargo build` so `Cargo.lock` is regenerated with the new versions, then `cargo package -p cmduse-core --allow-dirty` and `cargo package -p cmd-usage --allow-dirty` to prove both crates package cleanly at the new versions.

Do **not** tag, do not publish, do not push. The bump plus the packaging proof is your deliverable; the user decides when the tags go out.

## Step 2 — build the release binaries and prove the numbers

```sh
cargo build --release -p cmd-usage
```

Then, with the **release** binaries (not `target/debug`), capture:

1. **All four dashboards**: `./target/release/{cmduse,ocuse,arkuse,oduse} -1 --no-wallet` — paste the plan/window lines from each.
2. **The OpenDesign reconciliation**, which is the whole point of the release:
   - `./target/release/oduse -1 --no-wallet --json` → note `summary.credits`, `meterSource`.
   - The server's own figure. If `$OD_SESSION` / `$OD_SESSION_COOKIE` is set, `meterSource` must be `snapshot` and the printed 5h/weekly must be the server's. If no cookie is present (it is httpOnly and the user has not placed it), say so plainly and report `meterSource: local` — then compare the local figure against the last known server reading recorded in `docs/plan/opendesign/reports/` and state the direction and size of the gap. **Do not claim the server meter works if you could not read it.**
3. **Cross-surface agreement**: `oduse statusline --json` and `oduse -1` must report the same 5h and weekly spend. Paste both numbers. This is the defect lane L fixed; prove it holds in the release build.
4. **`--json` envelope keys** on all four: `-1 --json`, `daily --json`, `hourly --json`, `model --json`, `session --json`, `statusline --json` — confirm each against the shared contract and paste the sorted key sets.
5. **`bun parity`** against the release binaries (`CMDUSE_BIN` etc. pointed at them, or via the `*dev` resolution) — must PASS.

## Step 3 — the docs, against the shipped binaries

`cmduse/README.md` and `cmduse/cmduse.1` were just rewritten for four binaries. Check them against what the release binaries actually do: every flag named in the ARKUSE section exists in `arkuse --release --help`; `--rows` behaves as documented on all four; the documented `statusline` keys match the emitter. Delete or fix any claim that does not hold. This is a doc-versus-binary audit, not a rewrite.

## Step 4 — a go/no-go verdict

Write it as a short table at the top of your report: each gate (crates package, binaries build, four dashboards run, od numbers reconcile, statusline agrees with the frame, parity PASS, docs match binaries, `cargo test`, plugin gate) marked PASS/FAIL with the command that proved it. **Any FAIL is a stop** — say what it is and do not paper over it.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- **Never `git tag`, `git push`, `cargo publish`, or `npm publish`.** The bump and a local `cargo package --allow-dirty` only. Publishing is the user's call.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Do not delete build artifacts or run `cargo clean`.** A release build is expensive and another lane may be using `target/`.
- **Your files only:** the four version files (`cmduse/Cargo.toml`, `core/Cargo.toml`, `opencode-plugin/package.json`, `oc-cmd-compare/package.json`), `Cargo.lock`, the plugin's rebuilt `dist/`, and doc corrections in `cmduse/README.md` / `cmduse/cmduse.1` that an actual mismatch justifies. **Do not touch** `core/od.json`, `cmduse/src/**` logic, `oc-cmd-compare/src/**`, or `opencode-plugin/src/**` — those lanes are done and their work is what you are verifying, not editing.
- Gate before you report: everything in step 2 plus `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and `cd opencode-plugin && bun test && bun check`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-n-release-proof.md`, with the go/no-go table at the top. Final chat reply under 15 lines: the verdict, the version numbers, the od reconciliation numbers, and the single thing you could not prove.
