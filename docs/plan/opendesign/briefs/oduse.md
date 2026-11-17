# Lane B — `oduse`: OpenDesign usage binary

Read `/Users/jyz/dev/cmdcode-tools/AGENTS.md` and `cmduse/` plus one existing sibling (`cmduse/src/ocuse/`) before writing anything. Work only inside `cmduse/`, `core/` and `scripts/`. Another lane owns `oc-cmd-compare/` — do not touch it, and do not edit the root `AGENTS.md`; report the lines it needs instead.

## Goal

A fourth binary next to `cmduse`, `ocuse`, `arkuse`: `oduse` (+ dev twin `odusedev`), measuring an OpenDesign (open-design.ai) subscription. Same CLI surface, same machine-readable contracts, same MCP tool set, same watch loop, same config/notify/statusline/update-check. Only what the source forces may differ, and each such difference gets a code comment naming the reason.

## The only data source that exists today

`~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite` — the desktop app's own store, read-only. Verified shape:

- `messages(id, conversation_id, role, created_at, events_json, run_status, agent_id, ended_at)`
- `conversations(id, project_id, title, session_mode, created_at)`
- `projects(id, name, created_at)`
- `agent_sessions(conversation_id, model, last_input_tokens, updated_at)`

For an assistant message, `events_json` is an array carrying exactly two useful events:

```
{"kind":"status","label":"model","detail":"deepseek-v4.1-flash"}
{"kind":"usage","inputTokens":30892,"outputTokens":147,"durationMs":11086}
```

`created_at` is epoch milliseconds. Usage events carry **no cache-read or cache-write tokens** — that understates cost for cache-heavy work, so label the figure as an estimate and say why in the docs (one clause, not a paragraph).

Path override env var `OD_DB` (name it like the siblings' overrides) and a `--db` flag, because the namespace directory is version-suffixed (`release-stable` today, could change).

## Plan model (`core/od.json`, consumed only by oduse)

| plan | monthly price | monthly max | 7-day | 5-hour | plan-model credits | concurrency |
|---|---|---|---|---|---|---|
| go | $10 | $220 | $55 | $18 | $0 | 10 |
| plus | $20 | $310 | $74 | — | $20 | 20 |
| pro | $100 | $480 | $90 | — | $120 | 30 |
| max | $200 | $900 | $150 | — | $300 | 50 |

- Only Design Plan credits have the 5-hour and 7-day windows; the 7-day window resets from subscription start, not Monday.
- Credit multiplier per model (credits = dollar value of usage x multiplier): DeepSeek V4.1 Flash 0.5, Eco 0.27, MiniMax M3.1 Flash / MiMo V2.6 Flash / MiMo V2.6 Pro / Hy4 Preview / DeepSeek V4 Flash / DeepSeek V4 Flash Vision Exp / DeepSeek V4 Pro / GLM-5.3 Flash / Kimi K2.7 Code 1, GLM-5.3 Flash-X 2, Claude Haiku 5.5 2, GPT-6 Luna 4.
- Token rates per model per 1M (input/output) belong in the same JSON, seeded from the rates the repo already carries where a model is shared, and every figure the plan page does not publish is labelled an estimate.

## Surface (parity with the other three)

Default dashboard, `-1`, `--json`, `--csv`, `daily`, `hourly`, `model`, `session`, `plans`, `statusline`, `mcp`, `notify`, `config`, `--plan`, `--period-start`, `--rows`, `--tz`, watch loop with the documented frame redraw. The seven MCP tools (`usage`, `plans`, `models`, `daily`, `hourly`, `session`, `model`) with the same arguments per tool, pinned by the same sorted-set test the siblings use. Report envelopes reuse `REPORT_*_KEYS` and the same key names (`daily`/`hourly` `{scope, source, total, days|hours}`, `model` `{scope, source, since, sinceMs, models}`, `session` both `sessions` and `projects`, `source` naming where rows came from). Statusline keys `fiveHourSpent`/`fiveHourCap`/`weeklySpent`/`weeklyCap`/`monthSpent`/`monthCap`.

A window with no published cap (Pro/Max 5-hour, plan-model credits) prints as absent, never as zero.

## Also

- Bins `oduse`/`odusedev` in `cmduse/Cargo.toml` + thin entry points like the siblings.
- `scripts/bump-tap.sh`-facing binary list and the release workflow's `BINS` env are defined once — add the new name where the existing comment says it is defined once.
- README section, `cmduse/cmduse.1` man page, and this package's docs move in the same change.
- Tests hermetic: build a temp sqlite fixture in the test, no dependency on this machine's app store, and cover a missing DB (clean error, no panic), an empty DB, and the events parser against the exact JSON above.
- Version: `cmd-usage` MINOR bump plus `cmduse-core` if `core/` changed, with `Cargo.lock` updated in the same change (`release.yml` builds `--locked`).

## Done means

`cargo test && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings`, the MCP `tools/list` echoed through the new binary, and a real run against this machine's store (it holds only two messages, so the numbers will be tiny — say so rather than faking a demo).

## House rules

- `rg`, never `grep`/`find`; `fd`; `sd` never `sed`; no Python.
- Tabs, width 4, 100 cols; every file under 200 lines — split by responsibility, never trim.
- Never run `oduse`/`cmduse`/`ocuse`/`arkuse` bare as a TUI: use `-1`, `--json`, `--once`.
- Do not commit, push, branch, or stash. Leave the tree dirty.
- One tree, no worktree.
- DO NOT WASTE TURNS: do as much as possible in one turn — batch independent calls, chain dependent steps, never yield between them. Run builds and tests in the foreground and wait inside the same call.
- A report is a claim: quote the command that produced every number.
