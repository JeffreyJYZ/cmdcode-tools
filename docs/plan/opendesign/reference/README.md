# OpenDesign published caps — reference

Extracted 2026-11-17 from four live pages plus the gateway's own model list. Every number in `od-caps.json` carries the sentence it was read from; this file collects those quotes in one place. `null` means the page publishes no such value — never read it as `0`.

## Sources

| key | URL | fetched |
| --- | --- | --- |
| `pricingMd` | https://open-design.ai/pricing.md | 2026-11-17 |
| `pricing` | https://open-design.ai/pricing/ | 2026-11-17 |
| `billing` | https://open-design.ai/help/billing/ | 2026-11-17 |
| `modelCredits` | https://open-design.ai/model-credits/ | 2026-11-17 |
| `modelCreditsZh` | https://open-design.ai/zh/model-credits/ | 2026-11-17 |
| `billingZh` | https://open-design.ai/zh/help/billing/ | 2026-11-17 |
| `models` | https://amr-link.open-design.ai/v1/models | 2026-11-17 |

The two `zh` pages are not translations of convenience: they are the second source that makes the multiplier and cap tables checkable, and both agree with their English twin.

## Plan names — two spellings, same four plans

- Long: `Go / Go Plus / Go Pro / Go Max` — pricing.md headings (`## Go Plus — managed`, `## Go Pro — managed (recommended)`, `## Go Max — managed`), the `/pricing` cards, and the `/model-credits` multiplier tabs.
- Short: `Go / Plus / Pro / Max` — `/help/billing` §Choose a subscription: *"Choose Go, Plus, Pro, or Max for the current workspace, then choose monthly or yearly billing."*

`Go` is the shared stem; `Plus / Pro / Max` versus `Go Plus / Go Pro / Go Max` is abbreviation, not a plan change — the tiers, prices and limits line up one-to-one on every page. Every plan block in the JSON names the page each figure came from, so the spelling under which it was read is always recoverable.

One **real** rename did happen, and it left a trace: `/model-credits` still carries `id="design-plan-models"` on its *Coding Plan* multipliers heading. The allowance used to be called Design Plan; no page fetched today uses that name for either the plan or the allowance, and no page publishes it as a cap. A scraper keying off that anchor reads a stale name.

## Caps

### Go

| model | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| `deepseek-v4.1-flash-eco` (default) | $220 | $55 | $18 |
| `deepseek-v4.1-flash` | $120 | $30 | $10 |

- *"Go displays up to $220/month, $55/7 days and $18/5 hours"* — pricing.md §Go.
- *"With DeepSeek V4.1 Flash Eco, Go allows up to $55 per 7 days and $18 per 5 hours … With the original DeepSeek V4.1 Flash, Go allows up to $30 per 7 days and $10 per 5 hours"* — /help/billing §When do the limits reset?
- *"The original DeepSeek V4.1 Flash allowance remains unchanged: up to $120/month on Go"* — /help/billing §How much model credit does each plan include.
- `/model-credits` §2 table: *"Go | $10 | $220 | $0 | $220 | $55 | $18"* — confirms the Eco set only.
- `/pricing` §Coding Plan usage, two separate rows: DeepSeek V4.1 Flash `go $120`, DeepSeek V4.1 Flash Eco `go $220`.

### Go Plus

| model | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| `deepseek-v4.1-flash-eco` (default) | $290 | $74 | — |
| `deepseek-v4.1-flash` | $160 | $40 | — |

- *"Go Plus Coding Plan displays up to $290/month and $74/7 days, with no 5-hour window"* — pricing.md §Go.
- *"Plus allows up to $74 per 7 days, with no 5-hour window … Plus allows up to $40 per 7 days"* — /help/billing §When do the limits reset?
- *"… up to $160/month on Plus"* — /help/billing §How much model credit does each plan include.
- *"Go Plus | $20 | $310 | $20 | $290 Bonus | $74 | No limit window"* — /model-credits §2.

### Go Pro / Go Max

| plan | month | 7-day | 5-hour |
| --- | --- | --- | --- |
| Pro | $660 | $90 | — |
| Max | $1,110 | $150 | — |

- *"Coding Plan: up to $660 / month; maximum combined monthly model credits: $780"* — pricing.md §Go Pro.
- *"Coding Plan: up to $1,110 / month; maximum combined monthly model credits: $1,410"* — pricing.md §Go Max.
- *"Pro and Max retain their $90 and $150 7-day maximums, with no 5-hour window"* — /help/billing §When do the limits reset?
- *"Go Pro | $100 | $780 | $120 Limited-time 20% bonus | $660 Bonus | $90 | No limit window"* — /model-credits §2.

