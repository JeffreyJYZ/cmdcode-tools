# zen-refresh report — `core/zen.json` regenerated from the live model list API

Date: 2026-11-20. Tree: `/Users/jyz/dev/cmdcode-tools` @ `c7bb89a`, branch `main`, one tree, no worktree.
Versions untouched (no bump, tag, publish or tap change).

## What was wrong

`core/zen.json` was stamped `extractedAt 2026-10-12T12:54:26.459Z` and carried 32 Go models on two plans.
By 2026-11-20 the live catalogue disagreed on limits, membership and rates. The reported symptom was
`ocuse model` showing `DeepSeek V4.1 Flash $56.53/$80 (70.7%)` where the real limit is `$100`, while `mpc`
(read from the live endpoint) already said `$100`.

Root cause of the staleness: `bun scripts/extract-zen.ts` scraped the docs markdown and now dies

```
error: go.mdx: expected one priced plan slot per plan, found 0 — docs layout changed
```

The article path moved (`services/www` → `services/site`; the old raw URL answers **404**) **and** the priced
per-model tables were removed from it. The article now says, verbatim:

> See the [model list API](/console/api/models) for every field in the response, including Go's monthly usage limits.

So the docs scrape cannot be repaired for limits or rates, and the endpoint is both the documented source and
the meter the account is billed against.

## Commands run

```sh
cd ~/dev/cmdcode-tools
git log -1 --oneline && git status --short && git branch --show-current
timeout 60 curl -sS https://opencode.ai/zen/go/v1/models -o /tmp/zengo.json        # 200, 31 models
timeout 60 curl -sS https://opencode.ai/zen/v1/models    -o /tmp/zen.json          # 200, 103 models
bun -e '…core/zen.json vs /tmp/zengo.json per-model diff…'                          # the before table
timeout 60 curl -sS -o /tmp/go.mdx -w '%{http_code}\n' <old raw URL>                # 404
timeout 60 curl -sS <https://api.github.com/repos/anomalyco/opencode/git/trees/dev?recursive=1>  # docs moved
bun scripts/extract-zen.ts                                                          # BEFORE the rewrite: layout error above
./target/debug/ocuse models                                                         # before figures
./target/debug/ocuse model | rg -i 'deepseek|glm'
bun scripts/extract-zen.ts                                                          # after the rewrite
cargo test
cargo run -q -p cmd-usage --bin ocuse -- models
cargo run -q -p cmd-usage --bin ocuse -- model
cargo run -q -p cmd-usage --bin ocuse -- -1 --json
cargo run -q -p cmd-usage --bin ocuse -- models --plan go-teams
cargo run -q -p cmd-usage --bin ocuse -- -1 --json --plan go-teams
cargo run -q -p cmd-usage --bin ocuse -- models --plan nope
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
bun parity
bun fmt scripts/extract-zen.ts && bun check scripts/extract-zen.ts
```

Note: the brief's `cargo run -p cmd-usage -- ocuse models` cannot work — `cmd-usage` ships several bins, so
plain `cargo run` launches `cmduse`, whose first arg `ocuse` is not one of its subcommands (`unknown arg: ocuse`).
The working form is `cargo run -q -p cmd-usage --bin ocuse -- models`.

## Source trusted, and why

**`GET https://opencode.ai/zen/go/v1/models`** (no auth, HTTP 200) is now the single source for Go membership,
per-plan limits and token rates; **`GET https://opencode.ai/zen/v1/models`** for the Zen pay-as-you-go rates.

Reasons, in order:

1. It is the meter. `go.monthly_usage` is the per-plan allowance the account is billed against; the docs article
   no longer publishes those numbers at all.
2. The article itself points at it for "every field in the response, including Go's monthly usage limits".
3. `mpc` (`oc-cmd-compare/src/data/scrape/catalog/ocModels.ts`) already reads exactly this payload, so `ocuse`
   and `mpc` now agree by construction instead of contradicting each other.
4. The docs markdown path had already rotted once (404), so the extractor must not depend on it for anything it
   can get from the API. The docs page is still read for the two facts the API does not carry — each plan's
   price and the window split — and a dead page now degrades to `PLAN_PRICE_FALLBACK` + a warning instead of
   blocking the refresh.

`scripts/extract-zen.ts` was rewritten around that decision: API for membership/limits/rates/variants; docs only
for the plan price table; `--go <json> --zen <json> [--docs <mdx>]` accept local fixtures (the paths now name JSON
payloads). It fails loud when an endpoint stops carrying models or a plan lists no limits, and prints every id it
added or dropped plus every limit that moved.

## Before / after for the two models that were wrong

`ocuse model` (plan `go`):

```
BEFORE
deepseek-v4.1-flash           $80.00     $56.53   70.7%    $1.33   $33.07   28.1K
glm-5.3                       $15.00      $0.36    2.4%    $0.36    $0.36       1

AFTER
deepseek-v4.1-flash          $100.00     $56.59   56.6%    $1.39   $33.13   28.2K
glm-5.3                      $500.00      $0.36    0.1%    $0.36    $0.36       1
```

