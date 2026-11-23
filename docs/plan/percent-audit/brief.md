# Lane P — audit every limit that can change mid-window (read-only recon)

Repo `/Users/jyz/dev/cmdcode-tools`. Binaries: `cmduse/src/cmduse` (`cmduse`), `cmduse/src/ocuse`,
`cmduse/src/arkuse`, `cmduse/src/oduse`. Rust core in `core/`.

## The reported bug, for context

`ocuse --json`, period 2026-11-13 → 2026-12-13:

```
account.monthly.percent = 75        <- the endpoint's own number
summary.cost            = 70.076    <- local dollars, authoritative
models["deepseek-v4.1-flash"].month = { cost: 69.717, limit: 100 }   -> 69.7%
```

The DeepSeek V4.1 Flash allowance rose $80 → $100 inside that period, so the server's 75% is a blend
against a basis nobody can see, and it contradicts the model row it is supposed to summarise (70.1%).
`cmduse/src/ocuse/render.rs` also computes `implied_cap(spend, share_pct)`, so a percentage can manufacture a
denominator: 70.076 at 75% implies a $93.4 cap, which is not a number Go publishes.

## What to produce

A report at `docs/plan/percent-audit/report.md` that answers, per binary, with `file:line` evidence:

1. **Every limit in the tree**, and for each: where it comes from (endpoint meter, catalogue file, fetched
   live, config), whether it can change without a new period starting, and whether that change is detected
   anywhere today. Cover at least: `ocuse`'s per-model Go limits and the three account meters; `cmduse`'s
   per-model CommandCode allowances and its account totals; `arkuse`'s per-tier AFP monthly cap and the
   `arkcli` plan meters; `oduse`'s plan caps and credit pool.
2. **Every place a percentage is computed or displayed**, and what the denominator actually is. Flag every
   case where (a) the denominator is a stale or implied cap, (b) the numerator and denominator come from
   different sources (local dollars vs server percent), or (c) a printed dollar/percent pair lets a reader
   derive a cap the source never published.
3. **Every JSON field whose value would change** if the percentage were derived from spend ÷ current cap.
   Name the field paths and the consumers you can find in this repo (the plugin sidebar, `mpc`, the
   statusline contract, MCP tools, tests that pin the value).
4. A ranked recommendation: which of the three binaries actually has this bug (not just the risk), which
   order to fix, and the one shared helper the fixes should use.

## Rules

- Read only. Your only writes are `docs/plan/percent-audit/report.md` and `docs/agents/percent-audit.md`.
- `rg`/`fd` with explicit paths; never `grep`/`find`/`sed`. **Never pass `-r` to `rg`** — it is ripgrep's
  replace flag and it silently rewrites the output.
- Quote the line, not a recollection: every claim needs `file:line`.
- No commits, no version bumps, no `AGENTS.md`. One tree, no worktree.
