# Lane brief — canonical OpenDesign cap table

Build one reference table of what OpenDesign actually publishes, so the CLI, the sidebar and mpc stop each inventing caps. Output: `docs/plan/opendesign/reference/od-caps.json` plus a short `README.md` in the same directory naming the page and quote behind every number.

## What must be in it

Per plan (`go`, `plus`, `pro`, `max`) and, where the plan differentiates, per model class:

- monthly cap, 7-day cap, 5-hour cap (a plan that publishes no window must say `null`, never `0`)
- top-model credits (Go has none)
- concurrency
- price (regular monthly), and the current promotion if one is live
- the credit multiplier per model

## Source pages, all of which are currently inconsistent

- `https://open-design.ai/pricing.md` (machine-readable)
- `https://open-design.ai/pricing/` (live page, richer)
- `https://open-design.ai/help/billing/`
- `https://open-design.ai/model-credits/`

Known disagreements to resolve or record, do not smooth them away:

1. **Go's caps depend on the model.** Eco: `$220/mo, $55/7d, $18/5h`. Original Flash: `$120/mo, $30/7d, $10/5h`. Confirm both from two pages each.
2. **Claude Haiku 5.5's multiplier.** `/model-credits` says `2×`, `/help/billing` says `4×`. Record the conflict with both quotes; do not pick silently.
3. **Plan naming.** The pricing page now says `Go / Go Plus / Go Pro / Go Max` while `/help/billing` says `Go / Plus / Pro / Max`. Record both, and which spelling each number came from.
4. Anything else that differs between pages, including totals like "combined monthly maximum" vs "Design Plan monthly maximum".

## Shape

```json
{
  "extractedAt": "2026-11-17",
  "sources": { "pricingMd": "...", "billing": "...", "modelCredits": "..." },
  "plans": {
    "go": {
      "price": 10, "concurrency": 10, "topModelCredits": 0,
      "caps": {
        "deepseek-v4.1-flash":     { "month": 120, "week": 30, "fiveHour": 10 },
        "deepseek-v4.1-flash-eco": { "month": 220, "week": 55, "fiveHour": 18 }
      },
      "defaultCaps": { "month": 120, "week": 30, "fiveHour": 10 }
    }
  },
  "models": [ { "id": "...", "label": "...", "multiplier": 2, "rateSource": "published|estimate", "matches": ["..."] } ],
  "conflicts": [ { "field": "models.claude-haiku-5.5.multiplier", "values": { "modelCredits": 2, "billing": 4 }, "quotes": ["..."] } ]
}
```

`matches` lists every slug spelling the same model is sold under (`glm-5.3-flashx` vs `glm-5.3-flash-x`, `claude-haiku-5.5` vs `claude-haiku-5-5`) — the wire ids from `https://amr-link.open-design.ai/v1/models` are authoritative for what the store records.

## How to verify

- Fetch each page yourself and quote the line beside each figure in the README. A number with no quote does not go in.
- `GET https://amr-link.open-design-api.ai/v1/models` (`Authorization: Bearer <key in ~/.config/open-design/env>`) for the authoritative model ids; note any id the pricing pages spell differently.
- Do not invent a cap for a plan/model pair the pages leave unstated; `null` plus a `conflicts`/`notes` entry is correct.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, no commit/push/branch. This is a data file plus documentation — no code changes in `cmduse/`, `opencode-plugin/` or `oc-cmd-compare/`.