DeepSeek V4.1 Flash is now **56.6%** (`56.59 / 100`), not **70.7%** (`56.53 / 80`). The spend differs by
$0.06 because the two runs happened minutes apart; the share arithmetic is exactly `spent / limit`.
GLM-5.3's limit moved $15 → $500, so its share fell 2.4% → 0.1%.

`ocuse models` (before → after, relevant rows):

```
BEFORE
DeepSeek V4.1 Flash   deepseek-v4.1-flash   $0.15   $0.6  $0.003   $80.00
GLM-5.3               glm-5.3                $1.4   $4.4   $0.26   $15.00
(plus 9 rows for models the endpoint no longer lists)

AFTER
DeepSeek V4.1 Flash 1017   deepseek-v4.1-flash   $0.15   $0.6  $0.003  $100.00   yes
GLM-5.3                    glm-5.3                $1.4   $4.4   $0.26  $500.00   yes
Gemini 4 Argon             gemini-4-argon           $2    $10    $0.1   $30.00   yes
Hy4                        hy4                   $0.834  $2.501  $0.042  $60.00   yes
Kimi K3.1 Pro              kimi-k3.1-pro            $2    $10    $0.2   $15.00   yes
MiniMax-M3.1-Flash         minimax-m3.1-flash    $0.15   $0.6  $0.015   $20.00   yes
Qwen4-Max                  qwen4-max               $1.5   $4.5  $0.075   $15.00   yes
Step 5 Preview             step-5-preview           $1    $2.7    $0.1   $15.00   yes
Go models (plan go · 27/31 granted)
```

Rates themselves were unchanged for the models that survived (spot-checked DeepSeek, GLM-5.3, GPT-5.6 Luna,
Qwen3.7 Plus, Qwen4-Max, MiniMax-M3.1-Flash against the endpoint).

## Added and dropped ids

Go catalogue (31 models; 27 granted + 4 free) — **dropped 11**, every one absent from the live list:

```
deepseek-v4-flash, deepseek-v4-flash-vision-exp, glm-5.2, grok-4.6, kimi-k2.6,
longcat-2.5-preview-free, mimo-v2.5, mimo-v2.5-pro, minimax-m2.7, space-bunny,
step-5-preview-free
```

**Added 10** (`go.monthly_usage` present where not marked free):

```
minimax-m3.1-flash (20), step-5-preview (15), kimi-k3.1-pro (15), gemini-4-argon (30),
hy4 (60), qwen4-max (15), beam-free (free), hy4-flash-free (free),
iceman-contributor-free (free), longcat-2.5-free (free)
```

Brief's table listed 6 added; the endpoint also lists four new free rows, which carry no `monthly_usage` and are
kept for membership (`—` limit, `no` granted), exactly like the old free rows.

Zen catalogue (101 priced rows; the endpoint listed 103, two publish no text rates) — **dropped 20**:

```
deepseek-v4-flash, deepseek-v4-flash-vision-exp, exo-free, gemini-3-flash, gemini-3.1-pro,
glm-5, glm-5.1, glm-5.2, kimi-k2.5, kimi-k2.6, ling-3.0-flash-fin-free, ling-3.1-flash-free,
longcat-2.5-preview-free, mimo-v2.5-free, muse-spark-1.3-contributor-free,
nemotron-3-ultra-free, qwen3.7-max, qwen3.7-plus, space-bunny-free, step-5-preview-free
```

**Added 34**:

```
beam-free, bge-m3, claude-fable-5-2, codestral-embed, cohere-embed-v5-fast,
cohere-embed-v5-pro, deepseek-v4.1-flash-free, flint-40b-free, gemini-4-argon,
gemini-4-carbon, gemini-4-hydrogen, gemini-4-neon, gemini-decision-1,
gemini-embedding-001, gemini-embedding-2, gemini-nano-banana-2.1,
gpt-6-luna-decision, gpt-6.2-astra, gpt-6.2-sol, gpt-image-2.5-sunburst,
hy4-flash-free, iceman-free, longcat-2.5-free, mistral-embed, mistral-large-4,
muse-ember-1.0, muse-wonder-1.0, nemotron-3.5-super-vl-free, qwen3-embedding-8b,
text-embedding-3-large, text-embedding-3-small, tidepool-alpha-free, voyage-4,
voyage-code-4
```

Skipped with a warning (no `cost.text`, so no rates): `gpt-live-1`, `grok-imagine-image-2.0`.

Nothing in the tree keys off the dropped ids: `core/gating.json` is the CommandCode provider catalogue (a
different namespace), `core/ark.json`/`core/od.json` carry their own lists (the only `catalogId` into zen is
`claude-haiku-5-5`, still live), and the `glm-5.2` strings under `cmduse`/`reqshape` are store-row fixtures,
not catalogue keys. Retired models that still appear in local history now simply report no limit (`—`), which is
the correct state.

