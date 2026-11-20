# zen-refresh lane notes

## Recon (2026-11-20)

- `core/zen.json` stamped `extractedAt 2026-10-12T12:54:26.459Z`: 32 Go models, plans `go`/`go-plus`, 87 zen models.
- `bun scripts/extract-zen.ts` now dies `go.mdx: expected one priced plan slot per plan, found 0 — docs layout changed`.
  Cause: the docs moved from `services/www/src/docs/content/console/` to `services/site/src/docs/content/console/`;
  the old URL 404s. Even at the new URL the priced per-model tables are gone — `go.mdx` now only says
  "See the [model list API](/console/api/models) for every field in the response, including Go's monthly usage limits."
- `GET https://opencode.ai/zen/go/v1/models` (no auth, HTTP 200) is the meter: 31 models, each with
  `go.monthly_usage.{go,go-plus,go-teams}` (or `null` on free models) and `cost.text` rates.
- `GET https://opencode.ai/zen/v1/models` (HTTP 200) is the Zen pay-as-you-go catalogue: 93 models.
- Docs now define **three** plans: Go $10/mo, Go Plus $40/mo, Go Teams $20/member/mo (2-member minimum,
  "$5/month higher than Go on every model" — matches live `go-teams` = `go` + 5).
- GLM-5.3's $500 limit is a promo "through November 22, 2026" (docs callout), i.e. two days after this run.
  The endpoint reports 500 today; nothing in zen.json models an expiry, so the next refresh must pick up the revert.

## Decision

Endpoint first: `/zen/go/v1/models` (Go limits, membership, rates, peak multiplier) and `/zen/v1/models`
(Zen rates). Docs markdown kept only for the plan price table and window shares, with a built-in fallback +
warning, because the docs path already rotted once and must never again block a refresh.

## Result (2026-11-20)

- `bun scripts/extract-zen.ts` → go 31 models, plans `go $10 / go-plus $40 / go-teams $20`, zen 101 models.
- go dropped 11 (all absent live), added 10 (6 granted + 4 free); zen dropped 20, added 34; 2 skipped (no
  `cost.text`).
- `ocuse model`: deepseek-v4.1-flash `$80.00 70.7%` → `$100.00 56.6%`; glm-5.3 `$15.00 2.4%` → `$500.00 0.1%`.
- `--plan go-teams` works end to end (`models`, `-1 --json`, error lists all three ids).
- Gate green: 333 tests, fmt check, clippy `-D warnings`, `bun parity` PASS.
- Multipliers: only `utc_days` + `utc_hours` is peak; `date`/`service_tier` are skipped (gemini-4-argon's
  2026-12-01 factor 2 is a scheduled reprice, not a peak sheet).
- Follow-ups not in scope: plugin `OC_PLANS` and mpc `OC_PLANS` still list two plans; `AGENTS.md` line 79 says
  `--plan <go|go-plus>` (not edited per brief).

