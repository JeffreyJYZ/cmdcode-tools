# Lane L — `statusline --json` names its meter and prints the frame's figures

Lane L. Date: 2026-11-18. One tree, no worktree, no branch, no commit, no push.

## S3 — fixed

Two keys added to `oduse statusline --json`:

- `meterSource`: `"snapshot"` when the account snapshot answered, `"local"` otherwise. Same two
  values `render/json.rs` emits; `Source::as_str()` is the only vocabulary.
- `snapshotError`: `null` with no attempt or a success, the reason string when a cookie existed
  and the request failed. Same field `report.snapshot_error` the dashboard JSON emits; no third
  convention.

`sources` was **not** changed: it still names the store (`open-design`), which is its older meaning.
The new keys name the meter, not the store.

### Both surfaces now agree

`dash.rs` picks a snapshot window per window when one exists. A second copy of that "which meter
wins" rule is how the frame and statusline drifted, so the rule moved into one resolver:
`render/json.rs::window_meter(report, plan)` returns the resolved 5h/weekly spent and cap plus the
source. `status.rs` (both `statusline_json` and `statusline_template`) and `render_json`'s
`meterSource` all read it. When the snapshot wins, statusline switches **cap as well as spent** —
without that, a consumer would divide the server's spend by the local Flash cap and get a different
percentage from the frame's `$4.59 used of $5.00` row.

Fixture proof (`tests/statusline_meter.rs`, snapshot 4149/50000 and 29491/150000 credits left):

| key | local (no snapshot) | snapshot present |
| --- | --- | --- |
| `meterSource` | `local` | `snapshot` |
| `fiveHourSpent` / `fiveHourCap` | fixture local / local cap | `4.5851` / `5.0` |
| `weeklySpent` / `weeklyCap` | fixture local / local cap | `12.0509` / `15.0` |

The test asserts the local figures differ from the snapshot figures, so it fails if statusline ever
silently reverts to the store while the frame prints the account's number.

`dash.rs` itself was not edited — another lane owns it this round. Its per-window pick is the rule
the shared resolver mirrors; if that lane changes it, the resolver needs the same change.

## S2 — provenance claim softened

`cmduse/src/oduse/snapshot.rs`: no raw `billing/ledger` body exists in the repo, so capturing one
was not possible here. The comment now attributes `listChargedUsd 0.0043` ↔ `listChargeCredits 43`
to the brief that reports it and says plainly that no raw body is captured — an observation of the
brief, not of this account. It also drops the "exact" reading of the Eco figures: 50,000/150,000
credits are $5/$15, while $18 × 0.27 = $4.86 and $55 × 0.27 = $14.85 are close, not equal. The
repeated test comment in `tests/snapshot.rs` was softened the same way. `CREDIT_TO_USD` is unchanged.

## Constants placement

`meterSource` and `snapshotError` added to `report_render.rs::STATUSLINE_EXTRA_KEYS` (now 8 keys),
**not** `STATUSLINE_KEYS`. A test in `render_tests.rs` asserts that placement, so cmduse/ocuse/arkuse
are never forced to emit a server-meter concept. All four binaries' existing shared-key assertions
still pass.

## Gate (foreground, waited on)

```
cargo test                                  -> all green (lib 333 passed, 0 failed; core 22 passed)
cargo fmt --all -- --check                  -> clean after rustfmt on the two new/edited files
cargo clippy --all-targets -- -D warnings   -> clean
cargo build -p cmd-usage --bin odusedev     -> Finished dev profile
```

`cargo test -p cmd-usage --lib` was 330 passed before this lane; it is 333 now (3 new tests).

Real runs (no session cookie on this machine, so `local` is correct here):

```
$ ./target/debug/odusedev statusline --json | jq '{plan,source,meterSource,snapshotError,fiveHourSpent,fiveHourCap,weeklySpent,weeklyCap,capLabel}'
{ "plan": "go", "source": "open-design", "meterSource": "local", "snapshotError": null,
  "fiveHourSpent": 0.7571149620000005, "fiveHourCap": 10.0,
  "weeklySpent": 11.365388544719996, "weeklyCap": 30.0, "capLabel": "Flash" }

$ ./target/debug/odusedev --plan pro statusline --json | jq '{plan,source,meterSource,snapshotError,fiveHourSpent,fiveHourCap,weeklySpent,weeklyCap,capLabel}'
{ "plan": "pro", "source": "open-design", "meterSource": "local", "snapshotError": null,
  "fiveHourSpent": 0.7603648260000005, "fiveHourCap": null,
  "weeklySpent": 11.368638408719997, "weeklyCap": 90.0, "capLabel": "Pro" }

$ ./target/debug/odusedev -1 --json --no-wallet | jq '{source,meterSource,snapshotError}'
{ "source": "open-design", "meterSource": "local", "snapshotError": null }
```

Null 5-hour cap on Pro and the 90 weekly cap are unchanged, as the review expected.

## Files touched

`cmduse/src/oduse/render/status.rs`, `cmduse/src/oduse/render/json.rs` (shared resolver),
`cmduse/src/report_render.rs` (two constants), `cmduse/src/oduse/snapshot.rs` (comment),
`cmduse/src/oduse/tests/{snapshot.rs,mod.rs,statusline_meter.rs}`, `cmduse/src/render_tests.rs`,
and this report. Nothing else; tree left dirty.