## Drift found beyond the brief

- **A third plan exists.** The docs plan table and the payload's usage keys both define **Go Teams**
  ($20/member/month, 2-member minimum, "$5/month higher than Go on every model"). The payload carries
  `go-teams` on every granted model, and the numbers match the doc claim exactly (`go` + 5). The file now carries
  `go`, `go-plus` and `go-teams`; `--plan` accepts all three (`ocuse: --plan expects one of go, go-plus, go-teams`).
- **GLM-5.3's $500 is a promo.** The docs callout says "Higher usage limits apply through November 22, 2026", i.e.
  it reverts two days after this run. Nothing in `zen.json` models an expiry, so the next refresh must pick up the
  reverted number — do not treat $500 as permanent in prose.
- **Docs source moved**, old raw URL 404s (recorded above).
- The zen catalogue grew 87 → 101 rows and now includes embedding and image models the endpoint serves; they are
  listed with their rates, and `ocuse` only counts the number in its `ZEN — pay-as-you-go` footer line.
- Multipliers in the payload are not all peak splits: `date` (scheduled reprice, e.g. gemini-4-argon from
  2026-12-01) and `service_tier` (fast/flex/priority/ultrafast) multipliers are skipped; only a
  `utc_days` + `utc_hours` one becomes the `peak`/`off-peak` variant pair. Cache-write TTL maps
  (`{"30m": …, "12h": …}`) take the first (base) value, matching `mpc`.

## Tests and docs changed (none deleted; each guard kept meaningful)

- `core/src/lib.rs` — `zen_catalogue_is_embedded` now asserts `go-plus` **and** `go-teams`, so a snapshot that
  loses a plan fails the build.
- `cmduse/src/ocuse/zen.rs` —
  `catalogue_parses_and_carries_both_plans` → `catalogue_parses_and_carries_the_plans`: exact plan-id vec is now
  `["go","go-plus","go-teams"]`, plus `go-teams` price $20 and its $65 GLM-5.3-Flash limit.
  `tiered_and_peak_variants_are_kept` now reads `deepseek-v4.1-flash` (the retired `deepseek-v4-flash` row is the
  model whose peak variants it was pinning).
- `cmduse/src/ocuse/render.rs` — `catalogue_json_carries_both_plans_and_windows` →
  `…every_plan_and_windows` (asserts the third plan and its $20); `the_models_table_header_aligns_with_its_rows`
  now finds the `DeepSeek V4.1 Flash` row (the old row's name/id no longer exist).
- Docs/help moved with the code: `cmduse/src/cli.rs` help, the three `ocuse` MCP tool schemas
  (`cmduse/src/ocuse/mcp.rs`, which also gains a live `glm-5.3` example id), `README.md`, `cmduse/README.md`,
  `cmduse/cmduse.1` (three plan mentions), `skills/cmduse/SKILL.md`, `scripts/reprice.ts` header, and the
  `zen.rs`/`render.rs` comments that said "two plans".

Not touched, and worth a follow-up: `opencode-plugin/src/constants/sidebar.ts` (`OC_PLANS = ["go","go-plus"]`)
and `oc-cmd-compare/src/constants/sources.ts` still expose only two plans on their side; and `AGENTS.md` line 79
still says `--plan <go|go-plus>`. Both are outside this lane's file scope (the mpc tree currently has another
session's uncommitted work in it).

## Gate

```
cargo test                                  333 passed; 0 failed
cargo fmt --all -- --check                  clean
cargo clippy --all-targets -- -D warnings   clean
bun parity                                  PASS — 4 binaries, 28 flags, 11 allowed differences
bun fmt --check / bun check (extract-zen.ts) clean
```

End-to-end proof, plan `go`: `ocuse models` prints `$100.00` (DeepSeek V4.1 Flash) and `$500.00` (GLM-5.3) with
the six new priced rows; `ocuse model` prints **56.6%**; `ocuse -1 --json` parses with
`summary {cost, requests, tokens}` and `totals {fiveHour, month, weekly}` intact; `--plan go-teams` works end to
end for both `models` and `-1 --json`.

## Rules learned (for the owner to record — no `AGENTS.md` was edited)

- The OpenCode docs moved to `services/site/src/docs/content/console/` and their priced Go/Teams tables are gone;
  `GET /zen/go/v1/models` (`cost.text` + `go.monthly_usage[<plan>]`) is the only live source for Go limits, rates
  and membership, and `mpc` already parses it.
- Go has **three** plans now: `go`, `go-plus`, `go-teams` (`go-teams` = `go` + $5 per model, $20/member/month).
- A payload multiplier is a peak split **only** when it carries `utc_days` + `utc_hours`; `date` and
  `service_tier` multipliers are something else.
- `cargo run -p cmd-usage -- ocuse …` runs the `cmduse` bin; the ocuse cousin needs `--bin ocuse`.
