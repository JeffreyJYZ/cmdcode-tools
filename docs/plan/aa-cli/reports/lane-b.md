# Lane B report — manifest discover + decrypt

## Deliverables

- `src/sources/discover.ts` — `discoverManifests(html)` / `discoverManifest(html)` over lane A's
  `decodeFlight` (imported, not copied), plus `manifestIv`, `decryptManifest` and the bounded `request`.
  Returns `null`/`[]` on a page without a reference; never throws.
- `src/sources/manifest.ts` — `loadManifest()`: homepage → discover → probe candidates → AES-GCM decrypt →
  gunzip → `normalizeRows(rows, "manifest")`. Returns `{models, notes}`; every failure becomes a note.
- `scripts/fetch-fixtures.ts` — maintainer refresh of `test/manifest/` (keeps the real encrypted encoding).
- `test/manifest/discover.test.ts`, `test/manifest/manifest.test.ts` + fixtures `homepage.txt`, `payload.bin`,
  `fixture.json`.

**Shape verified, not assumed.** The homepage embeds five manifests (one per chart); the catalogue is the
first whose payload parses as `{models: [...]}`. The `key` rotates per request, so it is always read from
the page. The payload has no `indexVersion` — that is the API source's alone.

## Live proof (cacheTtlMs: 0, 2026-11-20)

`bun /tmp/aa-b-proof.ts` (loads `manifest.ts`, then `leaderboard.ts`):

```
manifest models: 534          (762 upstream rows, effort variants collapsed)
manifest with index: 84       (156 upstream rows carry one)
manifest notes: []
manifest seconds: 2.4
leaderboard models: 198 with index: 68 notes: []
scored models the manifest has that the leaderboard lacks: 16
  gpt-6-sol, gpt-5-6-luna, claude-fable-5-1, gpt-6-1-sol, claude-opus-5, …
```

**The manifest beats the leaderboard on coverage, plainly:** 534 models vs 198 (2.7×) and 84 scored vs 68,
with 16 scored models the leaderboard never lists. `indexVersion` is absent (manifest publishes none);
notes are empty. Decrypt path confirmed against the live payload with `node:crypto` GCM.

Integration check through lane A's `loadCatalogue({cacheTtlMs: 0})` — 384 models, sources
`["manifest","leaderboard","models"]`, 42 scored, 0 notes, 4.5 s. The drop below 534 is lane A's
key-merge folding (reported under "for lane A"), not lost manifest rows.

## Gates (from `aa-models/`)

| command | verdict |
| --- | --- |
| `bun test test/manifest` | 14 pass, 0 fail (41 expects) |
| `bun test` (whole package) | 103 pass, 0 fail |
| `bun check` | no type errors, 38 files |
| `bun fmt --check test/manifest src/sources/discover.ts src/sources/manifest.ts scripts/fetch-fixtures.ts` | all 6 files formatted |
| `bun fmt --check` (package-wide) | **6 files need formatting — all lane A's** (`src/model.ts`, `src/sources/api.ts`, `src/sources/leaderboard.ts`, `src/sources/normalize.ts`, `test/sources/fixtures/{leaderboard,models}.fixture.html`); I did not touch another lane's files |
| `bunx biome lint src/sources/discover.ts src/sources/manifest.ts test/manifest scripts/fetch-fixtures.ts` | no fixes applied, clean |

## Deviations and notes for lane A

- `request`/`decryptManifest` live in `discover.ts`, not `manifest.ts`: the 150-line cap forced one split and
  both files stay inside lane B's ownership. Decrypt is synchronous (`node:crypto`) — `@types/bun` under
  TS 7 rejects every `Uint8Array` shape at `crypto.subtle.decrypt`, so WebCrypto was unusable.
- Fixtures are `.txt`, not `.html`: `bun fmt` rewrites saved HTML into a single-quoted push chunk, which
  defeats the escaping the discovery test proves.
- For lane A: `model.ts::normalizeRow` turns `effort.label` into join keys (`max`, `reasoning`, `high`), so
  unrelated families share keys and `mergeModels` folds them (534 manifest models → 384 merged). Only 42 of
  the merged 84 scored survive as distinct entries. Suggest dropping effort labels from `keys`.
