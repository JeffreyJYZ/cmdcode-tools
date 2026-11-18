# Release report — cmduse 0.8.3

Brief: `docs/plan/opendesign/briefs/release-0.8.3.md`. It did not exist at the start of this pass;
written from the dispatch message before work began. Executed 2026-11-17. Tree `main` at
`6dedfc56150f301741a199c7ac760e5c866a29d3`; all three tags point at that commit.

## 1. Tag runs — none red

Matched by `headBranch`, not "latest run":

| tag | workflow | run | jobs | verdict |
| --- | --- | --- | --- | --- |
| `cmduse-v0.8.3` | `release.yml` | `44063234443` | six targets + `release` + `verify` (8) | `success` |
| `plugin-v0.5.35` | `npm-plugin.yml` | `44063235175` | `publish` | `success` |
| `mpc-v0.1.13` | `npm-plugin.yml` | `44063234689` | `publish` | `success` |

```
$ gh run view 44063234443 --json conclusion,jobs --jq '...'
{"conclusion":"success","jobs":[{"name":"aarch64-apple-darwin","conclusion":"success"}, ... 8 jobs all success]}
```

One `gh run watch` for the release run died `failed to get run ... EOF` (network, not a verdict);
the run was re-queried and then re-watched to completion. No tag was touched before all three
were confirmed green.

## 2. `cmduse-v0.8.3` — archive and crate

`gh release view cmduse-v0.8.3 --json assets --jq '.assets[].name'` → six tarballs + `SHA256SUMS`.
Downloaded the macOS arm64 asset and listed it — **eight** binaries:

```
./arkuse  ./arkusedev  ./cmduse  ./cmdusedev  ./ocuse  ./ocusedev  ./oduse  ./odusedev
```

(plus `./cmduse.1`, `./LICENSE-MIT`, `./`).

The brief's parenthetical "the tag publishes the crate" is false, as in 0.8.2. Before publishing:

```
$ cargo search cmd-usage --limit 1
cmd-usage = "0.8.2"    # Live Command Code (commandcode.ai) usage dashboard: ...
```

So `cargo publish -p cmd-usage` was needed and run:

```
   Packaging cmd-usage v0.8.3 ...   Packaged 109 files, 978.3KiB
   Verifying cmd-usage v0.8.3 ...   Finished `dev` profile in 8.07s
   Uploaded cmd-usage v0.8.3 to registry `crates-io`
   Published cmd-usage v0.8.3 at registry `crates-io`

$ cargo search cmd-usage --limit 1
cmd-usage = "0.8.3"    # Live Command Code (commandcode.ai) usage dashboard: ...
```

## 3. Tap

`scripts/bump-tap.sh cmduse-v0.8.3 …/Formula/cmduse.rb` repinned four assets off the release's
own `SHA256SUMS`:

```
aarch64-apple-darwin             3345c1c7d65a -> 807f7a18e538
x86_64-apple-darwin              73d8edbe3f3f -> a7668aa2a27e
aarch64-unknown-linux-musl       e494da9836d2 -> ee5cac5fcc76
x86_64-unknown-linux-musl        ac34dfaced63 -> 48c8225483c9
```

Branch `cmduse-0.8.3`, commit `c736476`, pushed over HTTPS as `jyzbot` with
`GIT_ASKPASS=$TMPDIR/tap-askpass.sh`. Formula kept the eight-binary `bin.install` line. Opened
**PR #29** — https://github.com/JeffreyJYZ/homebrew-tap/pull/29 — and merged it with
`pr-land 29` (owner token approves and squash-merges).

```
$ gh pr view 29 --repo JeffreyJYZ/homebrew-tap --json state,mergeCommit
{"state":"MERGED","mergeCommit":{"oid":"88242467d6827e177456e7b083efbe90861c7855"}}
$ gh api repos/JeffreyJYZ/homebrew-tap/issues/29/timeline ...
JeffreyJYZ 88242467d6827e177456e7b083efbe90861c7855
```

