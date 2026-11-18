# Lane D — `statusline --json` key parity

## Before (from the brief, sorted keys)

```
cmduse  fiveHourCap fiveHourSpent fiveHourUsed monthCap monthSpent monthlyCap monthlyRemaining plan weeklyCap weeklySpent weeklyUsed
ocuse   fiveHourCap fiveHourSpent model monthCap monthSpent period plan weeklyCap weeklySpent
arkuse  account accountError afp fiveHourCap fiveHourSpent model monthCap monthSpent period periodEnd plan source weeklyCap weeklySpent
oduse   capLabel fiveHourCap fiveHourSpent model monthCap monthSpent period plan walletSource walletUsd weeklyCap weeklySpent
```

## After (measured, `cargo build -p cmd-usage --bins`, each `statusline --json` piped through `jq -c keys`)

```
cmdusedev  ["fiveHourCap","fiveHourSpent","fiveHourUsed","model","monthCap","monthSpent","monthlyRemaining","period","periodEnd","plan","source","weeklyCap","weeklySpent","weeklyUsed"]
ocusedev   ["fiveHourCap","fiveHourSpent","fiveHourUsed","model","monthCap","monthSpent","monthlyRemaining","period","periodEnd","plan","source","weeklyCap","weeklySpent","weeklyUsed"]
arkusedev  ["account","accountError","afp","fiveHourCap","fiveHourSpent","fiveHourUsed","model","monthCap","monthSpent","monthlyRemaining","period","periodEnd","plan","source","weeklyCap","weeklySpent","weeklyUsed"]
odusedev   ["capLabel","fiveHourCap","fiveHourSpent","fiveHourUsed","model","monthCap","monthSpent","monthlyRemaining","period","periodEnd","plan","source","walletSource","walletUsd","weeklyCap","weeklySpent","weeklyUsed"]
```

Shared 14 keys on all four: the six meter keys (`fiveHourSpent`/`fiveHourCap`, `weeklySpent`/`weeklyCap`, `monthSpent`/`monthCap`) plus `plan`, `source`, `period`, `periodEnd`, `model` and the three cmduse aliases (`fiveHourUsed`, `weeklyUsed`, `monthlyRemaining`). Extra keys are family unit keys only.

## Decisions on the record

`monthlyCap` on cmduse: dropped. It is an exact duplicate of `monthCap`, not one of the documented aliases; the plugin reads `monthlyCap` from the `-1 --json` dashboard, which keeps it. `render_tests.rs` now asserts its absence on the statusline.

`afp` on arkuse: kept. AFP is the plan's only currency and no other family has that concept; `account`/`accountError` are the arkcli control-plane meters, also unique to that source.

`capLabel`, `walletUsd`, `walletSource` on oduse: kept. The per-model cap tier label and the daemon's dollar wallet have no counterpart elsewhere; the root rule already names `walletUsd`.

Aliases: `fiveHourUsed`/`weeklyUsed` mirror the spent figures on all four. `monthlyRemaining` keeps cmduse's pool remainder and is `null` on ocuse/arkuse/oduse, where no credit remainder exists — a fabricated zero would be a false value, not an alias.

Null, never zero: cmduse's `monthCap`, `monthSpent`, `fiveHourCap` and `weeklyCap` are now `null` when the source publishes no cap (the old `unwrap_or(0.0)` was the violation); the text template keeps its zero fallback because it has no null token. ocuse publishes no account-wide pool, so all three caps stay null. arkuse uses the plan's published AFP split. oduse uses the chosen per-model caps, null when unpublished — verified with `odusedev --plan pro statusline --json`: `fiveHourCap: null`, `weeklyCap: 90.0`, `monthCap: 480.0`.

`source` values follow each binary's own dashboard: `api` (cmduse), `opencode.db` (ocuse), `opencode` (arkuse, unchanged), `open-design` (oduse). `periodEnd` is epoch ms on all four; cmduse converts its ISO period end with `parse_iso_utc`. `model` is null on cmduse because its account API yields no per-model id.

## Shared assertion

`report_render.rs` gained `STATUSLINE_KEYS` (sorted 14-key list), `STATUSLINE_EXTRA_KEYS` (the six allowed family extras) and `assert_statusline_keys`, beside the existing `REPORT_*_KEYS` consts. All in the same crate, so no cross-crate boundary forced a local copy. Each binary has its own test calling that one assertion: `cmduse_statusline_json_carries_the_shared_keys`, `ocuse_statusline_json_carries_the_shared_keys`, `arkuse_statusline_json_carries_the_shared_keys`, `oduse_statusline_json_carries_the_shared_keys` (the oduse one sits beside its emitter, not in `oduse/tests/**`, which another lane owns). A missing shared key or an undeclared new key fails each binary's suite.

## Files touched

`cmduse/src/lib.rs`, `cmduse/src/ocuse/render.rs`, `cmduse/src/arkuse/render.rs`, `cmduse/src/oduse/render/status.rs`, `cmduse/src/render_tests.rs`, `cmduse/src/report_render.rs`, `cmduse/README.md`, `cmduse/cmduse.1`. No commit, no push, no worktree, no branch.

## Gate

`cargo fmt --all`, `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` all pass. A mid-run compile error in sibling-owned `cmduse/src/oduse/tests/published_rates.rs` was theirs in flight and cleared before the final gate; nothing there was edited or reverted by this lane.