**This is the file's open cap conflict, and it is a genuine one — do not read it as one page being sloppy.** `/help/billing` publishes two internally coherent tables that differ by which Coding Plan base they use:

| source | Pro base | Pro 7d | Pro total | Max base | Max 7d | Max total |
| --- | --- | --- | --- | --- | --- | --- |
| /help/billing credit table | $360 | — | $480 = 360+120 | $600 | — | $900 = 600+300 |
| /help/billing reset section | — | $90 | — | — | $150 | — |
| /model-credits §2 | $660 | $90 | $780 = 660+120 | $1,110 | $150 | $1,410 = 1,110+300 |
| pricing.md, /pricing card | $660 | — | $780 | $1,110 | — | $1,410 |

Both generations add up: `360 + 120 = 480` and `660 + 120 = 780`; `600 + 300 = 900` and `1,110 + 300 = 1,410`. The 7-day figure is `$90`/`$150` on **both** pages, so the tie-breaker is the week-to-month ratio, which is 25.0% / 25.5% for Go and Plus:

- `90 / 360 = 25.0%`, `150 / 600 = 25.0%` — matches Go and Plus exactly.
- `90 / 660 = 13.6%`, `150 / 1,110 = 13.5%` — half the share every other plan uses.

So the page that publishes `$360/$600` is the one whose own 7-day figures agree with it, and the three sources publishing `$660/$1,110` are the ones whose week share does not. Majority says `$660/$1,110` (pricing.md, /pricing card, /model-credits) and that is what is recorded in `plans.pro.caps` / `plans.max.caps`, but it is recorded **as a conflict, not a resolution** — a consumer that spends against a 13.6% week share will see a reset far earlier than the $90 suggests.


## Prices and concurrency

| plan | regular | first month | yearly | concurrency |
| --- | --- | --- | --- | --- |
| Go | $10 | $8 | $84 | 10 |
| Plus | $20 | $16 | $168 | 20 |
| Pro | $100 | $80 | $840 | 30 |
| Max | $200 | $160 | $1,680 | 50 |

Quotes, one line each:
- *"Price: **$10 / month** (first month $8), or **$84 / year**, 30% off"* — pricing.md §Go; the same shape for $20/$16/$168, $100/$80/$840, $200/$160/$1,680 in §Go Plus, §Go Pro, §Go Max.
- *"Shared concurrency: 10 tasks per workspace"* — pricing.md §Go; 20/30/50 in the following sections.
- *"Go | 10 / Plus | 20 / Pro | 30 / Max | 50"* — /help/billing §Shared credits and concurrent tasks.
- *"**10** shared concurrent tasks"* — /pricing Go card; 20/30/50 on the others.
- *"Adding members does not increase the workspace concurrency limit."* — pricing.md §Go preamble.

## Top Model Credits

| plan | amount | card label |
| --- | --- | --- |
| Go | $0 | Not included |
| Plus | $20 | Standard · $20/month |
| Pro | $120 | 6× · $120/month |
| Max | $300 | 15× · $300/month |

- *"Go | $10 | $0 | $220 | $220"* — /help/billing §How much model credit does each plan include (the same table carries Plus $20 / Pro $120 / Max $300).
- *"Top Models Not included"* — /pricing Go card.
- *"Top Models Standard · $20/month"*, *"6× · $120/month"*, *"15× · $300/month"* — /pricing model modules for Plus, Pro, Max.
- *"Pro's $120 top Model Credits include a limited-time 20% bonus; Max's $300 include a limited-time 50% bonus"* — /help/billing §How much model credit does each plan include. The bonus is already inside 120 and 300; the pre-bonus base (100/200) is inferred from the stated percentages and appears nowhere as an amount.

Go's zero is an explicit absence, not a missing figure — recorded `0` with the card's own word `"Not included"`, never `null`:
- *"Coding Plan: up to $220 / month with DeepSeek V4.1 Flash Eco; no separate Top Model Credits"* — pricing.md §Go.
- *"Go has no separate Top Model Credits"* — /help/billing §When do the limits reset?

## Multipliers

