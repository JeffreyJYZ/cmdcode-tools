# Lane B notes — AA manifest

## Findings (measured 2026-11-20)

- The homepage embeds **five** `{path,key}` manifests, one per chart. The model catalogue is the one whose decrypted payload is `{models:[...]}`; the others are arrays (cost-per-task chart) or media objects. Never pick by path — probe each candidate and keep the first that parses to models.
- The `key` **rotates every request**; the path looked stable across two sessions (`/data/b2ca3023f67eb50f.txt`) but only the page's own key works. Never cache a key.
- Payload measured: **762 rows → 534 models** after lane A's collapse, **156 rows carry `intelligenceIndex` → 84 models scored**. Leaderboard for comparison: 198 models, 68 scored, and 16 scored models the leaderboard lacks.
- Manifest rows carry **no price, output speed, latency, context window or max output** — every such field stays `null` from this source alone.
- The manifest payload's top level is `{models, defaultEffortHighlightedIds, capabilityModels, cyberIndexModels, decisionIndexContestants, changelog, codingAgents}` — **no `indexVersion`**; only the API source can supply one.
- `release.slug` is the model identity; `slug` is the per-effort row. Lane A's `normalizeRows(rows, source)` already groups by release slug, folds variants and fills modalities/evals/keys — reuse it, never duplicate the normalizer.

## Quirks

- **TS 7 + `@types/bun`: `crypto.subtle.decrypt` rejects a `Uint8Array<ArrayBufferLike>`** ("not assignable to BufferSource"), and every copy/narrowing still typed as such. Use `node:crypto` `createDecipheriv("aes-256-gcm", key, iv)` + `setAuthTag(last 16 bytes)` — same bytes, no DOM typings.
- **`bun fmt` reformats a saved `.html` fixture** into a single-quoted push chunk, which silently kills the RSC escaping the test exists to prove. Name fixtures `.txt`; the formatter leaves them alone.
- `src/sources/index.ts` resolves `./manifest.ts` with a dynamic import and expects `loadManifest(): Promise<{models, notes}>` — optional options are fine, a different name is not.
- Effort labels become join keys in `model.ts::normalizeRow` (`aaKeyVariants(effort.label)`), so keys like `max` / `reasoning` are shared across families and `mergeModels` folds those models together (merged 384 models / 42 scored vs manifest's 534 / 84). Reported to lane A; not lane B's file.

## Tests

- Offline: real RSC fragment (`test/manifest/homepage.txt`), AES-GCM payload (`payload.bin`, sealed with a fixture key), a page with no manifest, a 4xx that must not retry, an unscored row that stays `null`, and the evals dot-paths.
- Refresh fixtures with `bun scripts/fetch-fixtures.ts` from `aa-models/` (network on, writes all three files).