**Merge sha: `8824246`.** GitHub `main` head is `33834b1` ("cmduse 0.8.3: pin the new assets",
46 s later), a child of `8824246` with an identical tree (`git diff --stat 8824246 33834b1`
empty). Nothing was amended or force-pushed.

## 4. Install and prove

`brew update && brew upgrade cmduse`: `jeffreyjyz/tap/cmduse 0.8.2 -> 0.8.3`, installed to
`/opt/homebrew/Cellar/cmduse/0.8.3`. Homebrew warns `cmdusedev`/`ocusedev` are shadowed by
`/Users/jyz/dev/bin` — the repo's dev twins, unrelated.

```
$ for b in cmduse ocuse arkuse oduse; do /opt/homebrew/bin/$b -V; done
cmduse: cmduse 0.8.3
ocuse: ocuse 0.8.3
arkuse: arkuse 0.8.3
oduse: oduse 0.8.3
$ ls -1 /opt/homebrew/Cellar/cmduse/0.8.3/bin
arkuse arkusedev cmduse cmdusedev ocuse ocusedev oduse odusedev
```

Caps proof — required line present:

```
$ timeout 120 /opt/homebrew/bin/oduse -1 --no-wallet | head -8
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: calendar month · ends 2026-12-01 · 7.2K requests · $4.15 credits · 13.1M in / 1.7M out tokens

DESIGN Go $220.00/month · $55.00/week · $18.00/5h · 10 concurrent (per model: Flash $120.00/mo; Eco $220.00/mo)
  5-hour   $1.75 · 17.5% of $10.00 (Flash caps; Eco would be $18.00) · rolling 5h
  Weekly   $4.15 · 13.8% of $30.00 (Flash caps; Eco would be $55.00) · rolling 7d
  Monthly  $4.15 · 3.5% of $120.00 (Flash caps; Eco would be $220.00) · ends 2026-12-01 · no period anchor
```

`timeout 120 /opt/homebrew/bin/oduse plans --json` carries the cap set on the Go plan:

```
.plans.0.capOverrides = [{"fiveHourUsd":10,"id":"flash","label":"Flash",
  "models":["deepseek-v4.1-flash"],"monthlyUsd":120,"weeklyUsd":30}]
.plans.0.defaultCapLabel = "Eco"
```

The installed `mpc` was **0.1.12** and failed (`no model table parsed ...`). Upgraded with
`bun install -g @jeffreyjyz/mpc@0.1.13`; it ends `Failed to install 1 package` on the `mpcdev`
dev-twin symlink (EEXIST, expected) but the real global install landed and `mpc --version`
reads `mpc/0.1.13`. Proof:

```
$ timeout 120 mpc --json --od-plan go --shape off
rows: 81   od rows: 14
deepseekv41flash        od.allowance=120
deepseekv41flasheco     od.allowance=220
(other 12 od rows)      od.allowance=220
```

Flash `120`, Eco `220`, confirmed. **Discrepancy:** the brief said "80 rows"; the live catalogue
produces **81** rows (14 carry `od`). No filter was applied; the count is what the released mpc
prints.

## 5. Plugin

```
$ bun pm view @jeffreyjyz/opencode-command-code version
0.5.35
$ rg -n 'opencode-command-code' ~/.config/opencode/opencode.json
127:  "@jeffreyjyz/opencode-command-code@0.5.35",
```

Pin moved `0.5.33` → `0.5.35` in `~/.config/opencode/opencode.json`; no
`~/.cache/opencode/npm/@jeffreyjyz/opencode-command-code@0.5.35` directory existed, so nothing
was deleted. Config parses (`bun -e JSON.parse(...)` → `plugin pins:
["@jeffreyjyz/opencode-command-code@0.5.35"]`). opencode was **not** restarted.

## 6. Result

All three tags green. Crate `cmd-usage 0.8.3` published; tap PR #29 merged (`8824246`); four
Homebrew binaries at 0.8.3; oduse reports the Flash cap set with `no period anchor`; mpc reports
Flash 120 / Eco 220. Plugin pin at 0.5.35, no restart. Nothing red, nothing force-pushed.
