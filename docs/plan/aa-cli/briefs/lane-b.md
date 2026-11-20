# Lane B — the full covered set: discover and decrypt AA's manifest

Read `docs/plan/aa-cli/contract.md` first. You own `src/sources/manifest.ts`, `src/sources/discover.ts`,
`test/manifest/*` and `scripts/fetch-fixtures.ts`.

## Goal

AA publishes a complete model list that neither the leaderboard page nor the `/models` page carries. It
lives behind a Next.js **manifest** reference embedded in the homepage RSC payload, as an object like
`manifest: { path: "/data/<hex>.txt", key: "<hex>" }`. The file is AES-GCM encrypted; the plaintext is
gzipped JSON. Measured, from an earlier session on this machine, so treat it as a lead and re-verify:

- IV = the first 12 bytes of `SHA-256(key)`.
- Decrypt, then `DecompressionStream("gzip")` (or node zlib) to get JSON.
- The payload is ~757 models with ~146 carrying an Intelligence Index — more than any other endpoint.

Verify every step yourself; if the shape moved, follow it and say so. Nothing in the brief is a
substitute for the bytes.

## Deliverables

1. `src/sources/discover.ts` — `discoverManifest(html)` pure: find the manifest reference in the homepage
   RSC payload (reuse lane A's `decodeFlight`/`readArray` idea; if `#~/sources/flight.ts` exists, import it
   rather than copying), return `{ url, key }` or `null`. Do not throw on a page that lacks it.
2. `src/sources/manifest.ts` — `loadManifest()`: fetch the homepage, discover, fetch the payload, decrypt,
   gunzip, parse, and return `{ models: Model[], notes: string[] }` using **lane A's `Model` shape and
   normalizer** (`#~/model.ts`). Every model it yields must carry `sources: ["manifest"]` and its `keys`
   from `aaKeyVariants`. Fields AA does not publish there stay null; put every other finite scalar under
   `evals` with its dot-path.
3. Bound every request: `AbortSignal.timeout(20_000)`, one retry on a network error, no retry on a 4xx.
   Add a `user-agent` naming the tool. Failure returns `notes`, never an exception the caller cannot read.
4. `scripts/fetch-fixtures.ts` — a maintainer script that writes a trimmed real payload into
   `test/manifest/` so the tests stay offline. Trim to a handful of models, keep the real encoding
   (encrypted bytes or the decrypted JSON — your call, but the test must exercise the decrypt path if you
   keep it encrypted, so keep at least one encrypted fixture).
5. Tests: discovery against a small saved homepage fragment, decrypt against the kept fixture, and the
   "no manifest on the page" path returning `null` instead of throwing. Plus one test that a manifest row
   with no index keeps `intelligenceIndex: null`.

## Proof

From `aa-models/`, a live run with `cacheTtlMs: 0` printing the count, how many rows carry an index, the
index version if present, and the notes. Quote the numbers, and say plainly whether the manifest beat the
leaderboard on coverage.

Report to `docs/plan/aa-cli/reports/lane-b.md`. Keep notes in `docs/agents/aa-b.md`.
