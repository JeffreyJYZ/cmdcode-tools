# Lane I — docs describe four binaries

Files touched: `cmduse/README.md`, `cmduse/cmduse.1` only. No commit, no push, no worktree.

## Sibling mention counts (lines containing the name, `rg -c -i`)

| File            | ocuse before/after | arkuse before/after | oduse before/after |
| --------------- | ------------------ | ------------------- | ------------------ |
| `README.md`     | 24 / 25            | 20 / 21             | 18 / 19            |
| `cmduse.1`      | 38 / 38            | 31 / 31             | 26 / 26            |

README gained one line per sibling: the Zed `context_servers` example now registers all four MCP readers instead of only `cmduse`. The `--rows` parity sentence deliberately names no binary, so it does not move these counts. Man-page name counts are unchanged; the fix was structural, not prose.

## `.SH` list before

NAME, SYNOPSIS, DESCRIPTION, EXIT STATUS, SUBCOMMANDS, OPTIONS, THE LIVE DASHBOARD, PLAN TABLE, STATUSLINE, API ENDPOINTS, FILES, ENVIRONMENT, EXAMPLES, BUGS / NOTES, OCUSE, ODUSE, SEE ALSO.

Arkuse content existed only as `.SS arkuse`, nested under `.SH OCUSE`. `SEE ALSO` pointed at `.BR ARKUSE`, a section that did not exist.

## `.SH` list after

NAME, SYNOPSIS, DESCRIPTION, EXIT STATUS, SUBCOMMANDS, OPTIONS, THE LIVE DASHBOARD, PLAN TABLE, STATUSLINE, API ENDPOINTS, FILES, ENVIRONMENT, EXAMPLES, BUGS / NOTES, OCUSE, **ARKUSE**, ODUSE, SEE ALSO.

`.SS arkuse` promoted to `.SH ARKUSE` (line 932); its own `.SS arkuse synopsis/commands/options/data and windows/files` subsections now nest under it, matching the OCUSE and ODUSE shape. `SEE ALSO`'s `.BR ARKUSE` now resolves. `mandoc -Tascii cmduse/cmduse.1 | col -b` renders OCUSE (555), ARKUSE (826), ODUSE (949) as peer headings.

## Stale claims deleted / fixed, with reason

- Man `.TH` source `cmd-usage 0.8.3` → `cmd-usage`. Reason: hardcoded version in the shipped doc; the crates.io badge is the version carrier, and a literal goes stale on every release.
- Man ocuse watch frame "a frame redrawn in place every 10 seconds" → "every 5 seconds". Reason: `cmduse/src/config.rs:26` sets `interval_secs: 5`; README and the other three binaries all say 5s. The 10s line was residue from the old per-binary interval drift.
- Man `.TH` date `2026-10` → `2026-11-18`. Reason: mandoc warned `cannot parse date, using it verbatim`; a full ISO date parses. A date, not a version.
- Man `tools \(` / `model \)` (lines 179/180, 915, 1020) → literal `(` / `)`. Reason: `\(` is a roff special-character escape; `\(` + space is incomplete, and mandoc reported `ERROR: incomplete escape sequence`.
- Man line 471 `. Unknown placeholders ...` → dropped the leading dot. Reason: a line beginning with `.` is parsed as a macro; mandoc reported `ERROR: skipping unknown macro`.

No version-number string remains in either file. All 12 README fence openings are language-tagged.

## Verification against the binaries

- `./target/debug/arkuse --help`: confirms `--plan <id>`, `--profile <name>`, `--no-api`, `--db <path>`, `--window <w>`, `--period-start <date>`, `--infer-anniversary`, `--gated`, `--since`, `--tz`, `--rows`, `--json`, `--csv`, `--plain`, `--interval`, `--bar-width`, `--bursts`, `--once`, `--watch`, `--dismiss-update`, `--version`, `--help`. Every flag named in the promoted `.SH ARKUSE` exists.
- `--rows <n>` present on all four binaries. Config keys in each binary's section match the shared set; `arkcli usage plan`, `$ARKUSE_PROFILE`/first `agent-plan` profile, per-window `notify_on_cap`, and the `agent-plan` provider filter were checked in `cmduse/src/arkuse/{api,cli,db,window}.rs`.

## Gates

- `cd website && bun test` — 84 pass, 0 fail, exit 0 (includes `readmes.test.ts`, so skeleton and fences are pinned).
- `cargo test` — all suites pass, exit 0.
- `mandoc -Tlint cmduse/cmduse.1` — no `ERROR` or `WARNING`; only pre-existing `STYLE` line-length notices (exit 1 is style-only). `mandoc -Tascii` renders all three sibling sections as peers.