| model | wire id | multiplier | published on |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash | `deepseek-v4.1-flash` | 0.5× | model-credits + billing |
| DeepSeek V4.1 Flash Eco | `deepseek-v4.1-flash-eco` | 0.27× | model-credits + billing |
| MiniMax M3.1 Flash | `minimax-m3.1-flash` | 1× | model-credits + billing |
| Hy4 Preview | `hy4-preview` | 1× | model-credits + billing |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 1× | model-credits + billing |
| DeepSeek V4 Flash Vision Exp | `deepseek-v4-flash-vision-exp` | 1× | model-credits + billing |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1× | model-credits + billing |
| GLM-5.3 Flash | `glm-5.3-flash` | 1× | model-credits + billing |
| Kimi K2.7 Code | `kimi-k2.7-code` | 1× | model-credits + billing |
| MiMo V2.6 Flash | `mimo-v2.6-flash` | 4× | model-credits + billing |
| MiMo V2.6 Pro | `mimo-v2.6-pro` | 4× | model-credits + billing |
| GLM-5.3 Flash-X | `glm-5.3-flashx` | 2× | **billing only** |
| Claude Haiku 5.5 | `claude-haiku-5.5` | 4× | **billing only** |
| GPT-6 Luna | `gpt-6-luna` | 4× | **billing only** |

- *"Credit multipliers vary by model as shown below. A lower multiplier uses fewer Coding Plan credits for the same dollar value of model usage. These multipliers apply only to Coding Plan credits."* — /model-credits §2.
- The last three rows of the table above are absent from `/model-credits`' multiplier table entirely. Its rows end at `MiMo V2.6 Pro | 4×`. `/help/billing` adds them: *"GLM-5.3 Flash-X | 2×"* and *"Claude Haiku 5.5 / GPT-6 Luna | 4×"*.
- The MiMo `4×` is corroborated arithmetically by `/pricing` §Coding Plan usage, where MiMo V2.6 Flash and Pro quote `$15/$20/$45/$75` a month against `$60/$80/$180/$300` for every `1×` row — the 4:1 ratio exactly.

### The Claude Haiku 5.5 multiplier — this is the file's second open conflict

The brief expected `/model-credits` to say `2×` against `/help/billing`'s `4×`. As served on 2026-11-17, **`/model-credits` says nothing about Haiku at all**: zero occurrences of `Haiku` in the page, and its multiplier table stops before it. So the live conflict is not two numbers disagreeing; it is one page publishing `4×` and the other publishing no row.

- *"Claude Haiku 5.5 / GPT-6 Luna | 4×"* — /help/billing §Why do different models use credits at different rates?
- The same row, in the Chinese edition: *"Claude Haiku 5.5 / GPT-6 Luna | 4×"* — /zh/help/billing (额度倍率 table). Second source, same page family, same number.
- `/zh/model-credits` also omits Haiku, Luna and Flash-X, matching its English twin: the omission is systematic, not a rendering accident.

`core/od.json` currently carries `multiplier: 2` for `claude-haiku-5.5`, with a note calling the conflict open. No page fetched today publishes a `2` for Haiku anywhere — `/pricing` contains exactly one `2×` string and it is an unrelated expired campaign banner (`Go · Plus 2× usage`). The recorded value here is therefore `4`, with `multiplierConflict: true` so a consumer can keep showing the discrepancy rather than silently rewriting the store.

## Promotions

### First month — live

*"A first-month offer applies to a new monthly subscription once per account. After that month, renewal uses the price shown on the plan card and at checkout. … First-month offers do not stack with yearly pricing."* — /help/billing §First-month offers, renewal, and annual billing.

20% off at every tier: $8 / $16 / $80 / $160.

### Annual — live

30% off at every tier: $84 / $168 / $840 / $1,680. *"Yearly plans charge the full year upfront and renew annually; the displayed monthly equivalent is not a monthly payment."* — same section. The card's `$7 / $14 / $70 / $140` is a display figure.

### DeepSeek off-peak ("Motion Week") — expired

*"The limited-time off-peak offer lasts one week: October 20 at 18:00 to October 27 at 18:00 (UTC+8). The multiplier drops from 0.5× to 0.25×, then returns to 0.5×. Plan allowances and reset times stay unchanged."* — /model-credits §2 tooltip; the same dates and multipliers in /help/billing.

Expired 2026-10-27, three weeks before this extraction, but still shipped in the DOM as a `hidden` row with a live countdown — so `/pricing` §Coding Plan usage carries a hidden second DeepSeek V4.1 Flash row quoting `$60 / week` on Go (*"During the campaign week, Go Coding Plan credits at off-peak rates provide up to $60 in DeepSeek V4.1 Flash usage equivalent. This is not extra credit"*). A scraper that ignores `hidden` reads `0.25×` and `$60/week` as current. Both are recorded only so they can be told apart from the standing values.

## Model ids

`GET https://amr-link.open-design.ai/v1/models` returns 14 models, all `enabled: true`, `owned_by: vela`. Every id in the multiplier table above matches a returned id exactly — the page labels are display names, and **the wire id is the key**, because it is what the store records on a turn.

