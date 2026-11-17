# Release report — cmduse 0.8.2

Brief: `docs/plan/opendesign/briefs/release-0.8.2.md`. Executed 2026-11-17 ~12:40–13:00 CST.

> Correction up front: an earlier pass of this file carried a block claiming `cargo publish` failed with `already exists` and that "the tag run publishes the crate". Both are false. The publish succeeded (log quoted in §4), and `release.yml` only builds the six assets — it never publishes the crate. This file now carries only measured output.

## 1. Tree being tagged

- Branch `main`, HEAD `ee619770acdfe70793b75e300c75306d7c708dbc` (`ee61977`); `git status --short` shows only `?? docs/plan/`.
- `cmduse/Cargo.toml` `version = "0.8.2"`; `Cargo.lock` carries `cmd-usage 0.8.2`; `cmduse-core` `2.3.0`.

```
$ git log --oneline -3
ee61977 test(oduse): pin the cross-shelf cache floor and the zero-report regression (#36)
624f022 fix(oduse): count the turns that actually spend the allowance (#34)
21c1158 fix(plugin): an empty sidebar row list crashed the whole slot (#35)
```

Gates:

```
$ cargo test
test result: ok. 292 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.65s
EXIT=0
```
(plus `cmduse_core`: `22 passed`; every other suite `0 tests`; total 314 passing.)

```
$ cargo fmt --all -- --check
(no output)          FMT_EXIT=0
```

```
$ cargo package -p cmd-usage --allow-dirty
   Packaging cmd-usage v0.8.2 (/Users/jyz/dev/cmdcode-tools/cmduse)
   Packaged 104 files, 944.9KiB (256.5KiB compressed)
   Verifying cmd-usage v0.8.2 (/Users/jyz/dev/cmdcode-tools/target/package/cmd-usage-0.8.2)
   Compiling cmd-usage v0.8.2 (…)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 31.58s
EXIT=0
```

Commit CI on `main` is green — `gh run list --workflow ci.yml --branch main --limit 3` reported `ee61977 completed success`, `624f022 completed success`, `21c1158 completed success`. So the tag is not carrying a red tree.

Baseline before the upgrade — the machine was on 0.8.0 and the sidebar was stale, as the brief said:

```
$ for b in cmduse ocuse arkuse oduse; do printf '%s: ' "$b"; /opt/homebrew/bin/$b -V; done
cmduse: cmduse 0.8.0
ocuse: ocuse 0.8.0
arkuse: arkuse 0.8.0
oduse: oduse 0.8.0
$ ls /opt/homebrew/Cellar/cmduse/
0.8.0
```

```
$ timeout 120 oduse -1 --no-wallet | head -8       # 0.8.0
period: calendar month · ends 2026-12-01 · 0 requests · $0.00 credits · 0 in / 0 out tokens
  5-hour   $0.00 · 0.0% of $18.00 · rolling 5h
  Weekly   $0.00 · 0.0% of $55.00 · rolling 7d
  Monthly  $0.00 · 0.0% of $220.00 · ends 2026-12-01 · window 54.0% elapsed · $118.80 by now
```

## 2. Tag

`cmduse-v0.8.2` already existed locally and on the remote at the gated commit — lightweight (`git cat-file -t` → `commit`), written 12:44:03 and pushed the same minute. `git tag cmduse-v0.8.2` answered `fatal: tag 'cmduse-v0.8.2' already exists` and `git push origin cmduse-v0.8.2` answered `Everything up-to-date`: nothing amended, nothing forced.

```
$ git rev-parse cmduse-v0.8.2
ee619770acdfe70793b75e300c75306d7c708dbc
$ git ls-remote origin 'refs/tags/cmduse-v0.8.2*'
ee619770acdfe70793b75e300c75306d7c708dbc	refs/tags/cmduse-v0.8.2
```

## 3. The tag's own release run

Selected by `headBranch`, not "the latest run":

```
$ gh run list --workflow release.yml --limit 8 --json headBranch,databaseId,status,conclusion,createdAt,event
[… {"databaseId":44019214012,"event":"push","headBranch":"cmduse-v0.8.2","status":"in_progress"} …]
```

Run **`44019214012`**. Final state:

```
$ gh run view 44019214012 --json status,conclusion,jobs
run: completed success
aarch64-unknown-linux-gnu: completed success
aarch64-unknown-linux-musl: completed success
x86_64-unknown-linux-gnu: completed success
x86_64-unknown-linux-musl: completed success
aarch64-apple-darwin: completed success
x86_64-apple-darwin: completed success
release: completed success
verify: completed success
```

Six targets green, plus `release` and `verify`.

Assets — six tarballs plus `SHA256SUMS`:

```
$ gh release view cmduse-v0.8.2 --json tagName,assets -q '.assets[] | "\(.name) \(.size)"'
cmduse-0.8.2-aarch64-apple-darwin.tar.gz 14461818
cmduse-0.8.2-aarch64-unknown-linux-gnu.tar.gz 14465236
cmduse-0.8.2-aarch64-unknown-linux-musl.tar.gz 15250022
cmduse-0.8.2-x86_64-apple-darwin.tar.gz 15445243
cmduse-0.8.2-x86_64-unknown-linux-gnu.tar.gz 15059118
cmduse-0.8.2-x86_64-unknown-linux-musl.tar.gz 16266376
SHA256SUMS 661
```

Downloaded the macOS arm64 asset and listed it — **eight** binaries, as required:

```
$ shasum -a 256 -c <(rg 'aarch64-apple-darwin' SHA256SUMS)
cmduse-0.8.2-aarch64-apple-darwin.tar.gz: OK
$ tar -tzf cmduse-0.8.2-aarch64-apple-darwin.tar.gz | sort
./
./arkuse
./arkusedev
./cmduse
./cmduse.1
./cmdusedev
./LICENSE-MIT
./ocuse
./ocusedev
./oduse
./odusedev
```

## 4. Crate publish

Before publishing the index still read 0.8.0, confirming the tag run published nothing:

```
$ cargo search cmd-usage --limit 1
cmd-usage = "0.8.0"    # Live Command Code (commandcode.ai) usage dashboard: credits, 5-hour and weekly windows, plan limits. …
```

`cargo publish -p cmd-usage --dry-run` verified clean, then the real publish:

```
$ cargo publish -p cmd-usage
   Verifying cmd-usage v0.8.2 (/Users/jyz/dev/cmdcode-tools/target/package/cmd-usage-0.8.2)
   Uploading cmd-usage v0.8.2 (/Users/jyz/dev/cmdcode-tools/cmduse)
    Uploaded cmd-usage v0.8.2 to registry `crates-io`
    Published cmd-usage v0.8.2 at registry `crates-io`
EXIT=0

$ cargo search cmd-usage --limit 1
cmd-usage = "0.8.2"    # Live Command Code (commandcode.ai) usage dashboard: credits, 5-hour and weekly windows, plan limits. …
```

## 5. Tap

`scripts/bump-tap.sh` repinned all four targets off the release's own `SHA256SUMS`:

```
aarch64-apple-darwin             9b3a38b232d4 -> 3345c1c7d65a
x86_64-apple-darwin              788f157f2e7b -> 73d8edbe3f3f
aarch64-unknown-linux-musl       80090190b49b -> e494da9836d2
x86_64-unknown-linux-musl        4d13b6fa7b0e -> ac34dfaced63
pinned cmduse-v0.8.2 in …/homebrew-tap/Formula/cmduse.rb
```

The tap checkout was sitting on PR #25's branch (`cmduse-0.8.0-oduse`, `f631660`), so the bump branched from it and kept the eight-binary install line and the `oduse -V` assertion:

```
$ rg -n 'bin.install|assert_match "' Formula/cmduse.rb
35:    bin.install "cmduse", "ocuse", "arkuse", "oduse", "cmdusedev", "ocusedev", "arkusedev", "odusedev"
40:    assert_match "cmduse", shell_output("#{bin}/cmduse -V")
41:    assert_match "ocuse", shell_output("#{bin}/ocuse -V")
42:    assert_match "arkuse", shell_output("#{bin}/arkuse -V")
43:    assert_match "oduse", shell_output("#{bin}/oduse -V")
```

Pushed over HTTPS as `jyzbot` with `GIT_ASKPASS=$TMPDIR/tap-askpass.sh`:

```
$ git push https://github.com/JeffreyJYZ/homebrew-tap.git cmduse-0.8.2:refs/heads/cmduse-0.8.2
 * [new branch]      cmduse-0.8.2 -> cmduse-0.8.2
```

Opened **https://github.com/JeffreyJYZ/homebrew-tap/pull/26** as `jyzbot` ("cmduse 0.8.2: pin the new assets, keep all eight binaries").

**I did not merge it — the user did.** 30 seconds after it opened, `gh pr view 26` reported `MERGED`, and the timeline names the actor:

```
$ gh api repos/JeffreyJYZ/homebrew-tap/issues/26/timeline --jq '… select(.event=="merged") …'
JeffreyJYZ merged 2026-11-17T04:50:40Z sha e693a49
```

Merged as `e693a49` ("cmduse 0.8.2: pin the new assets"). `origin/main` now carries the 0.8.2 pins **and** the eight-binary `bin.install` line, so PR #25's content is in `main` too; #25 itself is still open and can be closed as superseded. Formatting note: the squash title lost the "keep all eight binaries" half, but the diff carries both commits' content.

## 6. Install and prove

```
$ brew update && brew upgrade cmduse
==> Updating Homebrew...
Already up-to-date. … Removing: …/cmduse--0.8.0.tar.gz
```

`brew upgrade` moved 0.8.0 → 0.8.2. A `brew reinstall cmduse` followed to prove the freshly merged formula installs the same eight names (both used the local formula, which already carried the eight-binary line):

```
$ for b in cmduse ocuse arkuse oduse; do printf '%s: ' "$b"; /opt/homebrew/bin/$b -V; done
cmduse: cmduse 0.8.2
ocuse: ocuse 0.8.2
arkuse: arkuse 0.8.2
oduse: oduse 0.8.2

$ ls /opt/homebrew/Cellar/cmduse/
0.8.2
$ ls /opt/homebrew/Cellar/cmduse/0.8.2/bin/
arkuse  arkusedev  cmduse  cmdusedev  ocuse  ocusedev  oduse  odusedev
```

All eight `/opt/homebrew/bin/*` symlinks repoint at `../Cellar/cmduse/0.8.2/bin/…`.

`opencode-plugin/scripts/verify-crate.ts 0.8.2 --formula …` agrees end to end:

```
version=0.8.2 tarball=200 sha256=46214ce6d43f… MATCH
asset cmduse-0.8.2-aarch64-apple-darwin.tar.gz MATCH sha256=3345c1c7d65a…
asset cmduse-0.8.2-x86_64-apple-darwin.tar.gz MATCH sha256=73d8edbe3f3f…
asset cmduse-0.8.2-aarch64-unknown-linux-musl.tar.gz MATCH sha256=e494da9836d2…
asset cmduse-0.8.2-x86_64-unknown-linux-musl.tar.gz MATCH sha256=ac34dfaced63…
formula pins 4 release assets matching 0.8.2
verified cmd-usage@0.8.2
```

### Proof commands

```
$ timeout 120 oduse -1 --no-wallet | head -8
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: calendar month · ends 2026-12-01 · 3.2K requests · $2.03 credits · 8.1M in / 801.4K out tokens

DESIGN Go $220.00/month · $55.00/week · $18.00/5h · 10 concurrent
  5-hour   $1.31 · 7.3% of $18.00 · rolling 5h
  Weekly   $2.03 · 3.7% of $55.00 · rolling 7d
  Monthly  $2.03 · 0.9% of $220.00 · ends 2026-12-01 · window 54.0% elapsed · $118.80 by now
```

Real figures, not `0 requests · $0.00`: ~3.2K requests and ~$2 of credits. The header now names both sources — `(app + opencode)` — which is the fix this release carries.

```
$ timeout 120 oduse daily --days 60 --no-wallet --rows 3
day          credits    requests   tokens
2026-10-19       $0.00            1     31.0K
2026-11-16       $0.72          912      3.0M
2026-11-17       $1.31         2.3K      5.9M
```

`--rows 3` kept the three newest rows. The `… N more` tail is exercised on a smaller cap:

```
$ timeout 120 oduse daily --days 60 --no-wallet --rows 2
2026-11-16       $0.72          912      3.0M
2026-11-17       $1.31         2.3K      5.9M
… 1 more
$ timeout 120 oduse daily --days 60 --no-wallet --rows 1
2026-11-17       $1.31         2.3K      5.9M
… 2 more
```

Note: the brief expected `--rows 3` itself to print the tail. It does not — with exactly three empty days in the 60-day window, three rows is the whole table, so the correct output has no tail. The `… N more` line is present and correct at `--rows 2` and `--rows 1`.

```
$ timeout 120 oduse model --window all --no-wallet | head -6
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: all time · 3.2K requests · $2.03 credits · 8.1M in / 802.8K out tokens

DESIGN Go $220.00/month · $55.00/week · $18.00/5h · 10 concurrent
  5-hour   $1.31 · 7.3% of $18.00 · rolling 5h
  Weekly   $2.03 · 3.7% of $55.00 · rolling 7d
```

and its model table, so the attribution is real:

```
MODEL                        MULT    CREDITS   SHARE       5H       WK     REQ
deepseek-v4.1-flash          x0.5      $1.84   90.6%    $1.31    $1.84    3.1K
deepseek-v4.1-flash-eco      x0.27      $0.19    9.4%    $0.00    $0.19      59
credits = list-price $ x the model's multiplier, cache reads included …
57 of 3198 turns price cache reads at the model's input rate; no published cache rate for that model.
```

```
$ timeout 120 oduse -1 --no-wallet --infer-anniversary | head -2
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: subscription anniversary (inferred) · ends 2026-12-16 · 3.2K requests · $2.03 credits · 8.1M in / 802.8K out tokens
```

Anniversary day **16** — `ends 2026-12-16` — not 19. Correct.

```
$ cmduse -1 --json | head -c 200
{"error":null,"fiveHour":{"cap":14.0,"exceeded":false,"resetAt":0.0,"used":0.0},"freeCredits":0.0,"monthlyCap":70.0,"monthlyCredits":20.5393069279,"periodEnd":"2026-12-05","periodEndAt":1796447625000.…
```

```
$ mpc --json --od-plan go --shape off | head -c 200
{
  "workloads": {
    "oc-go": { "input": 800, "cacheRead": 50000, "output": 200, "reasoning": 0, "cacheWrite": 0 },
    …
```

and the OpenDesign half of `mpc` resolves against the new catalogue — 14 of 83 rows carry `od`:

```
plans: oc-go,cc,od  rows: 83  rows with od: 14
{"provider":"od","plan":"Go","pricing":{"input":0.1,"output":0.5,"cacheRead":0.01,"cacheWrite":0.125},"allowance":55,"costPerRequest":0.00068,"requestsPerMonth":80882.35…}
```

## 7. What did not go to plan

- **The tag already existed.** `cmduse-v0.8.2` was created and pushed before this pass, so `git tag` refused and `git push` was a no-op. It already pointed at `ee61977`, the gated commit, so the run is the right one; nothing was retagged or rewritten.
- **The tap PR was merged by the user, not by me.** The brief said open it and stop. It was merged 30 s later by `JeffreyJYZ`. PR #25 remains open and is superseded by `e693a49`.
- **`--rows 3` printed no `… N more` tail** — see above; the cap is correct, the expectation was one row off because the 60-day window holds only three non-empty days.
- **`verify-crate.ts` needs its formula path.** Run plainly it exits 2 with `no formula path: pass --formula <path> or set FORMULA_PATH/CMDUSE_FORMULA_PATH`; run again with `--formula` it verifies crate ⇄ assets ⇄ tap pins.
- **`brew` reports `cmdusedev`/`ocusedev` shadowed by `/Users/jyz/dev/bin`.** That is the repo's own dev-twin link dir, expected and unrelated to this release; the `Cellar` binaries are the 0.8.2 build.

## 8. Result

`cmduse`, `ocuse`, `arkuse` and `oduse` on this machine are **0.8.2**, installed from the Homebrew tap, whose formula pins the `cmduse-v0.8.2` release and installs all eight binaries. The OpenDesign sidebar's data is no longer zeros: `oduse -1` reads ~3.2K requests and ~$2.03 of the $220 monthly pool, with the anniversary inferred as the 16th.
