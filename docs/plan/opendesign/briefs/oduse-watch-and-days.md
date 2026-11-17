# Lane brief — oduse `-i 1` redraw storm

Repo `~/dev/cmdcode-tools`, branch `feat/oduse` (PR #28 open). You own `cmduse/src/oduse/**` for this pass. Nothing else; `opencode-plugin/` belongs to another lane, root `AGENTS.md` is mine.

## The defect, reproduced twice on this machine

```
$ timeout 10 script -q /dev/null ./target/debug/oduse -i 1 --no-wallet | wc -c
2441261        # ~2.4 MB in 10 s, ~196 redraws/second, CPU ~33 %
$ timeout 10 script -q /dev/null ./target/debug/oduse -i 2 --no-wallet | wc -c
12667          # correct
```

Siblings at `-i 1` over the same 10 s: `cmduse` 10199 bytes, `ocuse` 2668, `arkuse` 4.

Only the literal 1-second interval is broken: `-i 1`, `-i 1s`, `-i 01`, `--interval 1` all spin; `-i 2/3/5/10` are correct; `-i 1m` is correct; `-i 0` and `-i 1.0` are rejected with the documented `-i needs a duration 1s–24h`. It reproduces piped and under a pty, with `--plain`, and with a bogus `OD_DB` — the redraw cadence, not the store read or the wallet.

## Find it before fixing it

Read `cmduse/src/oduse/watch.rs` and `cmduse/src/oduse/cli/frame.rs` against `cmduse/src/ocuse/watch.rs` and cmduse's own loop. Say which arithmetic differs. The likely shape is a duration conversion that yields something tiny for the literal `1` (a seconds/milliseconds mix-up, or a `Duration` built from the wrong field) — prove it with a number, e.g. print the computed sleep for `-i 1` before and after.

If the arithmetic is shared, fix the common helper rather than special-casing oduse, and say which binaries the fix covers.

## Then

1. Regression test that would have caught it: a 1-second interval must not redraw more than a small bounded number of times over a simulated window. If the loop needs a tty, test the interval arithmetic and the frame cadence separately and say which you chose.
2. Prove it with the command that caught it (before/after byte counts, with `-i 2` unchanged as the control), plus `-i 1m`, `-i 0` and `-i 1.0` still behaving as documented.
3. Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.

## Second defect, same pass: `oduse model --days N` is inert

`oduse model --json --days 365` returns `{"since":"2026-11-01…","n":0}` while `--since 2026-01-01T00:00:00Z` gives `n:1` and `--window all` gives `n:1` — the window stays pinned to the period start, so `--days` on `model` does nothing. Same through MCP: `tools/call model {"days":365}` answers `no completed turns in this period` where `arkuse` returns the row. `session --days` and `daily --days` both work, so it is `model` only. `cmduse`'s help documents `model [--days N | --since ISO]`, so the documented contract exists on one binary and not the others — check whether `ocuse`/`arkuse` share the defect and fix the shared path if they do.

## Third, small: two machine-readable name drifts

- `models --json` emits `label` on oduse but `name` on the other three (`head -1 | jq keys`). Same concept, different key; `plans[]` uses `label` everywhere, so only the model row drifts. Pick the majority spelling for the model row and keep one name per concept.
- `plans --json` on ocuse/arkuse carries a `windows` divisor map (`{"fiveHour":0.2,"weekly":0.5,"monthly":1.0}`); oduse omits it and prints absolute `fiveHourUsd`/`weeklyUsd`/`monthlyUsd` instead. Add the shared `windows` key so a consumer reading it gets an answer on all four, keeping the absolute fields.

Do not change `arkuse`'s `monthInferred` in this pass — it is the odd one out, but it is arkuse's file and a separate change; report it instead.

## Rules

`rg`, `fd`, `sd`, no Python, no agent-desktop, never run a bare dashboard (bound it with `timeout`, pty optional). Files under 200 lines — split, never trim. No commit, push, branch, stash or amend; leave the tree dirty. One turn: batch independent calls, gates in the foreground inside the same call.

Report: the arithmetic you found with its before/after number, each fix, the regression test, the exact gate lines, and anything you deliberately left.
