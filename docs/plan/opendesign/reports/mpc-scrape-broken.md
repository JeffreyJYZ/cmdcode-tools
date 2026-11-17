# mpc Go catalog scraper broken — investigation & fix

Date: 2026-11-17. Scope: `oc-cmd-compare/src/data/sources/opencode.ts`,
`src/data/scrape/**`, `src/constants/sources.ts`, fixtures/tests.
Another lane owns `src/data/sources/od/**`; untouched.

## 1. What the live pages actually serve

Fetched with `bun` (the same `fetch` path `fetchText` uses), user-agent
`mpc/0.1 (+model price compare)`. Curl gets `SSL_ERROR_SYSCALL` on this
machine; bun and webfetch reach the site fine.

### `/v2/docs/console/go/` (current `DOC_URL`)

bun fetch: `ECONNRESET`. Webfetch renders a docs article. Its tables are:

- `Plan | Price | Included usage`
- `Client | Session support`
- `Client | Status and tracking`
- `Model | Data retention`

**No table with `Input` / `Output` / `Monthly limit` headers remains.**

### `/docs/console/go/` (audit lane's claimed new URL)

HTTP 200, 64558 bytes, **4 tables, 0 `role="tab"`, 0 `role="tabpanel"`**.
Same four headers as above — no pricing table.

So the audit lane is **partly right**: the canonical docs URL moved from
`/v2/` to `/docs/`, and the page has no `role="tab"` markers. But the deeper
change is that **the per-model price/limit tables left the docs page
entirely**. The page now says "See the current list of models" and links to
`https://opencode.ai/console/go#models`. Re-pointing `DOC_URL` or making
`parseTabTables` label-agnostic cannot recover data that is no longer in the
HTML.

Quoted tags from the new docs page (representative):

```html
<table>
  <thead><tr><th>Plan</th><th>Price</th><th>Included usage</th></tr></thead>
</table>
<!-- no role="tab", no role="tabpanel", no <th>Input</th> anywhere -->
```

### `/console/go` (where the docs now point)

HTTP 200, 153257 bytes, **1 table, 0 `role="tab"`**. Headers:

```html
<th>Model</th><th>Relative request allowances</th>
<th>Est. requests / 5 hr</th><th>Monthly limit</th>
```

Rows carry `<tr data-model="kimi-k3">` and per-plan values in
`<span data-layer="allowance" data-plan="go">$15</span>` /
`<span data-layer="allowance" data-plan="go-plus">$60</span>`.
Monthly limits are here, but **no token prices** (no `Input`, `Output`,
`Cache read`, or `Cache write` columns; no `/1M` text).

### The authoritative replacement

`https://opencode.ai/zen/go/v1/models` (`OC_MODELS_URL`, already used by
`--check`) answers 200 with 32 models. Each object carries everything mpc
needs:

```jsonc
{
  "id": "kimi-k3",
  "name": "Kimi K3",
  "cost": { "text": {
    "input": { "price": 3, "cache": { "read": 0.3, "write": 3 } },
    "output": { "price": 15 }
  }},
  "go": { "monthly_usage": { "go": 15, "go-plus": 60, "go-teams": 20 } }
}
```

Free models have `monthly_usage: null` and all prices 0.
Cache-write can be a number or a TTL map (`{"30m":0.125,"12h":0.25}`);
the parser takes the first value. The API publishes one price set — there
are no peak/off-peak or context-tier rows, so `--peak` becomes a no-op at
this source (noted below).

Key normalization must use `id`, not `name`: the API name
`DeepSeek V4.1 Flash 1017` normalizes to `deepseekv41flash1017`, which
misses CommandCode's `deepseekv41flash`; the id `deepseek-v4.1-flash`
normalizes correctly.

## 2. Fix

- Switch `loadOcGoCatalog` to fetch `OC_MODELS_URL` and parse the JSON via a
  pure `parseOcGoModels` helper in `src/data/scrape/catalog/ocModels.ts`.
- Add `usageKey` (`go` / `go-plus`) to `OcPlanDef` in `src/constants/sources.ts`
  so the plan-to-JSON-field mapping lives with the plan definition.
- Repoint `DOC_URL` to `https://opencode.ai/docs/console/go/` so references
  and error text name a live page; it is no longer the catalog source.
- Leave `parseTabTables` / `extractCatalog` intact — CommandCode and the
  benchmark scraper still use them, and `extractCatalog` already selects
  tables by headers, not attributes.

## 3. Verification

All from `oc-cmd-compare/`, baseline was `exit=1` with the "no model table
parsed" message. After the fix:

```
bun run src/index.ts --json --shape off              exit=0  rows=80
bun run src/index.ts --json --shape off --oc-plan go exit=0  rows=80
bun run src/index.ts --json --shape off --oc-plan go-plus exit=0 rows=80
bun run src/index.ts --json --shape off --bench cc   exit=0  rows=80
bun run src/index.ts --oc-plan go                    exit=0  text-lines=104
bun run src/index.ts --check                         exit=0  32 OC entries, 0 ids missing
```

Plan selection is real, not a no-op: `glm-5.3-flash` allowance is 60 on Go
(credits total 1135) and 180 on Go Plus (credits total 3450); token rates are
identical.

Gate (`oc-cmd-compare/`):

```
bun test          136 pass / 0 fail / 410 expect() calls (23 files)
bun check         No type errors in 100 files
bun fmt --check   All 108 files are formatted
bunx biome lint   Checked 106 files; 0 errors, 0 warnings (1 version-migrate info)
```

Regression fixtures: `test/fixtures/oc-go-models.json` (trimmed live API
payload covering bake-dated name, TTL-map cache write, scalar cache write and
two free models) and `test/fixtures/oc-go-docs.html` (the four-table
no-`role="tab"` docs shape). Assertions name the fixture, so a future upstream
change points at the saved source instead of a bare runtime error. The HTML
fixture's leading comment mentions `role="tab"`; the test strips comments
before asserting so the check targets markup only and still fails if a tabbed
priced table reappears.

Docs updated in the same turn: `oc-cmd-compare/AGENTS.md` (Sources and drift)
and `README.md` (Data sources table). `src/cli/flow/check.ts` status string
now says "Go catalog" instead of "docs table".

## 4. Known consequence

The JSON endpoint publishes one price set; it has no peak/off-peak or
context-tier rows. `--peak` is accepted for interface parity but has no effect
on the OC side. The old docs table's duplicate variant rows are gone upstream.
