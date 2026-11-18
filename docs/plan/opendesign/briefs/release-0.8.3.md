# Release — cmduse 0.8.3 to the user's machine

Three tags are **already pushed**: `cmduse-v0.8.3`, `plugin-v0.5.35`, `mpc-v0.1.13`.
`main` at `6dedfc5` (`feat(plugin): divide each OpenDesign window by the cap set that spent it`), tree clean.

What shipped:

- `oduse` per-model OpenDesign caps (Go Flash 120/30/10 vs Eco 220/55/18, stricter-wins with the
  alternative named, `capPicks`/`capOverrides` JSON, elapsed share from the period or
  `no period anchor`).
- `mpc` per-model caps in its third column and a scraper repointed to `/zen/go/v1/models`
  (mpc was exiting 1 on every invocation before this).
- The sidebar dividing each window by the cap set that spent it.

Do, in order, reporting each result:

1. **Flag any tag whose run is red** before touching the tap — `gh run list --workflow release.yml`
   and `--workflow npm-plugin.yml`, matched by `headBranch` to each tag.
2. **`cmduse-v0.8.3`**: confirm the run is green, the archive lists eight binaries, and
   `cargo publish -p cmd-usage` is either already done by the tag (it is — the tag publishes) or
   needed. `cargo search cmd-usage --limit 1` tells you which.
3. **Tap**: `scripts/bump-tap.sh cmduse-v0.8.3 <formula path>` in
   `/opt/homebrew/Library/Taps/jeffreyjyz/homebrew-tap`, branch, commit, push over HTTPS with
   `$TMPDIR/tap-askpass.sh`, open the PR as jyzbot, and merge it via the GitHub API with the owner
   token (`gh auth token --user JeffreyJYZ`,
   `PUT /repos/JeffreyJYZ/homebrew-tap/pulls/<n>/merge` with squash) if it is blocked on review —
   `pr-land` approves and merges with the owner token, so try that first.
4. **Install and prove**: `brew update && brew upgrade cmduse`, then quote output for
   `/opt/homebrew/bin/{cmduse,ocuse,arkuse,oduse} -V`, `oduse -1 --no-wallet | head -8` (must show
   `$120.00 (Flash caps; Eco would be $220.00)` and `no period anchor`), `oduse plans --json`
   carrying `capOverrides`, and `mpc --json --od-plan go --shape off` showing Flash `120` and Eco
   `220` with 80 rows.
5. **Plugin**: `bun pm view @jeffreyjyz/opencode-command-code version` must read 0.5.35, then bump
   the pin in `~/.config/opencode/opencode.json` from its current version to `0.5.35`, delete
   `~/.cache/opencode/npm/@jeffreyjyz/opencode-command-code@0.5.35` if present, and confirm the
   config still parses. Do not restart opencode.
6. Report to `docs/plan/opendesign/reports/release-0.8.3.md`, and in the reply under 20 lines:
   each tag's conclusion, the tap PR number and merge sha, the four installed versions, and the
   caps proof line.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, bound every TUI with `timeout`, never
amend or force-push, and run every CI watch with `background: true`.
