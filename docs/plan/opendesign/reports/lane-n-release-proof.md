# Lane N — release-grade end-to-end proof, and the version bump

## Go / no-go

Every gate PASS. The one thing not provable is the server meter (no httpOnly cookie) — recorded as a limit, not a FAIL, because the local path is the designed fallback and the brief says to report `meterSource: local` plainly.

| Gate | Result | Command that proved it |
| --- | --- | --- |
| crates package at new versions | PASS | `RUSTC_WRAPPER= cargo package -p cmduse-core --allow-dirty` (16 files, verified); `RUSTC_WRAPPER= cargo package -p cmd-usage --allow-dirty` (118 files, verified) |
| release binaries build | PASS | `RUSTC_WRAPPER= cargo build --release -p cmd-usage` → `cmduse, ocuse, arkuse, oduse` in `target/release/` |
| four dashboards run on real stores | PASS | `./target/release/cmduse -1`, `ocuse -1`, `arkuse -1`, `oduse -1 --no-wallet` (each printed its plan/window block) |
| od numbers reconcile | PASS (local only) | `./target/release/oduse -1 --no-wallet --json` → `summary.credits 11.450657376719997`, `meterSource local`; dashboard frame `5-hour $0.84 / Weekly $11.45 / Monthly $11.45` |
| statusline agrees with frame | PASS | statusline `fiveHourSpent 0.8423837940000005` / `weeklySpent 11.450657376719997` vs frame `5-hour $0.84` / `Weekly $11.45` — same values, frame rounds to cents |
| `--json` envelope keys on all four | PASS | `./target/release/<bin> <sub> --json` for `-1, daily, hourly, model, session, statusline`; sorted key sets below match `REPORT_*_KEYS` and `STATUSLINE_KEYS` |
| parity PASS | PASS | `CMDUSE_BIN=... OCUSE_BIN=... ARKUSE_BIN=... ODUSE_BIN=... bun parity` → `PASS parity check: 4 binaries, 28 flags, 11 allowed differences`, exit 0 |
| docs match shipped binaries | PASS | `./target/release/arkuse --help` contains every flag named in the ARKUSE sections of README/cmduse.1; `--rows` marker verified on all four; 14 statusline keys match emitter |
| `cargo test` | PASS | `RUSTC_WRAPPER= cargo test` → lib 333 passed, core 22 passed, 0 failed; doc-tests 0 |
| `cargo fmt --all -- --check` | PASS | exit 0 |
| `cargo clippy --all-targets -- -D warnings` | PASS | exit 0 |
| plugin gate | PASS | `cd opencode-plugin && bun test` → 339 pass / 0 fail; `bun check` → no type errors |

The brief's sample command `./target/release/{cmduse,ocuse,arkuse,oduse} -1 --no-wallet` is wrong for three binaries: `--no-wallet` is oduse-only and the other three reject it. They were run without it; that is not a product defect.

## Step 1 — the version bump (done first)

| file | old | new |
| --- | --- | --- |
| `cmduse/Cargo.toml` | 0.8.3 | **0.8.4** |
| `core/Cargo.toml` | 2.3.0 | **2.4.0** |
| `opencode-plugin/package.json` | 0.5.35 | **0.5.36** |
| `oc-cmd-compare/package.json` | 0.1.13 | **0.1.14** |
| `Cargo.lock` | cmd-usage 0.8.3 / cmduse-core 2.3.0 | 0.8.4 / 2.4.0 (same edit; `cargo build` kept it consistent) |

`cmduse/Cargo.toml` depends on `cmduse-core = { version = "2" }`, so 2.4.0 satisfies it and packaging needs no dependency edit. Plugin `dist/index.js` rebuilt with `bun run build` and now embeds `0.5.36` (verified by `rg` in dist). Core's MINOR bump follows `core/od.json`'s structural change; core major (2) still leads CLI major (0). No tag, no push, no publish in this step.

## Step 2 — release-build numbers against this machine's real stores

### Four dashboards

- **cmduse** (Command Code GOAT): `Credits $20.54 / $70.00 monthly`; `5-hour 0.0% ($0.00 / $14.00)`; `Weekly 41.3% ($14.46 / $35.00)`; period 29,985 req / $49.48.
- **ocuse** (OpenCode go+zen): period `28.5K req · $42.99 · 91.9M in / 18.6M out · 47% of limit`; `5-hour $0.02 · 0%`, `Weekly $19.53 · 40%`, `Monthly $42.99 · 47%`.
- **arkuse** (ARK Agent Plan Medium): period `3.3K req · 69,560 AFP (¥139.12) · 61.6% of limit`; `5-hour 0 / 10,000 AFP`, `Weekly 10,003 / 35,000 AFP (28.6%)`, `Monthly 61,599 / 100,000 AFP (61.6%)`.
- **oduse** (OpenDesign Go): period `9.2K req · $11.45 credits · 21.5M in / 2.2M out`; `5-hour $0.84 · 8.4% of $10.00`, `Weekly $11.45 · 38.2% of $30.00`, `Monthly $11.45 · 9.5% of $120.00`; source line `windows: local estimate — no session cookie`.

