# OpenDesign authoritative model price list vs `core/od.json`

## Provenance

- Fetched `GET https://amr-api.open-design.ai/api/v1/public/model-prices` on 2026-11-17 → **HTTP 200**.
- Raw body saved verbatim (no reformat) to `docs/plan/opendesign/reference/od-model-prices.json` — 6,639 bytes, one line, no trailing newline.
- Envelope `{"data":[…]}`, **46 models**. Fields per row: `model`, `pricing{unit:"1m_tokens", currency:"USD", input, output, cacheRead, cacheWrite?, longContext?}`.
- **14 of 14** `core/od.json` model ids appear in the payload (exact match by wire id). No id in `od.json` is missing from the price list.
- Result: **7 input/output rows match, 7 differ**. Both `rateSource:"estimate"` rows have published figures. **32** price-list models are absent from `od.json`. **9** models carry a `longContext` tier.

## 1. Comparison table — published vs `core/od.json`

`od.json` has **no** `cacheRead`/`cacheWrite` columns at all, so those columns are `absent from od.json` for every row by construction. The "effective today" cache rate is what `oduse` actually uses: `core/zen.json` floor via `price.rs::zen_cache_read`, else the model's own `input` rate (flagged `cache_estimated`). Numbers quoted exactly from both sources.

| od.json id (= wire id) | od.json `input/output` (`rateSource`) | published `input/output` | published `cacheRead` | published `cacheWrite` | effective cache rate today | longContext | row verdict |
|---|---|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | `0.15 / 0.6` (repo) | `0.3 / 1.2` | `0.006` | `null` | `0.003` (zen floor) | none | **differs** |
| `deepseek-v4.1-flash-eco` | `0.05 / 0.2` (estimate) | `0.3 / 1.2` | `0.006` | `null` | `0.05` (input fallback) | none | **differs** |
| `minimax-m3.1-flash` | `0.15 / 0.6` (repo) | `0.15 / 0.6` | `0.015` | `null` | `0.15` (input fallback) | none | **same** |
| `mimo-v2.6-flash` | `0.14 / 0.28` (repo) | `0.14 / 0.28` | `0.0028` | `null` | `0.0028` (zen) | none | **same** |
| `mimo-v2.6-pro` | `0.435 / 0.87` (repo) | `0.435 / 0.87` | `0.0036` | `null` | `0.003625` (zen) | none | **same** |
| `hy4-preview` | `0.834 / 2.501` (repo) | `0.834 / 2.501` | `0.042` | `null` | `0.042` (zen) | none | **same** |
| `deepseek-v4-flash` | `0.15 / 0.6` (repo) | `0.44 / 1.32` | `0.014` | `null` | `0.003` (zen floor) | none | **differs** |
| `deepseek-v4-flash-vision-exp` | `0.15 / 0.6` (repo) | `0.44 / 1.32` | `0.014` | `null` | `0.003` (zen floor) | none | **differs** |
| `deepseek-v4-pro` | `0.66 / 1.98` (repo) | `1.32 / 3.96` | `0.044` | `null` | `0.022` (zen floor) | none | **differs** |
| `glm-5.3-flash` | `0.15 / 0.5` (repo) | `0.075 / 0.25` | `0.015` | `null` | `0.03` (zen) | none | **differs** |
| `kimi-k2.7-code` | `0.95 / 4` (repo) | `0.95 / 4` | `0.19` | `null` | `0.19` (zen) | none | **same** |
| `glm-5.3-flashx` | `0.3 / 1` (estimate) | `0.37 / 1.25` | `0.075` | `null` | `0.3` (input fallback) | none | **differs** |
| `claude-haiku-5.5` | `0.1 / 0.5` (repo) | `0.1 / 0.5` | `0.01` | `0.125` | `0.01` (zen via `catalogId`) | `@100000` | **same** |
| `gpt-6-luna` | `0.1 / 0.5` (repo) | `0.1 / 0.5` | `0.01` | `0.125` | `0.01` (zen) | `@272000` | **same** |

Verdict counts: **same 7** · **differs 7** · **absent from od.json 0** (within the intersection; the 32 payload-only models are in §4).

## 2. Rows that change a figure the user sees today

All "differs" rows change `oduse` credits directly (credits = cost × multiplier, `od.rs:164`). Ratios written as published ÷ current.

