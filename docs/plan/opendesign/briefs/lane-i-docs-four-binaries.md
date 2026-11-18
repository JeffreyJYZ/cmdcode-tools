# Lane I — the docs must describe four binaries, not one plus three footnotes

## Why this exists

`cmduse/README.md` and `cmduse/cmduse.1` are the shipped documentation for *four* binaries (`cmduse`, `ocuse`, `arkuse`, `oduse`), all built from the same crate. Measured on the current tree:

```
cmduse/README.md   mentions oduse|arkuse|ocuse on 54 lines
cmduse/cmduse.1    mentions them on 83 lines
```

Both were written when there were one or two. `cmduse.1` has `.SH OCUSE` and `.SH ODUSE` sections but **no `.SH ARKUSE`** — the third sibling is documented only by mention. That is the documentation half of the same parity defect the code lanes are closing, and it is the half a user actually hits.

## The authoritative reference

1. Root `AGENTS.md`, the documentation conventions: README is the canonical docs page; the required section skeleton; every fence language-tagged; **no hardcoded version in prose**.
2. `cmduse/README.md` itself — read the whole thing before editing; it is long and has a structure you must preserve, not reorganise.
3. `cmduse/cmduse.1` — same. Note its existing `.SH OCUSE` / `.SH ODUSE` sections and copy their shape.

## What to build

1. **Add the missing `.SH ARKUSE` to `cmduse/cmduse.1`**, structurally identical to `.SH OCUSE` and `.SH ODUSE`: what it measures (AFP, not dollars), its extra flags (`--plan`, `--profile`, `--no-api`, `--db`, `--window`, `--period-start`, `--infer-anniversary`), and its distinguishing behaviour (the meter comes from `arkcli usage plan`, the local figure is labelled, notify fires per window because ARK limits the plan not a model). Every flag you name must be one the binary actually accepts — verify with `./target/debug/arkuse --help`.
2. **Make the README's per-binary coverage symmetric.** Find every place it treats `ocuse` and `oduse` specially and check whether `arkuse` gets the same treatment — statusline keys, the MCP tool list, `--rows`, the `--json` envelopes, the notify behaviour, `--config` keys. Where one of the four is described and the others are not, either describe all four or name why the difference is source-forced (and "the source has no such cut" is a reason; "I ran out of room" is not).
3. **Verify every claim against the code, not against the prose's own confidence.** Any path, flag, key or figure you keep in the docs must exist in the binary: `rg` for the flag in the arg parser, run `--help`, or read the emitter. Delete a stale claim rather than softening it — a doc sentence describing behaviour the code no longer has is a defect, and lane A already found one such footer.
4. **No version numbers in prose.** The badge carries it. If you find a hardcoded version anywhere in either file, replace it with the badge or remove it, and say where it was.
5. **Every code fence stays language-tagged.** The structure test fails on an untagged fence; run it (see gate) rather than eyeballing.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. Leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `cmduse/README.md` and `cmduse/cmduse.1`. Nothing else — no source file, no test, no other doc. Five sibling lanes own the code, and `website/` derives from the README but has its own manifest a different lane would own.
- Gate before you report:
  - `cd website && bun test` — this includes `readmes.test.ts`, which pins the README structure and will catch an untagged fence or a broken skeleton.
  - `cargo test` — the crate has its own doc/fence assertions in some places.
  - `man ./cmduse.1 | head -40` (or `mandoc -Tlint cmduse/cmduse.1`) to prove the man page still renders — a malformed `.SH` breaks it silently.
  All foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-i-docs-four-binaries.md`. Include the before/after count of lines mentioning each sibling, the `.SH` list before and after, and every stale claim you deleted with the reason. Final chat reply under 15 lines.