Spellings that differ between page and wire:

- `GLM-5.3 Flash-X` → wire `glm-5.3-flashx`; `/help/billing` writes `GLM-5.3 Flash-X`.
- `Claude Haiku 5.5` → wire `claude-haiku-5.5`; the repo's own catalog (`opencode-plugin/src/catalog.ts`) keys it `claude-haiku-5-5`.

Absent from the gateway: every "Top Model" the pricing page lists — GPT-6 Astra, Claude Fable 5.2/5.1, Claude Opus 5.5, GPT-6 Sol, GPT-6.1 Terra, Kimi K3.1 Pro, Muse Ember, Muse Spark 1.3, Gemini 4 Argon, Kimi K3, Grok 4.7, Gemini 3.8 Flash, Claude Sonnet 5.5, Muse Wonder. None of them has a wire id, so no stored turn can be keyed to one today.

## What a consumer should take from this

- Use `plans.<id>.caps[wireId]` first, `plans.<id>.defaultCaps` when the model has no row (Go and Plus are the only plans with more than one set; Pro and Max publish one set covering the Coding Plan models).
- Treat `fiveHour: null` as "no such window", never as an unlimited cap and never as zero.
- Read `multiplier` for pricing, but do not silently resolve `claude-haiku-5.5` — the 2-vs-4 question is one page's `4×` against another page's silence, and the store's current `2` has no published source.
- Do not treat `/help/billing`'s Pro/Max `$360/$600` Coding Plan maxima as current; its own 7-day figures and both other pages say `$660/$1,110`.

## Conflicts index

Seven entries in `od-caps.json.conflicts`, each with its quotes. Summary:

| field | status | what settles it |
| --- | --- | --- |
| `plans.go.caps` | resolved | Eco set on 4 pages; original Flash month on 2, week/5h on 1 only |
| `models.claude-haiku-5.5.multiplier` | **open** | one page says 4×, the other publishes no Haiku row at all |
| Pro / Max Coding Plan caps | **open** | $360/$600 vs $660/$1,110, each internally coherent with its own 7-day pair |
| plan names | open (cosmetic) | long form on 3 pages, short on 1; no rename |
| `fiveHour` on Plus/Pro/Max | resolved | three pages agree: only Go has a 5-hour window → `null` |
| "combined" vs "monthly maximum" | resolved | same figure, two column names; `Design Plan` survives only as an anchor id |
| `plans.go.topModelCredits` | resolved | 0, explicitly stated four times |

Two figures in this file rest on a single page and are marked as such rather than smoothed:

- Original DeepSeek V4.1 Flash 7-day `$30` and 5-hour `$10` on Go — `/help/billing` only. pricing.md declines to restate them (*"Original Flash peak-rate billing and all other plans remain unchanged"*), and `/model-credits`' per-plan table lists only the Eco numbers. The `$120` month is on two pages.
- `GLM-5.3 Flash-X` `2×` and `GPT-6 Luna` `4×` — `/help/billing` only; `/model-credits` has no row for either.

The English and Chinese editions of both `/help/billing` and `/model-credits` agree with each other on every figure quoted above, including the absent Haiku row. That is why the omissions are treated as real rather than as a failed fetch.

## Reproduce

```sh
curl -sSL https://open-design.ai/pricing.md | rg '\$220|\$290|\$660|\$1,110|per 7 days|per 5 hours'
curl -sSL https://open-design.ai/help/billing/ | rg 'Maximum credits per 7-day|Combined monthly maximum|Claude Haiku|concurrent'
curl -sSL https://open-design.ai/model-credits/ | rg 'Monthly maximum|multiplier|No limit window'
curl -sSL https://open-design.ai/pricing/ | rg 'shared concurrent tasks|model-allowance-label|dpu-row'
curl -sSL -H "Authorization: Bearer $OD_KEY" https://amr-link.open-design.ai/v1/models | rg -o '"id":"[^"]+"'
```

Two traps that cost real time while building this:

- `/pricing` is a rendered Astro page with **no `<table>` elements**; the caps live in `data-usage-value="go|plus|pro|max"` spans inside `div.dpu-row`, and model allowance labels sit in `span.model-allowance-label`. A table extractor finds nothing and reads as "no caps published".
- `/model-credits` sends **one multiplier table for all four plans**; the `Go / Go Plus / Go Pro / Go Max` tab buttons only swap the `data-eco-multiplier-row` visibility. There are not four tables — reading the tabs as four tables loses the shared rows.
