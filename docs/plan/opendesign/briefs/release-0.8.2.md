# Release — cmduse 0.8.2 to the user's machine

Branch/state: `main` at `ee61977`, tree clean apart from untracked `docs/plan/`.
`cmduse/Cargo.toml` is `0.8.2`, `cmduse-core` is `2.3.0` (already on crates.io). `main` CI is green.
The user's installed binaries are **0.8.0**, so the OpenDesign sidebar still shows stale figures.

You are authorised to tag, publish and bump the tap **for this release only**. Do not publish any other crate, do not touch `opencode-plugin/`, never amend or force-push.

## Steps

1. **Confirm the tree you are tagging is the gated one.** `git log --oneline -3`, `cargo test` (expect 292 passing), `cargo fmt --all -- --check`, and `cargo package -p cmd-usage --allow-dirty` (must verify). Quote each line.
2. **Tag and push:** `git tag cmduse-v0.8.2 && git push origin cmduse-v0.8.2`. The tag does **not** publish the crate — that is step 4.
3. **Watch the tag's own run**, not "the latest run": `gh run list --workflow release.yml --limit 5 --json headBranch,databaseId,status,conclusion` then `gh run watch <id> --exit-status` on the one whose `headBranch` is `cmduse-v0.8.2`. Report the six target conclusions and confirm the archive holds **eight** binaries (`gh release view cmduse-v0.8.2 --json assets`, download one macOS arm64 asset, untar, list).
4. **Publish the crate:** `cargo publish -p cmd-usage`. Then confirm with `cargo search cmd-usage --limit 1` that 0.8.2 is the index version.
5. **Tap:** `scripts/bump-tap.sh cmduse-v0.8.2 /opt/homebrew/Library/Taps/jeffreyjyz/homebrew-tap/Formula/cmduse.rb`. That checkout is `JeffreyJYZ/homebrew-tap`; tap PR #25 ("cmduse 0.8.0: install all eight binaries") is still open, and the formula must install all eight names or `oduse` will not arrive. If #25 is unmerged, branch from it (or include its `bin.install` line) so the bump alone does not regress to six. Open the tap PR as `jyzbot` over HTTPS with `GIT_ASKPASS=$TMPDIR/tap-askpass.sh` (`printf '#!/bin/sh\nprintf "%%s\\n" "$(gh auth token --user jyzbot)"\n'`, mode 700). Do **not** merge the tap PR — say it is ready.
6. **Install and prove:** `brew update && brew upgrade cmduse`, then confirm `/opt/homebrew/bin/{cmduse,ocuse,arkuse,oduse} -V` all read the new version and that `ls /opt/homebrew/Cellar/cmduse/*/bin` lists eight binaries. Then run, quoting output:
   - `timeout 120 oduse -1 --no-wallet | head -8` — must show ~2.4K requests and a few dollars of credits, **not** `0 requests · $0.00`.
   - `timeout 120 oduse daily --days 60 --no-wallet --rows 3` — must show the `… N more` tail.
   - `timeout 120 oduse model --window all --no-wallet | head -6`.
   - `timeout 120 oduse -1 --no-wallet --infer-anniversary | head -2` — anniversary day 16, not 19.
   - `cmduse -1 --json | head -c 200` and `mpc --json --od-plan go --shape off | head -c 200` to show the siblings still work after the upgrade.
7. **Report** to `/Users/jyz/dev/cmdcode-tools/docs/plan/opendesign/reports/release-0.8.2.md`: tag sha, run id and conclusions, crate index line, tap PR URL and whether it merges the eight-binary line, the installed versions, and every proof command with its output. Name anything that failed rather than smoothing it over.
