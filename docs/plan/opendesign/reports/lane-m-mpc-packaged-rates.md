# Lane M — mpc packaged OpenDesign rates

## Choice: shape B (generated TS module inside `src/`)

`scripts/extract-od-rates.ts` reads `core/od.json` and emits
`oc-cmd-compare/src/data/sources/od/od.generated.ts` as a typed constant of all
46 rows. `rates.ts` now imports that module instead of climbing five levels out
of `src/`. Why B: it follows the repo's existing generated-file convention
(`catalog.ts`, `gating.json`), has no JSON-module-resolution dependency in the
installed package, and `files: ["src", "LICENSE"]` ships the copy automatically.
No `prepack` was added — the copy is committed inside `src/`, so pack cannot
omit it, and a `prepack` alone would not be test evidence. Regeneration is
`bun run extract:od` in `oc-cmd-compare`.

## Drift test

`oc-cmd-compare/test/data/od-packaged-rates.test.ts`:

- `the shipped table matches every value in core/od.json` — deep-compares
  `input`, `output`, `cacheRead`, `cacheWrite`, `longContext`, `rateSource`,
  `multiplier` and `label` for every row keyed by id, plus the row count.
- `the drift check notices a single edited rate, cache tier or provenance` —
  mutates one `input`, one `cacheWrite`, one `rateSource` and one
  `longContext.input`, and asserts each is detected.
- `row count alone is not the proof` — same count, one edited output, still fails.
- `the committed generated file is what the generator emits` — runs
  `bun scripts/extract-od-rates.ts --check`, which pins the exact bytes.

## Pack proof

`cd oc-cmd-compare && bunx npm@latest pack --dry-run`:

```
npm notice 9.3kB src/data/sources/od/od.generated.ts
npm notice name: @jeffreyjyz/mpc
npm notice version: 0.1.13
npm notice total files: 83
```

Real pack into `/private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/mpc-lane-m`,
extracted there, run from that directory (outside the repo, no `core/od.json`
anywhere in the extracted tree):

```
$ cd /private/var/folders/mv/.../opencode/mpc-lane-m/extract
$ bun ./package/src/index.ts --od-plan go --json --shape off --model 'DeepSeek V4.1 Flash'
...
      "od": {
        "provider": "od",
        "plan": "Go",
        "pricing": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.006,
          "cacheWrite": null
        },
        "allowance": 120,
        "costPerRequest": 0.00078,
        ...
      }
...
```

The 0.3 / 1.2 / 0.006 row is exactly `core/od.json`'s DeepSeek V4.1 Flash rate;
the installed package prices the model correctly with no monorepo on the
resolution path. `rg --files <extract> | rg 'od\.json'` returns nothing.

## Gate (foreground, waited)

```
cd oc-cmd-compare && bun test && bun check && bun fmt --check && bunx biome lint
145 pass / 0 fail   ·   No type errors in 106 files
All 114 files are formatted.   ·   biome: 1 pre-existing schema-version info, no findings
bun scripts/extract-od-rates.ts --check → 46 rows match (bytes identical)
```