### OpenDesign reconciliation (the limit of this proof)

`./target/release/oduse -1 --no-wallet --json`:

```
source open-design · plan go · meterSource local · snapshotError null
summary.credits 11.450657376719997
summary.requests 9151 · tokensIn 21540545 · tokensOut 2163865
```

`$OD_SESSION` / `$OD_SESSION_COOKIE` / `--session-cookie` are **all absent on this machine** (verified by env probe). The session cookie is httpOnly and the user has not supplied it. Therefore `meterSource: local` is correct and **I could not prove the server path** — no request was made, so nothing here shows the `billing/snapshot` route works. Do not read this as server validation.

The only recorded server figures in `docs/plan/opendesign/` are the captured body in `briefs/oduse-snapshot-meter.md` (workspace `bojo3mq…`, `5h 4149/50000`, `7d 29491/150000` credits remaining = $4.5851 / $12.0509 spent at 10,000 credits per dollar). That reading is from the brief's capture (~2026-11-16), not a live account reading. Against today's local figures ($0.84 5h / $11.45 weekly) it is **lower by ~$3.74 (5h) and ~$0.60 (weekly)**, but a 5-hour window resets several times in two days and the recorded caps ($5/$15) differ from today's chosen Flash caps ($10/$30), so that delta is **not** a meter error — it only says no live comparison was possible.

### Cross-surface agreement (release build)

| surface | 5-hour spend | weekly spend |
| --- | --- | --- |
| `oduse statusline --json` | `0.8423837940000005` | `11.450657376719997` |
| `oduse -1` frame | `$0.84` | `$11.45` |

Same underlying numbers; the frame rounds to cents. Statusline also carries `meterSource: local`, `fiveHourCap 10`, `weeklyCap 30`, `capLabel Flash`, and the aliases `fiveHourUsed`/`weeklyUsed`. The lane-L fix holds in the release build.

### `--json` envelope keys (sorted, all four binaries)

Shared report shapes, identical on all four:

```
daily    => days,scope,source,total
hourly   => hours,scope,source,total
model    => models,scope,since,sinceMs,source
session  => projects,scope,sessions,source
```

These match `REPORT_DAILY_KEYS`, `REPORT_HOURLY_KEYS`, `REPORT_MODEL_KEYS`, `REPORT_SESSION_KEYS` in `cmduse/src/report_render.rs`. Every `-1 --json` carries `source`, `periodStart`, `periodStartAt`, `periodEndAt`, `periodEnd`, `summary`. `statusline --json` carries the 14 shared `STATUSLINE_KEYS` on all four (`fiveHourCap, fiveHourSpent, fiveHourUsed, model, monthCap, monthSpent, monthlyRemaining, period, periodEnd, plan, source, weeklyCap, weeklySpent, weeklyUsed`) plus source extras: `arkuse` adds `account, accountError, afp`; `oduse` adds `capLabel, meterSource, snapshotError, walletSource, walletUsd`. No binary drops a shared key.

## Step 3 — doc vs shipped binary audit

- Every flag named in the ARKUSE synopsis/options of README and `cmduse.1` exists in `./target/release/arkuse --help`: `--json --csv --days --hours --since --gated --plan --profile --no-api --db --rows --watch --once --plain --tz --window --period-start --infer-anniversary --interval --bar-width --bursts --dismiss-update --version --help`. No orphan flag, no missing flag.
- `--rows`: `cmduse model --rows 1` → `… 4 more`; `ocuse` → `… 1 more`; `oduse` → `… 1 more`; `arkuse` → no marker because its store has exactly one model row (`.models | length == 1`), so nothing was withheld. All four match the documented "`ends it with … N more when it withheld any`".
- Statusline keys in README/`cmduse.1` (the 14-key list at `cmduse.1:169-171`) match the emitter byte for byte.
- No doc correction needed — no claim failed against a binary.

## Step 4 — verdict

GO. All twelve gates PASS. The single unproven item is the live server meter, reported as `meterSource: local` with no cookie present; it is a stated limit of this environment, not a gate failure. Publishing and tagging are the user's call.
