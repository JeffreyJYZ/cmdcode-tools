# Lane brief — per-model caps and an honest elapsed clock

You are fixing two wrong numbers in `oduse`. Repo `~/dev/cmdcode-tools`, `main`. Own `cmduse/src/oduse/**`, `core/od.json`, and the docs. Do not touch `opencode-plugin/`, root `AGENTS.md`, or either tap repo.

## Defect 1 — the caps are per model, and `oduse` only knows the Eco ones

OpenDesign publishes **model-dependent** Design Plan allowances, and `oduse` prints one set for everything.

`https://open-design.ai/pricing.md` (Go):
> Coding Plan: up to $220 / month **with DeepSeek V4.1 Flash Eco** … Go displays up to $220/month, $55/7 days and $18/5 hours … With the original DeepSeek V4.1 Flash, Go allows up to **$30 per 7 days and $10 per 5 hours**.

`https://open-design.ai/help/billing/`:
> The Go and Plus maximums above apply when using DeepSeek V4.1 Flash Eco … The original DeepSeek V4.1 Flash allowance remains unchanged: up to **$120/month on Go** and $160/month on Plus.

So Go has two cap sets:

| model | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash Eco (0.27×) | $220 | $55 | $18 |
| DeepSeek V4.1 Flash (0.5×) | $120 | $30 | $10 |

The user runs **both** models (2.7K flash turns, 59 eco turns), so today's frame charges every turn against the Eco caps and overstates the headroom by ~1.8× on the month and the short windows. `core/od.json` has a single `plans.go` cap block and `window/mod.rs` divides by it unconditionally.

Do:
1. Model the caps **per plan and per model class** in `core/od.json` — a plan-level default plus per-model overrides, with the Eco/Flash pair as the first real case. Pro/Max have no Eco, so their single set stays.
2. Pick the cap set from the turns actually in the window: a window holding both models is capped by the **stricter** applicable allowance (the Flash set), and the frame must say which set it used, e.g. `$3.20 · 2.7% of $120.00 (Flash caps; Eco would be $220.00)`. Never silently mix.
3. `oduse plans --json` and `models --json` must expose the cap set per model so the sidebar and mpc can read it, and `mpc --od-plan` must be checked for the same mistake (it derives allowance as `credits ÷ multiplier`, which assumes one pool — report what it should do, do not edit `oc-cmd-compare` in this pass).
4. Tests: Go+Eco caps resolve to 220/55/18; Go+Flash to 120/30/10; a mixed window picks the stricter set and says so; Pro has one set and no Eco row.

## Defect 2 — `window 54.6% elapsed` is not the window's elapsed share

`render/dash.rs` prints `window {pct}% elapsed · $N by now` on the Monthly row, computed from the **calendar month**. That is wrong both ways:

- The plan's real cycle is the **subscription anniversary** (the 7-day window starts at subscribe time, per `/help/billing`), so a calendar-month share is the wrong denominator.
- It renders `54.6%` on a period that, in this frame, runs `2026-11-01 → 2026-12-01` — and the user says plainly it is not true. Compute it from the frame's own `period_start`/`period_end` and print `—` when either is unknown rather than inventing a share.

Do:
1. Derive the share from the same period the row's figure comes from (`period_start`, `period_end`), never from a calendar assumption.
2. When the period is `all` or inferred with no anchor, print `no period anchor` instead of a percentage.
3. Test: a pinned `--period-start` yields the arithmetic share; `--window all` yields no percentage; the anniversary inference yields a share from that boundary.

## Prove it

```
timeout 120 ./target/debug/oduse -1 --no-wallet
timeout 120 ./target/debug/oduse plans --json | head -c 400
timeout 120 ./target/debug/oduse model --window all --no-wallet
```

Show before/after for the caps line and the elapsed figure, and hand-check one window: total credits ÷ the applicable cap.

Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, bound every TUI with `timeout`, files under 200 lines. No commit, push, branch or stash — leave the tree dirty and name the branch state.
