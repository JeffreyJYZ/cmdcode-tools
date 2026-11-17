# Lane brief — oduse must count OpenCode turns

P0 correctness bug in `~/dev/cmdcode-tools`, binary `oduse` (0.8.0 on `main`). The user's sidebar reports **0.0%** of his OpenDesign Go allowance while he has in fact spent a lot. Prove the cause, then fix it.

## Measured on his machine

`~/.local/share/opencode/opencode.db`, table `session_message`, `type='assistant'`, grouped by `json_extract(data,'$.model.providerID')`:

```
open-design        deepseek-v4.1-flash        turns=1     in=92048    out=2
open-design        deepseek-v4.1-flash-eco    turns=1     in=92309    out=3
open-design-tmp    deepseek-v4.1-flash        turns=1287  in=3995226  out=325445
open-design-tmp    deepseek-v4.1-flash-eco    turns=59    in=318731   out=14388
```

`oduse -1 --no-wallet` says `0 requests · $0.00 credits` and `oduse daily` shows one turn dated 2026-10-19, because `cmduse/src/oduse/db.rs` reads **only** the desktop app's store (`~/Library/Application Support/Open Design/namespaces/*/data/app.sqlite`). The OpenDesign models are actually being used through **OpenCode**, so 1348 turns are invisible and every meter reads zero.

## Fix it the way the siblings already do

Read `cmduse/src/stores.rs` and how `ocuse` reads `opencode.db`; reuse that reader instead of writing a second one.

1. Add `opencode.db` as a source, filtered to providers whose id starts with `open-design` (today both `open-design` and the hand-written `open-design-tmp` exist; a future rename must not silently drop turns).
2. Read the per-turn fields the way `ocuse` does — `data.tokens.input`, `.output`, `.cache.read`, `.cache.write`, model id, timestamp. **Cache tokens exist here** even though the app store lacks them: price cache reads from `core/od.json` when a rate exists, and say in the header/footnote which sources were read, the way `ocuse` names `clients`.
3. Keep the app store working: both sources feed the same rows, deduplicated by nothing (they are different turns) and labelled by source. A missing `opencode.db` must degrade to the app store alone with a one-line reason, never an error.
4. The desktop store's records have no cost; OpenCode's have `cost` recorded. Prefer a recorded cost when present, else price from `core/od.json` counter times the model's multiplier — same rule `ocuse` uses for its own local half. State the rule in one comment.
5. Add `--db`/`OD_DB` behaviour for the second store too (e.g. `OD_OPENCODE_DB`), and document the pair in `cmduse/README.md` + `cmduse/cmduse.1`.
6. Tests: a fixture `opencode.db` with the two provider spellings and one turn each, proving the total is non-zero and both are counted; one proving an absent second store still renders the app-store rows; one proving a provider rename matches by prefix.

## Prove it on the real machine

Before and after, quote numbers:

```
oduse -1 --no-wallet | head -6
oduse daily --days 60 --no-wallet | head -4
oduse model --window all --no-wallet
```

Before: `0 requests · $0.00 credits`. After: 1348 turns, and the credit figure must trace to real tokens (a rough hand-check: ~4.3M input + ~340k output on DeepSeek V4.1 Flash at list rate × 0.5 multiplier is a few dollars, not zero — say what you get and why).

Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.

## Rules

Own `cmduse/src/oduse/**`, `cmduse/src/stores.rs` if the shared reader needs a hook, and the docs. Do not touch `opencode-plugin/` (another lane is on the sidebar there), root `AGENTS.md`, `core/od.json` caps, or the published binaries. `rg`, `fd`, `sd`, no Python, no agent-desktop, bound any TUI with `timeout`, files under 200 lines. No commit, push, branch or stash; leave the tree dirty on `main`. One turn: batch independent calls, gates in the foreground inside the same call.

Report: the cause with its file:line, the fix, the before/after command output on his real store, the gate lines, and anything deliberately left.
