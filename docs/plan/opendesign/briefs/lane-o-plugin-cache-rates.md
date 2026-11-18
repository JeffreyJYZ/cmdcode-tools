# Lane O — the plugin still tells opencode that OpenDesign cache reads are free

## The defect, located

Lane J's review flagged this as a Nit and explicitly said it is *not* a regression — the diff only touched the `rateSource` filter:

> **`opencode-plugin/src/catalogOpenDesign.ts:134-136` still advertises `cache: {read: 0, write: 0}`** for every model while the release now prices cache reads from the published list. The plugin's model records still tell the host cache reads are free.

Measured on the tree:

```
opencode-plugin/src/catalogOpenDesign.ts:57   odCost(id) → { input, output }        ← cache dropped here
opencode-plugin/src/catalogOpenDesign.ts:135  ? [{ input, output, cache: { read: 0, write: 0 } }]
```

`core/od.json` carries a published `cacheRead` for every one of its 46 rows (`0.006` for DeepSeek V4.1 Flash, `0.0028` for MiMo V2.6 Flash, `0.19` for Kimi K2.7 Code). The model record says zero.

**Why this matters more than a Nit:** that record is what opencode itself reads to compute and display cost, and it is what the host uses for context accounting. Cache reads are ~99% of this provider's token mass — 2.15 billion of them in the last week, `$12.91` of a `$20.45` list bill. Telling the harness they are free means every cost figure opencode derives for a `open-design-*` lane is wrong by roughly the whole bill, and it is the same lie that made the user ask whether the console figure was a scam.

## What to change

1. **Carry `cacheRead` and `cacheWrite` through `odCost`** into the record's `cache: { read, write }`, from the same `core/od.json` row the input/output rates already come from. A row with no published `cacheWrite` (every DeepSeek row) must be `0` for write — the host's schema wants a number, and an absent write rate genuinely means "not charged".
2. **Keep the unpriced case unpriced.** A model with no `published` row keeps `cost: []`; do not fabricate a zero-cost record, which reads as "free" rather than "unknown".
3. **Check what else reads that record.** `rg -n 'odCost|modelRecords|cache: \\{ read' opencode-plugin/src` — if the OpenDesign seed path (`OPEN_DESIGN_SEED`) or the live-list merge builds a record elsewhere, it must carry the same fields. One path with cache and another without is the same defect wearing a different hat.
4. **Tests.** `opencode-plugin/test/catalogOpenDesign.test.ts` and `test/catalog.test.ts` exist. Assert: a published row's record carries its published `cache.read`; a row with no published `cacheWrite` carries `0`; a model with no published row still yields `cost: []`; the DeepSeek V4.1 Flash record matches `core/od.json` exactly (quote the numbers from the file in the test, so a rate edit fails it).
5. **Check the sibling side.** `catalog.ts` (the Command Code catalogue) already carries real cache rates — look at how it represents them and match that shape, rather than inventing a second convention. If the two differ for a reason, say what the reason is.

## Verify

```sh
cd opencode-plugin && bun -e 'import { modelRecords, OPEN_DESIGN_SEED } from "./src/catalogOpenDesign.ts"; const r = modelRecords(OPEN_DESIGN_SEED) as any[]; const f = r.find(x => x.id === "deepseek-v4.1-flash"); console.log(JSON.stringify(f?.cost));'
```

must print a cost entry with `cache.read: 0.006` — not `0`. Paste it. Then confirm an unpriced model still prints `[]`.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything. A release is in flight; do **not** touch tags, remotes, or versions.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/catalogOpenDesign.ts` and `opencode-plugin/test/catalogOpenDesign.test.ts` (plus `test/catalog.test.ts` if the shared shape needs an assertion there). **Do not touch** `core/od.json`, `cmduse/**`, `oc-cmd-compare/**`, `opencode-plugin/src/sidebar/**`, `src/index.ts`, `src/v2.ts`, or any version file — a release lane is pushing those right now and a second writer loses one of the two changes.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call.

## Report

Append to `docs/plan/opendesign/reports/lane-o-plugin-cache-rates.md`. Final chat reply under 12 lines: the before/after cost record, the tests added, the gate result. Note the tree is mid-release, so say whether your change needs its own version bump or can ride the next patch.
