# Lane G — parity harness report

## Shape and why

Built `scripts/check-parity.ts` (Bun), wired as root `bun parity`. Chose a Bun script over a Rust integration test because the check must skip cleanly when no binary is installed: CI has none installed, and a Rust test would need a guard that silently passes without ever checking. The script resolves each binary in order: `$<BIN>_BIN`, then `target/debug/<bin>dev`, then `<bin>dev` on PATH, then `<bin>` on PATH. An explicit `_BIN` override that does not exist means SKIP, not fallback to another build. If any of the four is unresolved or cannot print `--help`, it prints `SKIP` and exits 0.

It extracts long flags from `--help`, computes each flag's exact present set, and requires either all four binaries or an `ALLOW` entry carrying a non-empty `reason` string. Failures name the exact flag and binary. It also rejects an undeclared difference, a stale entry (flag now universal or absent everywhere), a duplicate entry, and an entry with no reason. Matrix and reasons print on every run.

Existing Rust coverage is one-directional (cmduse help tokens must appear in ocuse and arkuse; oduse is never checked, and extra flags are never checked), so this check complements rather than duplicates it. Subcommands, MCP tools, report envelopes and `statusline --json` keys are already asserted elsewhere and were not re-derived.

## Verdict on the current tree

`bun parity` against the current `target/debug/*dev` builds: **PASS** — 4 binaries, 28 long flags, 11 allowed differences, 0 undeclared.

```
flag                  cmduse ocuse  arkuse oduse
--bar-width           yes    yes    yes    yes
--bursts              yes    yes    yes    yes
--csv                 yes    yes    yes    yes
--days                yes    yes    yes    yes
--db                  -      yes    yes    yes     allow
--dismiss-update      yes    yes    yes    yes
--gated               yes    yes    yes    -       allow
--help                yes    yes    yes    yes
--hours               yes    yes    yes    yes
--infer-anniversary   -      yes    yes    yes     allow
--interval            yes    yes    yes    yes
--json                yes    yes    yes    yes
--last                yes    yes    yes    yes
--local               yes    -      -      -       allow
--no-api              -      yes    yes    -       allow
--no-wallet           -      -      -      yes     allow
--once                yes    yes    yes    yes
--period-start        -      yes    yes    yes     allow
--plain               yes    yes    yes    yes
--plan                -      yes    yes    yes     allow
--profile             -      -      yes    -       allow
--rows                yes    yes    yes    yes
--session-cookie      -      -      -      yes     allow
--since               yes    yes    yes    yes
--tz                  yes    yes    yes    yes
--version             yes    yes    yes    yes
--watch               yes    yes    yes    yes
--window              -      yes    yes    yes     allow
```

## Each difference decided on the record

No difference was closed by a source edit. Every one is source-forced by the parity rule's own exception list in root `AGENTS.md` and by the parser comments in `cmduse/src/cli.rs`; adding a flag to make the matrix uniform would invent a capability the source cannot carry. Nothing here is a defect.

| flag | present on | verdict | reason |
| --- | --- | --- | --- |
| `--local` | cmduse | source | cmduse alone reads the Command Code account API beside local logs; this is the account-vs-logs cut. Other sources have no second store to switch to. |
| `--gated` | cmduse, ocuse, arkuse | source | OpenDesign prices models per plan but never restricts which ones a plan may call; a gate filter there would invent a restriction the source does not have (parser rejects it for oduse). The brief suspected drift; the record says otherwise. |
| `--db` | ocuse, arkuse, oduse | source | Only those three point a local store at the tool (opencode.db / the app's sqlite). cmduse's local source is `~/.commandcode/projects`, so a `--db` path has nothing to select. Brief suspected drift; the record says otherwise. |
| `--no-api` | ocuse, arkuse | source | These two skip their own remote meter (Go usage endpoint / arkcli). cmduse's equivalent skip is `--local`; oduse's remote route is the wallet (`--no-wallet`). |
| `--no-wallet` | oduse | source | Only oduse has the OpenDesign local wallet daemon as a meter; no other binary has that listener to skip. |
| `--session-cookie` | oduse | source | Only oduse reaches the OpenDesign account API with a user-supplied console session cookie (0600 file / `$OD_SESSION`); no other source needs that credential. Found on this tree, not in the brief's matrix. |
| `--plan` | ocuse, arkuse, oduse | source | Names which plan's limits to measure against for sources that cannot report it themselves. cmduse's plan comes from its own account. |
| `--profile` | arkuse | source | arkcli control-plane profile; only ARK reads the plan meters through arkcli. |
| `--window` | ocuse, arkuse, oduse | source | Local stores need their report cut (month / all / `<n>d`) chosen here; cmduse's account API hands its period back and its reports use `--days`/`--since`. Brief suspected drift; the record says otherwise. |
| `--period-start` | ocuse, arkuse, oduse | source | Pins a local store's billing period; cmduse gets its period from the account API, so there is nothing to pin. Brief suspected drift; the record says otherwise. |
| `--infer-anniversary` | ocuse, arkuse, oduse | source | Infers a missing period start from the first local request; cmduse has no local period to infer because the account API supplies it. Brief suspected drift; the record says otherwise. |

Note: the stale homebrew `arkusedev`/`odusedev` on PATH do not advertise `--session-cookie`; the current `target/debug` builds do. The resolution order puts repo dev builds ahead of PATH twins so the check reflects the tree under test, not an older installed build.

## Harness bites: mutation evidence

1. Blanked the `reason` on the `--gated` allow-list entry. `bun parity` exited **1** with: `allow-list entry --gated has no reason (every difference needs one)`.
2. Restored the reason, then removed `cmduse` from `--gated`'s expected set. `bun parity` exited **1** with: `--gated: extra on cmduse (not declared; reason: OpenDesign prices models per plan but never restricts which ones a plan may call, so a gate filter there would invent a restriction the source does not have (the parser rejects it for oduse).)`.
3. Restored the entry. `bun parity` exited **0** with `PASS parity check: 4 binaries, 28 flags, 11 allowed differences`.

Skip path: `CMDUSE_BIN=/definitely/not/here bun parity` printed `SKIP parity check: cmduse: no binary found ...` and exited **0**.

## Gates (foreground, waited)

```
bun fmt --check scripts/check-parity.ts   0
bun check scripts/check-parity.ts         0
bun parity                                0  PASS (see above)
cargo test                                0
cargo fmt --all -- --check                0
cargo clippy --all-targets -- -D warnings 0
```

## Files touched

- `scripts/check-parity.ts` (new)
- `package.json` — one `parity` script entry
- `AGENTS.md` — one line in the Build & test block plus a short explanation
- this report

No source flag changes, no commits, no pushes, no CI changes.
