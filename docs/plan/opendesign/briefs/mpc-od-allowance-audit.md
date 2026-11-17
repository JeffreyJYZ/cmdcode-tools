# Lane brief — mpc's OpenDesign allowance assumes one pool

Read-only audit of `~/dev/cmdcode-tools/oc-cmd-compare`. Do not edit: another lane owns `cmduse/src/oduse/**` right now.

## The assumption

`mpc --od-plan` computes a model's allowance as `plan credits ÷ multiplier`, i.e. one shared credit pool per plan. The vendor contradicts that for Go:

| model | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash Eco (0.27x) | $220 | $55 | $18 |
| DeepSeek V4.1 Flash (0.5x) | $120 | $30 | $10 |

Quotes, both from OpenDesign:
- `/help/billing`: "The Go and Plus maximums above apply when using DeepSeek V4.1 Flash Eco … The original DeepSeek V4.1 Flash allowance remains unchanged: up to $120/month on Go."
- `/pricing.md`: "Go displays up to $220/month, $55/7 days and $18/5 hours … With the original DeepSeek V4.1 Flash, Go allows up to $30 per 7 days and $10 per 5 hours."

## Answer these, each with file:line and the command that produced the number

1. Where `oc-cmd-compare` builds the `od` plan and the per-model allowance (`rg -n 'od' src/data/sources/od/ src/cli/engine/`), and exactly what it prints today for `deepseek-v4.1-flash` versus `deepseek-v4.1-flash-eco`.
2. `mpc --json --od-plan go --shape off` — quote both rows' `allowance` and `requestsPerMonth`. Same or different?
3. What the two rows ought to read if caps are per model class, using the published pairs above.
4. Everything else in the OpenDesign column that inherits the single-pool assumption: `requestsPerFiveHour`/`requestsPerWeek`, `$1K`, COST/VAL scaling, `--check --od-plan`, the footer plan block.
5. The smallest change that models per-model caps there, and whether it ripples into `cmduse plans --json`'s contract or the sidebar's mpc spawn.

Write findings to `docs/plan/opendesign/reports/mpc-od-allowance-audit.md` and summarise in your reply.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, bound any TUI with `timeout`, no commit/push/branch.
