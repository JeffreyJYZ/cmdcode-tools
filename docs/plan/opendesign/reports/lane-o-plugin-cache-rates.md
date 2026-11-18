# Lane O report — plugin OpenDesign cache rates

## Change

`opencode-plugin/src/catalogOpenDesign.ts`: `odCost()` now returns `cacheRead` and `cacheWrite` from the same published `core/od.json` row, with an absent `cacheWrite` coerced to `0`. `modelRecords()` builds the cost entry from those fields instead of the hardcoded `cache: { read: 0, write: 0 }`. Unpublished models still get `cost: []`. No other builder path constructs an OpenDesign record — `rg` found only `modelRecords()` (called by `providerOpenDesign.ts` with `OPEN_DESIGN_SEED`) and the v2 Command Code path, so no second convention to reconcile. The sibling `catalog.ts` uses flat `cacheRead`/`cacheWrite` and `v2.ts` maps them to `cache: { read, write }`; this file builds records directly, so it now produces the identical `cache: { read, write }` shape.

## Before / after (DeepSeek V4.1 Flash)

Before:
```
[{"input":0.3,"output":1.2,"cache":{"read":0,"write":0}}]
```

After (verify command from the brief):
```
[{"input":0.3,"output":1.2,"cache":{"read":0.006,"write":0}}]
```

Unpriced model still prints `[]`:
```
[]
```

## Tests

`opencode-plugin/test/catalogOpenDesign.test.ts`: updated the existing price assertions to include `cacheRead`/`cacheWrite` for all three published rows (DeepSeek, Eco, hy4-flash) and added a `published cache rates reach the model record` block asserting: DeepSeek's full record equals `core/od.json` exactly (`0.3 / 1.2`, read `0.006`); a row without published `cacheWrite` advertises write `0`; an unpriced model emits `cost: []`. `test/catalog.test.ts` needed no change — that file covers the Command Code catalogue, which already carries real cache rates.

## Gate

`bun test && bun check && bun fmt --check && bunx biome lint`: 342 pass / 0 fail (1362 expects), no type errors in 80 files, 89 files formatted, biome lint exit 0. Applied `bun fmt` to the two edited files first. Biome printed a schema-version `info` (config declares 2.6.3, CLI is 2.6.7) — informational, exit 0, not a failure.

## Release

No commit, tag, push, version bump or remote touched. Tree is mid-release (`cmduse-v0.8.4` pushed and immutable) and a sibling lane owns versions/commits/pushes. This fix needs no dedicated version bump of its own: it is a source-only plugin change that can ride the next patch release the release lane cuts. No change to `core/od.json`, Rust crates, mpc, sidebar, index.ts, v2.ts or any version file.