| Model | input current → published | output current → published | Why the old value was wrong |
|---|---|---|---|
| `deepseek-v4.1-flash` | `0.15 → 0.3` (**2×**) | `0.6 → 1.2` (**2×**) | `od.json` seeded from zen's **off-peak** sheet; OD publishes a flat **peak** rate. This is the active `open-design-tmp/deepseek-v4.1-flash#high` lane, so every credit figure for it is currently ½. |
| `deepseek-v4.1-flash-eco` | `0.05 → 0.3` (**6×**) | `0.2 → 1.2` (**6×**) | `estimate`. Published Eco token price equals non-Eco; "eco" is a higher **cap set**, not cheaper tokens. Default Go cap set is Eco, so the default dashboard rate is 6× too low. |
| `deepseek-v4-flash` | `0.15 → 0.44` (2.93×) | `0.6 → 1.32` (2.2×) | Off-peak seed again. |
| `deepseek-v4-flash-vision-exp` | `0.15 → 0.44` (2.93×) | `0.6 → 1.32` (2.2×) | Same as above. |
| `deepseek-v4-pro` | `0.66 → 1.32` (2×) | `1.98 → 3.96` (2×) | Off-peak seed again. |
| `glm-5.3-flash` | `0.15 → 0.075` (**0.5×** — ours too high) | `0.5 → 0.25` | Overstates spend 2×. |
| `glm-5.3-flashx` | `0.3 → 0.37` (1.23×) | `1 → 1.25` (1.25×) | `estimate`, slightly low. |

Explicitly checked from the brief and **unchanged** on input/output: `minimax-m3.1-flash`, `mimo-v2.6-flash`, `mimo-v2.6-pro`, `hy4-preview`, `kimi-k2.7-code`, `claude-haiku-5.5`, `gpt-6-luna`.

**Cache-read is a second, independent visible change** (all rows above "effective cache rate today"):

- `deepseek-v4.1-flash` `0.003 → 0.006` (**2× understated**). Cache reads dominate this workload, so this is the largest single correction.
- `deepseek-v4.1-flash-eco` `0.05 → 0.006` (~8× overstated), `glm-5.3-flashx` `0.3 → 0.075` (4× overstated), `minimax-m3.1-flash` `0.15 → 0.015` (**10× overstated**) — all currently fall back to the input rate because zen has no row; all would become published.
- `deepseek-v4-flash`/`-vision-exp` `0.003 → 0.014` (4.7× understated), `deepseek-v4-pro` `0.022 → 0.044` (2× understated), `glm-5.3-flash` `0.03 → 0.015` (2× overstated).
- `mimo-v2.6-flash/pro`, `hy4-preview`, `kimi-k2.7-code`, `claude-haiku-5.5`, `gpt-6-luna`: cache rate already matches to within rounding.

**cacheWrite** is published (`0.125`) only for `claude-haiku-5.5` and `gpt-6-luna` among the 14; every other matched row has `null`. `oduse`'s store records no cache-write tokens, so this cannot change a figure today — record it for completeness only.

## 3. `longContext` tiers

Nine of 46 models carry one. Format: `inputTokensAbove → input/output/cacheRead/cacheWrite` (flat rates; all four classes switch together).

| Model | threshold | longContext rates | vs flat |
|---|---|---|---|
| `claude-haiku-5.5` | `100000` | `0.5 / 2.5 / 0.05 / 0.625` | **5×** on every class |
| `gpt-5.6-luna` | `272000` | `0.4 / 1.8 / 0.04 / 0.5` | 2× |
| `gpt-5.6-sol` | `272000` | `8 / 30 / 0.8 / 10` | 2× |
| `gpt-5.6-terra` | `272000` | `4 / 18 / 0.4 / 5` | 2× |
| `gpt-6.1-sol` | `272000` | `4 / 15 / 0.2 / 5` | 2× |
| `gpt-6.1-terra` | `272000` | `2 / 7.5 / 0.1 / 2.5` | 2× |
| `gpt-6-astra` | `272000` | `20 / 75 / 2 / 25` | 2× |
| `gpt-6-luna` | `272000` | `0.2 / 0.75 / 0.02 / 0.25` | 2× |
| `gpt-6-sol` | `272000` | `4 / 15 / 0.4 / 5` | 2× |

