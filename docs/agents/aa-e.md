# aa-e — `ocuse` live catalogue (lane E notes)

## What changed and why

- `core/zen.json` is `include_str!`-baked (`cmduse_core::ZEN_JSON`), so every limit and rate was frozen
  at release time. It froze: DeepSeek V4.1 Flash read `$80 / 70.8%` against a live `$100`.
- `GET https://opencode.ai/zen/go/v1/models` answers 200 anonymously and carries membership, `cost.text`,
  the peak multiplier and every plan's `go.monthly_usage` (go, go-plus, go-teams). So it now leads.

## Facts measured 2026-11-20

- Live payload: 31 models, 27 with `go.monthly_usage`, 3 plans; `deepseek-v4.1-flash` = 100 / 200 / 105,
  `glm-5.3` = 500 / 1000 / 505, `glm-5.3-flash` = 60 / 180 / 65. `beam-free` carries `monthly_usage: null`.
- The endpoint does **not** carry a plan's $/month price, the window split, or the Zen table. Price and
  split (20/50/100) stay from the seed; Zen stays from the seed too (`/zen/v1/models` is a second call and
  out of this brief's scope). `plans` prints `price unknown` for a plan the seed has no price for.
- `serde_json` sorts object keys, so a cache-write TTL map (`{"30m":0.25,"12h":0.5}`) loses its document
  order. `Object.values(write)[0]` in `extract-zen.ts` is the *cheapest* entry, so the Rust converter takes
  the map's minimum value — same answer on every payload seen so far, without depending on order.
- `gemini-4-argon` carries a `date` multiplier (2026-12-01 reprice), not a peak sheet: skipped, exactly as
  `extract-zen.ts` does.

## Design

- `zen::catalog()` used to *return* a parsed `Catalog`; it now returns `&'static Catalog` from a
  `OnceLock` in `ocuse::catalogue`. That kept every call site (`render`, `mcp`, `window`, `db`) on one
  accessor and removed a per-tick clone; 13 sites lost a redundant `&`.
- `zen::builtin()` is the pure seed parse, so tests (and any library caller before `init`) never touch the
  network. `catalogue::init` is called once from `ocuse::cli::run`, before the first render.
- Fallback order is the brief's: fresh cache → live → **seed** (with the failure reason). A stale cache is
  deliberately *not* used, so the fallback is always a known file rather than an unseen one.
- `--no-catalog` / `--cache <dur>` are lifted out of argv in `ocuse/cli.rs` (same trick as `model <id>`),
  because `cmduse/src/cli.rs` is another lane's file. **Follow-up:** they are therefore absent from
  `ocuse --help` (`OCUSE_HELP` lives in `cmduse/src/cli.rs`); whoever owns that file should add two lines:
  `--no-catalog` and `--cache <dur>`.
- `STATUSLINE_EXTRA_KEYS` (in `cmduse/src/report_render.rs`, also shared) gained `catalogSource`,
  `catalogAt`, `catalogAgeSecs`. The first two are the same names the oduse lane uses, so the family reads
  one name per concept. Dashboard `--json` carries a nested `catalog` object, matching oduse's
  `catalog_json()`.
- Provenance shape: `{source: live|cache|builtin, at (epoch ms), ageSecs, error}`; text form is
  `live · fetched 2026-11-20T09:56Z`, `cache · written …, 35s old`, `builtin · generated …, <why>`.

## Traps

- `sd -s '&crate::ocuse::zen::catalog()' …` also rewrote `&crate::ocuse::zen::catalog().go.window_share`,
  removing a borrow that mattered. Check `&expr.field` sites before a blind replace.
- Cache freshness uses the file's **mtime** against the caller's clock; a test with a fake `now` far in the
  past reads a real file as fresh forever (`saturating_sub` → 0). Tests therefore pin `now` at
  `window::now_ms()` and offset from it.
- The cache file is the seed *shape*, so `Catalog` needed `Serialize` as well as `Deserialize`; the
  renames carry both ways.
