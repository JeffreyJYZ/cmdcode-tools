# Lane A — mpc: OpenDesign Go plan column set

Read `/Users/jyz/dev/cmdcode-tools/oc-cmd-compare/AGENTS.md` first, then the code you touch.
Work only inside `oc-cmd-compare/`. Do not touch `cmduse/`, `core/`, `opencode-plugin/`, or the root `AGENTS.md` (another lane and the controller own those) — report any line you think they need.

## Goal

`mpc` gains `--od-plan <go|plus|pro|max>`, which adds OpenDesign plan rows the same way `--cc-plan` / `--oc-plan` do: price, credit allowance, per-model requests per window, and the ability/TPS columns that already exist. A user with an OpenDesign Go subscription must be able to compare it against Command Code GOAT and OpenCode Go in one table.

## Published plan facts (open-design.ai/pricing, /model-credits, /help/billing — re-read them live, do not trust this brief if they differ)

| plan | monthly price | monthly max | 7-day | 5-hour | plan-model credits | concurrency |
|---|---|---|---|---|---|---|
| Go | $10 | $220 | $55 | $18 | $0 | 10 |
| Plus | $20 | $310 | $74 | — | $20 | 20 |
| Pro | $100 | $480 | $90 | — | $120 | 30 |
| Max | $200 | $900 | $150 | — | $300 | 50 |

- Only Design Plan credits carry the 5-hour and 7-day windows; plan-model credits have neither.
- 7-day window resets from subscription start, not Monday — say so in one footer line, never pretend a calendar week.
- Design Plan credit multiplier per model: DeepSeek V4.1 Flash 0.5x (Eco 0.27x), MiniMax M3.1 Flash / MiMo V2.6 Flash / MiMo V2.6 Pro / Hy4 Preview / DeepSeek V4 Flash / DeepSeek V4 Flash Vision Exp / DeepSeek V4 Pro / GLM-5.3 Flash / Kimi K2.7 Code 1x, GLM-5.3 Flash-X 2x, Claude Haiku 5.5 2x, GPT-6 Luna 4x.
- A multiplier means: credits consumed = dollar value of token usage x multiplier. So the model's usable token spend is `credits / multiplier`.
- Go includes Design Plan models only, no top models (Opus 5.5, Kimi K3, Gemini 4 Argon, Muse, Grok 4.7 etc. are Plus+), no image generation. Mark excluded models the way the existing gating column marks CC-only models.
- Their pricing page publishes an estimated-requests/7-days table per model per plan; use it as a cross-check, not as truth, and never invent a number it disagrees with.

## Where the code goes

- Plan constants live with the existing plan constants, one domain per file, no version strings in prose.
- Reuse the existing request-shape maths (`--shape`, per-model token assumptions) rather than a new estimator; the OpenDesign column must be computed the same way the OpenCode column is.
- Ability/TPS: Artificial Analysis already keys DeepSeek under dated slugs (`aaKeyVariants`); do not regress it.
- Footer/`--check` must name the source (`open-design.ai/pricing`) and the window basis, exactly like the existing source lines.
- README: add `--od-plan` to the flag list and the plan table; no hardcoded version in prose.

## Done means

- `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint` all clean from `oc-cmd-compare/`.
- Tests cover: OD plan constants, multiplier -> usable allowance maths, a Go row that is excluded on Go but present on Plus, and the JSON shape carrying the plan.
- A live `bun run src/index.ts --bench aa --od-plan go` shows the rows (Artificial Analysis quota may be spent — that must degrade to the existing labelled fallback, not crash).
- Report: files changed, the exact commands you ran with their result lines, and anything you could not verify.

## House rules

- `rg`, never `grep`/`find`; `fd` for paths; `sd` never `sed`; no Python.
- Tabs, width 4, 100 cols; every file under 200 lines (split, never trim).
- Do not commit, push, branch, or stash. Leave the tree dirty.
- One tree, no worktree.
- Never run `cmduse` / `ocuse` / `arkuse` bare (interactive TUI).
- DO NOT WASTE TURNS: do as much as possible in one turn — batch every independent call, chain dependent steps, never yield between them. Run builds and tests in the foreground and wait inside the same call.
- A report is a claim: quote the command that produced every number.