**Underpricing:** of the two tiered models in `od.json`, `claude-haiku-5.5` is underpriced **5×** for any turn whose input exceeds 100k tokens (and the *entire* turn, not just the excess, is what the convention reprices). `gpt-6-luna` is **not** affected at 100k — its threshold is 272k; at 272k+ it is underpriced 2×. No DeepSeek model has a longContext tier, so the earlier "our DeepSeek numbers may understate long-context turns" concern is **not** caused by longContext — DeepSeek's understatement is the off-peak/peak flat-rate mismatch in §2.

**What `oduse` should do, and cost:**

1. Add an optional `longContext` struct to `Model` in `cmduse/src/oduse/od.rs` (threshold + 4 rates); `serde(default)`, no generator — `od.json` is hand-maintained. ~10 lines.
2. In `Catalog::turn_cost` (`od.rs:148-168`), pick the rate set by comparing the existing `input: u64` argument to the threshold. **No signature or store change needed** — `Row.input` already holds `inputTokens` from `events_json`. ~5 lines. `price()`/`credits()` and the `plans`/`models` displays have no token count, so they stay flat and must say so.
3. **Unverified semantics:** the payload gives a threshold and a full replacement rate set but never states whether the whole turn is repriced or only tokens above the threshold. Whole-turn repricing is the common convention for these tiers; confirm against one real >threshold billing observation before shipping. This is the only genuinely uncertain part.
4. Replace the `zen_cache_read` proxy in `price.rs` with OD's own published `cacheRead` (fall back to zen for the 32 absent models). This fixes the `cache_estimated` flag for models absent from zen and all the §2 cache deltas. ~15 lines plus tests.
5. Net: **small-to-moderate** — two Rust files, one JSON, unit tests. No store schema change, no fetcher, no build-script change. The expensive part is behavioural confirmation, not code.

## 4. Payload models absent from `od.json` (32) and id spellings

`claude-fable-5`, `claude-fable-5.1`, `claude-fable-5.2`, `claude-opus-4.8`, `claude-opus-5`, `claude-opus-5.5`, `claude-sonnet-5`, `claude-sonnet-5.5`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-4-argon`, `gemini-4-carbon`, `glm-5.2`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `hy4`, `hy4-flash`, `kimi-k3`, `kimi-k3.1-pro`, `muse-ember-1.0`, `muse-spark-1.3`, `muse-wonder`, `qwen3.7-max`, `qwen4-max`.

- These are currently **unpriced** by `oduse` (fall through to recorded cost, usually 0, then to unpriced). Notably `hy4-flash` — distinct from the `hy4-preview` that is in `od.json` — and `kimi-k3`/`kimi-k3.1-pro` are plausible gateway ids worth adding.
- **No spelling mismatch among matched rows.** `od.json`'s `id` is documented as the gateway wire id, and all 14 match the price-list `model` string byte-for-byte.
- `claude-haiku-5.5`'s `catalogId:"claude-haiku-5-5"` is a **zen-catalogue** spelling used only for the cache-rate provenance lookup; the OD price list uses the wire form `claude-haiku-5.5`, so it is not a mismatch here.
- Watch the near-names when adding rows: `hy4` / `hy4-flash` / `hy4-preview` are three distinct ids; `gpt-6-luna` is in `od.json` but `gpt-6-astra`, `gpt-6-sol`, `gpt-6.1-*` and `gpt-5.6-*` are not.

## 5. Verdict on provenance

- **Can every `rateSource:"estimate"` row become `published`? Yes — both of them, no survivors.** `deepseek-v4.1-flash-eco` (`0.3/1.2`, cacheRead `0.006`) and `glm-5.3-flashx` (`0.37/1.25`, cacheRead `0.075`) are both in the payload. Both estimates were also wrong (6× low and ~1.2× low), so the change is substantive, not just a label.
- Stronger recommendation: re-source **all 14** rows to the published list. The current 12 `rateSource:"repo"` values are secondhand (zen's off-peak sheet), and 7 of them disagree with the authoritative list. Open Design now publishes its own rates, so "repo" is no longer the best provenance.
- Caveats before flipping labels: (a) the payload has no `extractedAt`-style version field — stamp the fetch date and keep the raw file; (b) it publishes no multiplier, so `multiplier` stays as-is; (c) `cacheWrite` is `null` for the user's DeepSeek lane, so no write-rate provenance changes; (d) the 32 absent models cannot be marked published at all until added.
