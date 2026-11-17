# OpenDesign doc-drift research (2026-11-17)

Read-only. Every claim below came from a URL fetched this turn or a repo file read this turn.

## 1. Machine-readable surface: `pricing.md` is partial

Fetched `https://open-design.ai/pricing.md` (HTTP 200, ~2.6 KB). It is the only maintained
machine-readable price page (`llms.txt` itself says "Machine-readable pricing:
https://open-design.ai/pricing.md"), but it does **not** carry every cap in
`docs/plan/opendesign/reference/od-caps.json`:

Present:
- `Coding Plan: up to $220 / month with DeepSeek V4.1 Flash Eco` (§Go)
- `Go displays up to $220/month, $55/7 days and $18/5 hours; Go Plus Coding Plan displays up to $290/month and $74/7 days, with no 5-hour window.` (§Go)
- `both at a 0.27 consumption multiplier` (Eco, §Go)
- `Coding Plan: up to $290 / month and $74 / 7 days ... maximum combined monthly model credits: $310` (§Go Plus)
- `Coding Plan: up to $660 / month; maximum combined monthly model credits: $780` (§Go Pro)
- `Coding Plan: up to $1,110 / month; maximum combined monthly model credits: $1,410` (§Go Max)
- prices, first-month prices, annual prices, concurrency 10/20/30/50, cloud deploys 3/20/50, `$2 each` overage.

Missing relative to `od-caps.json`:
- Original Flash caps: Go `$120/$30/$10`, Plus `$160/$40` — page says only `Original Flash peak-rate billing and all other plans remain unchanged.`
- Pro/Max 7-day `$90`/`$150` (the numbers that decide the open Pro/Max conflict).
- The original Flash `0.5×` multiplier and **all 12 other model multipliers** (MiniMax, Hy4, DS4 Flash/Vision/Pro, GLM, Kimi, MiMo ×2, Flash-X 2×, Haiku 4×, Luna 4×). `pricing.md` names only two models.
- All 14 wire ids, the `modelsNotInCodingPlan` / top-model lists, `imageGeneration`, `defaultCapsModel`, short plan spellings, the top-model bonus wording (`limited-time 20%/50%`), and the expired promo.
- Token rates (`core/od.json` input/output) — no page publishes them.

So `pricing.md` is a **Go/Plus headline-caps summary**, not a substitute for the reference file.

## 2. Generated surfaces — URLs actually fetched

- `https://open-design.ai/llms.txt` — HTTP 200. Curated index, not generated cap data; points to `/pricing.md` and `/blog/rss.xml`.
- `https://open-design.ai/llms-full.txt` — HTTP **404** (`text/html`, 148744 bytes: the SPA 404 page).
- `https://open-design.ai/openapi.json`, `/api/openapi.json`, `/pricing.json`, `/schema.json`, `/pricing/index.json`, `/api/pricing`, `/plan.json`, `/v1/models` — all HTTP **404** (`text/html`, 148744 bytes). No OpenAPI, JSON schema, or build-time price JSON at those paths.
- `https://open-design.ai/blog/rss.xml` — HTTP 200, `application/xml`, 48886 bytes. Blog only (posts dated `Sun, 08 Nov 2026`, motion/animation topics); no pricing or model-cap entries.
- `https://open-design.ai/sitemap-index.xml` — HTTP 200, `application/xml`, 1387 bytes; 17 child sitemaps.
- `https://open-design.ai/sitemap-pages-0.xml` — HTTP 200; contains `https://open-design.ai/updates/`.
- `https://open-design.ai/updates/` — HTTP 200. Changelog with JSON-LD `SoftwareApplication` entries (`datePublished`, `releaseNotes`) but newest entry is `<time datetime="2026-10-15">October 15, 2026</time>` (v0.25.0, OpenDesign Motion). **No Eco/Flash entry anywhere on that page** — this week's split never reached the changelog.
- `https://amr-link.open-design.ai/v1/models` — HTTP 200 with `OD_KEY`; live JSON: `{"data":[{"id":"claude-haiku-5.5",...,"created":1791441624,"owned_by":"vela",...}, ...]}`, 14 ids including `deepseek-v4.1-flash-eco`. It carries ids/modalities/`created` timestamps, **no prices, caps, or multipliers**.
- `https://open-design.ai/robots.txt` — HTTP 200, text/plain; confirms `llms.txt` and the RSS as the only advertised machine surfaces.

## 3. Change detection — recommendation

Cheapest reliable monitor: **hash the three canonical pages, not one** —
`sha256(pricing.md)`, `sha256(/model-credits/)`, `sha256(/help/billing/)` — and diff
`/v1/models` id set + `created` values. When a hash moves, extract the structured fields
(caps, multipliers) and diff those; store the diff as the review artifact.

Why not the alternatives alone:
- `sha256(pricing.md)` only is cheapest but blind to the Haiku 4× row (only on `/help/billing`) and the Pro/Max `$360/$600` generation (only on `/help/billing`), and to the 0.25× promo (only on `/model-credits`).
- Structured diff of `/v1/models` catches a new wire id — Eco is present with a `created` timestamp — but cannot see a cap change (e.g. `$220` → `$240`) or a multiplier change (`0.5` → `0.4`); the API has no such fields.
- Card-DOM scraping is the worst: `/pricing` has **no `<table>`**, caps live in `div.dpu-row` → `span[data-usage-value="go|plus|pro|max"]`, and hidden/promotional rows are mixed in (see §4). Class hashes (`data-astro-cid-*`) rotate.

What each would have missed **this week**: a URL/page-list watcher (sitemap or headings) misses the Eco/Flash split entirely — it is the same `pricing.md` URL and the same `/pricing` page, with one new sentence and one new `data-eco-usage-row`. The changelog also misses it (last entry 2026-10-15). A `pricing.md` hash catches it if a baseline exists; an id-set diff catches the new `deepseek-v4.1-flash-eco` id; a multiplier-table scrape would see the new 0.27× row only if the table is re-read, not cached from `/model-credits` alone (that file's own multiplier table is the shared one with `data-eco-multiplier-row` visibility toggles).

## 4. The expired promotion — still served

`/pricing/` (fetched this turn) still serves the hidden campaign row verbatim:

`<div class="dpu-row" role="row" data-deepseek-valley-row hidden data-astro-cid-5m7qv5gr> ... <strong ...>DeepSeek V4.1 Flash</strong> <small class="dpu-valley-badge" data-deepseek-valley-badge hidden ...>Off-peak promo</small> ... <span data-usage-value="go" ...><span class="dpu-week-amount" ...> $60 / week <span class="dpu-week-help" data-week-help role="tooltip" hidden ...>During the campaign week, Go Coding Plan credits at off-peak rates provide up to $60 in DeepSeek V4.1 Flash usage equivalent. This is not extra credit; shared allowances and reset times stay unchanged.</span>`

Plus a hidden banner and a stuck timer:
`<aside class="deepseek-valley" data-deepseek-valley-banner hidden aria-label="OpenDesign Motion Week · DS off-peak rates..." ...>` and `<strong data-pricing-top-countdown ...>0d 00:00:00</strong>`.

The `0.25×` itself is live on `/model-credits/`, not `/pricing/`:
`<span id="deepseek-multiplier-help" role="tooltip" hidden ...>The limited-time off-peak offer lasts one week: October 20 at 18:00 to October 27 at 18:00 (UTC+8). The multiplier drops from 0.5× to 0.25×, then returns to 0.5×. ...</span> ... <span class="multiplier-value" ...>0.25×</span>`
and an off-peak note paragraph repeating `from 0.5× to 0.25×`.

A scraper must exclude: any element with `hidden`, `[aria-hidden="true"]`, `[inert]`, `style="display:none"`, or the `data-deepseek-valley-*` / `data-week-help` / `data-multiplier-help` attributes; and must key multipliers by standing row (the `0.5×` row, not the campaign `0.25×` row). A text-only scrape of the HTML reads the expired 0.25× and `$60/week` as current.

## 5. What `oduse` should do

`core/od.json` is compiled in with `"extractedAt": "2026-11-16"` (one day older than the 2026-11-17 reference) and still carries `claude-haiku-5.5` at `multiplier: 2` with no published source. That is the drift cost, made visible.

Honest and cheap: keep `core/od.json` as the **authoritative billing input** and add a staleness check, not a silent swap.
- Warn when `extractedAt` is older than N days (N=7 is a reasonable default), printing the compiled date and the URL to re-check — one line, no failure. This is free at startup (a constant comparison).
- Additionally, cache a daily hash of `pricing.md` + `/model-credits` + `/help/billing` (one small GET per day, done off the critical path, stored next to the config); on a hash change, warn that the compiled snapshot may be stale and name the changed page. Cost: three small GETs once per day, ~0 ms on a warm cache; never block the first render on network.
- Prefer a fetched file **only when explicitly supplied or already cached and validated** (shape check + recorded sha); never silently replace compiled numbers at startup — that would change billing math without review and would import the expired 0.25× / `$360` generation if the fetch lands on a hidden or conflicting row.
- Record `source`, `extractedAt`, and the source hashes in `core/od.json` so a warning can say *which* page moved. That is what turns "the caps will rot" into a visible, cheap signal instead of a silent wrong number.
