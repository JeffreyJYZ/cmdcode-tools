# Lane E — report envelope and MCP tool parity audit

## Method

Built with `RUSTC_WRAPPER= cargo build -p cmd-usage` (dev, finished clean). Ran each
real binary for `daily --json --days 2`, `hourly --json --hours 2`,
`model --json --days 2`, `session --json`, `-1 --json`; extracted top-level keys
with `jq -c 'keys|sort'`. For MCP, piped
`{"jsonrpc":"2.0","id":1,"method":"tools/list"}` into `./target/debug/<bin> mcp`
and extracted `name` plus sorted `inputSchema.properties` keys. Probe scripts
lived only in the approved temp dir, not in the repo.

## Measured matrix (sorted keys)

| binary | daily | hourly | model | session |
| --- | --- | --- | --- | --- |
| cmduse | days,scope,source,total | hours,scope,source,total | models,scope,since,sinceMs,source | projects,scope,sessions,source |
| ocuse | days,scope,source,total | hours,scope,source,total | models,scope,since,sinceMs,source | projects,scope,sessions,source |
| arkuse | days,scope,source,total | hours,scope,source,total | models,scope,since,sinceMs,source | projects,scope,sessions,source |
| oduse | days,scope,source,total | hours,scope,source,total | models,scope,since,sinceMs,source | projects,scope,sessions,source |

All four match `REPORT_DAILY_KEYS`, `REPORT_HOURLY_KEYS`, `REPORT_MODEL_KEYS`,
`REPORT_SESSION_KEYS` exactly. `sessions` and `projects` carry the same rows in
every emitter (`keyed.clone()` / `rows.clone()`): verified in
`report_render.rs::project_table`, `ocuse/render.rs::session_text`,
`arkuse/render.rs::session_text`, `oduse/render/report/session.rs::session_text`.

`-1 --json` on all four carries `source`, `periodStart`, `periodStartAt`,
`periodEnd`, `periodEndAt`, `summary`. Extras are source-specific
(`afp`/`windows` on arkuse, `wallet`/`caps`/`snapshot` on oduse, `account` on
ocuse/arkuse, credit fields on cmduse) and are not part of the shared envelope.

MCP tool names — identical on all four: daily, hourly, model, models, plans,
session, usage.

| tool | cmduse | ocuse | arkuse | oduse |
| --- | --- | --- | --- | --- |
| usage | — | plan | plan | plan |
| plans | — | — | — | — |
| models | gated | gated,plan | gated,plan | plan |
| daily | days,local,tz | days,tz | days,tz | days,tz |
| hourly | hours,local,tz | hours,tz | hours,tz | hours,tz |
| session | days,rows,since,tz | days,rows,since | days,rows,since | days,rows,since |
| model | days,id,rows,since,tz | days,id,plan,rows,since | days,id,plan,rows,since | days,id,plan,rows,since |

## Diff against the rule — decisions

No emitter or tool-schema defect found. Every difference is a source-forced
exception the root rule already names:

- `local` on cmduse `daily`/`hourly`, and `tz` on cmduse `session`/`model` —
  cmduse reads local stores and needs an offset; rule says so explicitly.
- `plan` on `usage`/`models`/`model` of ocuse, arkuse, oduse — the plan/tier is
  forced by each source; the rule names it for oduse and leaves ocuse/arkuse as
  the same family case. Not a defect; no doc sentence changed.
- No `gated` on oduse `models` — OpenDesign prices models per plan, never
  restricts them; the rule says oduse has none. Correct.
- `limit` is accepted as an alias on ocuse, arkuse **and** oduse
  (`.get("rows").or_else(|| args.get("limit"))`). The rule only promises it on
  ocuse/arkuse. This is a harmless superset on oduse, not a parity break; left
  as-is because the oduse MCP call file is owned by another lane this round.

## Shared assertion

Nothing to collapse: the four envelope tests already import one set of
constants (`REPORT_*_KEYS` in `cmduse/src/report_render.rs`), and all four MCP
argument tests call one helper (`mcp_tests::tool_params`). There is no
per-binary re-declaration of expected keys or arguments.

Stale comments were the only rot: three files still said "three binaries" /
"three suites". Fixed in `report_render.rs`, `mcp_tests.rs`, `render_tests.rs`.
`ocuse/render.rs` also has an "all three" test comment, left untouched because
another lane was editing that file concurrently.

## Mutation evidence (each test proven to bite)

Applied eight mutations at once, ran `cargo test -p cmd-usage --lib`, restored
all eight. Result: `318 passed; 9 failed`. Failing tests and messages:

1. `render_tests::report_json_envelopes_are_the_shared_contract` — dropped
   `source` from cmduse `table`: left `["days","scope","total"]`, right
   `["days","scope","source","total"]`.
2. `ocuse::render::tests::report_json_envelopes_are_the_shared_contract` —
   same on ocuse `bucket_text`, same left/right.
3. `arkuse::render::tests::report_json_envelopes_are_the_shared_contract` —
   same on arkuse `bucket_text`, same left/right.
4. `oduse::tests::render_json::report_json_envelopes_are_the_shared_contract`
   — same on oduse `bucket_text`, same left/right.
5. Extra guard: `oduse::tests::render_rows::the_daily_json_carries_every_bucket_even_when_the_table_is_capped`
   — same left/right.
6. `mcp_tests::tool_arguments_are_the_family_surface` — removed `gated` from
   cmduse `models`: left `""`, right `"gated"`.
7. `ocuse::mcp::tests::tool_arguments_are_the_family_surface` — left `"plan"`,
   right `"gated plan"`.
8. `arkuse::mcp::tests::tool_arguments_are_the_family_surface` — left `"plan"`,
   right `"gated plan"`.
9. `oduse::tests::mcp::tool_arguments_are_the_family_surface` — removed `plan`
   from oduse `models`: left `""`, right `"plan"`.

Every mutation was reversed with the exact inverse edit; `git diff` on the
eight emitter/schema files is empty apart from another lane's concurrent
statusline additions in `report_render.rs`/`ocuse/render.rs`/`arkuse/render.rs`.
Those additions are not mine and were not reverted.

## rows vs limit (real MCP calls, `session` tool)

| binary | `rows:0` | `rows:1` | `limit:1` | no arg |
| --- | --- | --- | --- | --- |
| cmduse | 5 lines (all) | 4 (header+1+tail) | 5 (ignored) | 5 |
| ocuse | 1121 (all) | 2 | 2 | 1121 |
| arkuse | 25 (all) | 2 | 2 | 25 |
| oduse | 83 (all) | 2 | 2 | 83 |

`rows:0` and no arg both give every row; `rows:1` and `limit:1` are identical on
ocuse/arkuse/oduse. cmduse ignores `limit`, as the rule prescribes. CLI-side
`rows_cap` maps `Some(0)` to `usize::MAX` (`cmduse/src/cli.rs`).

## Gate

`cargo test` — 327 + 22 passed, 0 failed.
`cargo fmt --all -- --check` — exit 0.
`cargo clippy --all-targets -- -D warnings` — exit 0.
