# percent-audit lane P — recon memory

Scope: read-only audit. Only writes were `docs/plan/percent-audit/report.md` and this file. No commits, no `AGENTS.md`, no worktree.

## Framing (user correction, 2026-11-23, caps; also global AGENTS.md)

- Endpoint's ~75% is ACCURATE: time-weighted blend of $80 early + $100 late in the period. `spend ÷ today's cap` (69.7%) answers "what's left now", a different question. Never file "percentage is not spend ÷ current cap" as a defect.
- Rank only: (1) percentage printed with no statement of its basis, (2) percentage inverted into a dollar cap (feeds pace), (3) cap can change mid-window with no history so blend cannot be explained.
- Trap: earlier brief framed the 75% as wrong. That framing was withdrawn. Re-read conclusions against the correction before reporting.

## Where the limits live (file:line)

- ocuse per-model Go limit: live `/zen/go/v1/models` (`cmduse/src/ocuse/catalogue/convert.rs:65-96`), 6h cache TTL (`cmduse/src/ocuse/catalogue/mod.rs:39-41`), resolved once per process (`:75-77,103-146`), pinned into `ModelUsage.limit` at `cmduse/src/ocuse/window.rs:324`. Baked fallback `core/zen.json:553-581` (DeepSeek 100 at `:556`). The 80→100 rise is named at `cmduse/src/ocuse/catalogue/tests.rs:56-57`.
- ocuse three meters: `/zen/go/v1/usage`, percent verbatim (`cmduse/src/ocuse/api.rs:36-50,164-202`); server basis gap documented at `:19-22`.
- cmduse has NO per-model allowance; `report_render.rs:547-550` is share of period spend. Plan cap from `core/plans.json:14-25`; 5h/week `used`/`cap` from API (`core/src/wire.rs:15-33`).
- arkuse tier AFP from `core/ark.json:12-51`; pro-rate on upgrade at `:305`. Meter `total`/`used`/`percent` from arkcli (`cmduse/src/arkuse/api.rs:185-200,248-253`), server percent wins (`:202-217`). Pace uses server used+quota directly (`cmduse/src/arkuse/render.rs:233-242`) — no back-solve.
- oduse caps from `core/od.json:17-69` + `capOverrides`; `cap_set_for`/`cap_pick` at `cmduse/src/oduse/caps.rs:60-115`. Server windows give `limitCredits`+`remainingCredits` together (`cmduse/src/oduse/snapshot.rs:150-176`, `snapshot_window.rs:15-30`) — no blend.

## The three faults, located

- Fault 2 (worst): `implied_cap(spend, share_pct) = spend × 100 / pct` at `cmduse/src/ocuse/render.rs:268-270`, called at `:171`, feeds pace `:172-180` and by-now `:184-192`. Cap not printed anymore (`:211-215`) but the two derived dollar figures survive. Tests pin values at `:1744-1750`. Only ocuse has this.
- Fault 1: `· 75% of limit` unqualified at `cmduse/src/ocuse/render.rs:216-223,438-447`; model `spend ÷ current cap` at `:341-358` (`window.rs:53-57`). Plugin repeats at `opencode-plugin/src/sidebar/zen.ts:266-294,427-443`. Sidebar pace uses `cap:100, used:pct` (`zen.ts:280-289`) — no back-solve.
- Fault 3: catalogue provenance only, no cap history (`cmduse/src/ocuse/render.rs:884-887,806-810`). Same risk in cmduse/arkuse/oduse baked caps, lower priority.

## Consumers / blast radius

- ocuse JSON `account.{rolling,weekly,monthly}.percent` built at `cmduse/src/ocuse/render.rs:836-842,874-878`, pinned by tests `:1832-1834` and fixture `api.rs:220-226`. Statusline template pinned `:1847-1865`. MCP `usage` returns text not JSON (`cmduse/src/ocuse/mcp.rs:156-172`).
- `models[].limit` (`render.rs:823-832`) is the current cap, already correct; 69.7% is text-only.
- mpc reads cmduse `summary.cost`, never an account percent (`oc-cmd-compare/src/data/usage/parse.ts:68-80`, `index.ts:38-47`). No mpc field changes.
- Shared helper home: `core/src/lib.rs` beside `pct` (`:125`) and `pace_eta` (`:231`); `elapsed_pct` is `:212`. All four binaries import core.

## Ranking reached

- ocuse only has the actual bug (all three); cmduse/arkuse/oduse carry risk 3 only. Fix order: remove implied_cap → label both figures → record cap history → then the other three.
- Implementation already scoped in `docs/plan/percent-audit/lane-q.md:34-77` (separate lane, do not touch). Its report path is its own file, not this report.
