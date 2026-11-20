# Lane: refresh `core/zen.json` — OpenCode Go per-model limits are a month stale

Repo: `/Users/jyz/dev/cmdcode-tools` (one git repo: Rust workspace `core` + `cmduse`, bun workspace).

## The defect, as measured

`ocuse` reports every OpenCode Go figure from `core/zen.json`, which was extracted 2026-10-12. The live
`GET https://opencode.ai/zen/go/v1/models` (no auth needed, HTTP 200) now disagrees on both limits and
membership:

| model | zen.json (go / go-plus) | live `go.monthly_usage` |
| --- | --- | --- |
| `deepseek-v4.1-flash` | 80 / 160 | 100 / 200 |
| `glm-5.3` | 15 / 120 | 500 / 1000 |
| 8 rows | present | absent live — `glm-5.2`, `kimi-k2.6`, `mimo-v2.5`, `mimo-v2.5-pro`, `minimax-m2.7`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `space-bunny`, `grok-4.6` |
| 6 rows | absent | present live with a Go limit — `minimax-m3.1-flash`=20, `step-5-preview`=15, `kimi-k3.1-pro`=15, `gemini-4-argon`=30, `hy4`=60, `qwen4-max`=15 |

User-visible consequence, which is what was reported: the sidebar and `ocuse model` show
`DeepSeek V4.1 Flash $56.44/$80 (70.5%)` when the model's limit is $100, so the real figure is 56.4%.
`mpc` reads the live endpoint and already says $100, so the two tools contradict each other.

Reproduce before changing anything:

```sh
cd ~/dev/cmdcode-tools
timeout 60 curl -sS https://opencode.ai/zen/go/v1/models -o /tmp/zengo.json
bun -e 'const j=JSON.parse(await Bun.file("/tmp/zengo.json").text());for(const m of j.data)if(m.go?.monthly_usage)console.log(m.id,JSON.stringify(m.go.monthly_usage))'
timeout 90 ocuse models | head -20     # note DeepSeek V4.1 Flash $80.00 and GLM-5.3 $15.00
timeout 90 ocuse model | rg -i deepseek
```

## Task

1. Run `bun scripts/extract-zen.ts` and read what it prints. It scrapes the docs markdown published at
   `raw.githubusercontent.com/anomalyco/opencode/dev/services/www/src/docs/content/console/{go,models}.mdx`.
   Cross-check its output against the live endpoint above; where the docs and the endpoint disagree, the
   endpoint is the meter the user is actually billed against — say so in your report and make the
   extractor prefer it (a fetch of `/zen/go/v1/models` for limits and membership is the durable fix; keep
   the docs scrape for rate variants). Do not silently pick one without recording which.
2. Regenerate `core/zen.json` so it carries: every model the endpoint currently lists with a Go limit,
   the current per-plan limits (`go`, `go-plus`, and `go-teams` if the payload carries it — the plan map
   is `go.plans.<id>.allowanceByModel`), and the current `$/1M` rates.
3. Handle retirement deliberately: a model absent from the live list must not keep a limit. If you drop
   rows, list every dropped id in the report, and check nothing else in the tree keys off them.
4. Fix whatever the regenerated file breaks: `core/src/lib.rs` has guard tests on `ZEN_JSON`, and
   `cmduse`'s ocuse tests may hardcode caps (search with `rg -n '80|160|allowance' cmduse/src/ocuse`).
   Keep the guards meaningful — do not delete a test to make it pass.
5. Prove the fix end to end:
   - `timeout 90 cargo run -p cmd-usage -- ocuse models` shows the new limits (`DeepSeek V4.1 Flash $100.00`,
     `GLM-5.3 $500.00`) and the new models.
   - `timeout 90 cargo run -p cmd-usage -- ocuse model` shows the DeepSeek V4.1 Flash share at 56.4%,
     not 70.5%. Quote both the before and after line.
   - `timeout 90 cargo run -p cmd-usage -- ocuse -1 --json` still parses and its `summary`/`totals` do not
     crash on a model that now has a different cap.
6. Gate and report: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.
   Run every build and test in the foreground and wait for it inside the same call.

Write your report to `docs/plan/zen-refresh/report.md`: the exact commands you ran, a before/after table
for the two models that were wrong, the list of dropped and added ids, which source you trusted and why,
and any test you had to change. Keep your own running notes in `docs/agents/zen-refresh.md`.

## Do not

- Do not bump any version, tag, publish a crate or npm package, or touch the Homebrew tap. The release is
  the owner's call.
- Do not edit `~/.config/opencode/AGENTS.md` or any repo `AGENTS.md`. Report a rule you learned instead.
- Do not touch another session's work, files, or processes; do not use a worktree — one tree only.
- Do not run `grep`/`find`/`sed`. Use `rg` and `fd`, always with an explicit path.
- No native probe that moves the cursor or synthesises input.
- Do not truncate: if you find more drift than the table above, follow it and report it.

DO NOT WASTE TURNS: do as much as possible in one turn/response — batch every independent call, chain
dependent steps, never yield between them.
