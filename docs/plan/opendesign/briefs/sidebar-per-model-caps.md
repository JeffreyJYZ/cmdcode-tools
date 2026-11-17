# Lane brief — the sidebar must not imply headroom the plan does not grant

`opencode-plugin`, repo `~/dev/cmdcode-tools`. Own `src/sidebar/**` and `test/**`.

## The problem

The OpenDesign panel prints the plan's headline allowance — `$220.00/month · $55.00/week · $18.00/5h` — from `oduse -1 --json`'s `caps`. Those are **Eco's** caps. The user's traffic is 2.7K turns on `deepseek-v4.1-flash` and 59 on `-eco`, and OpenDesign publishes a different allowance for each:

| model | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash Eco (0.27x) | $220 | $55 | $18 |
| DeepSeek V4.1 Flash (0.5x) | $120 | $30 | $10 |

So the panel currently reads `$3.20 · 1.5% of $220.00` when the honest figure against the model actually used is `$3.20 · 2.7% of $120.00`. The user has to be able to trust the meter, and right now it flatters the account by ~1.8x.

## What to do

1. Read the caps `oduse -1 --json` publishes today (`caps.{monthlyUsd,weeklyUsd,fiveHourUsd}`), and design for a per-model shape arriving: another lane is changing `oduse` to publish caps per model class, keyed by model id, with a `defaultCaps` fallback. Accept **either** shape without a throw, and prefer the per-model one when present.
2. Decide which cap set the panel should show when a period mixes models. The rule the CLI is adopting: a mixed window is capped by the **stricter** applicable allowance, and says which set it used. Mirror it, and name the set in the row (e.g. `of $120.00 · Flash caps`) rather than printing a bare cap.
3. When the JSON carries only the single legacy `caps` block, keep rendering it but mark the row as the plan's headline allowance rather than the per-model one, so a stale binary cannot silently read as exact.
4. Fix any hardcoded cap strings in the sidebar — the panel must render whatever the binary reports, never its own copy of `220`.
5. Tests: per-model caps present → Flash row with `$120` and the set named; only legacy caps → renders with the "headline allowance" marking; both models in the window → the stricter set wins and the caveat names both.

## Gate

From `opencode-plugin/`: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint` — all green over the whole directory. Bump `package.json` PATCH and rebuild `dist/` (`bun run build`); dist is gitignored.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, no commit/push/branch — leave the tree dirty and report the branch state.
