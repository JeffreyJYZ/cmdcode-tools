# Lane H — `oduse` MCP server registration

## Step 1 — raw server proof

Both binaries answer `tools/list` with exactly the seven tools and return real content for `tools/call`.

`/opt/homebrew/bin/oduse` (mtime 2026-11-17 18:22:32) and the newer working-tree build `/Users/jyz/dev/cmdcode-tools/target/debug/oduse` (mtime 2026-11-18 13:10:26) both answered. Per the brief, the authoritative proof is the **newer `target/debug` build**; the homebrew binary was checked first and also works.

`tools/list` (both builds, identical tool set):

```
ids 1..7: usage, plans, models, daily, hourly, session, model
```

`usage` inputSchema: `{ "plan": "go (default), plus, pro or max" }` (only `usage`/`models`/`model` take `plan`). `daily`/`hourly` take `days|hours` + `tz`; `session` takes `since`/`days`/`rows`; `model` adds `id`. No `gated` argument — oduse prices models per plan, never restricts them.

`tools/call` `{"name":"usage","arguments":{}}` against `target/debug/oduse` returned content (not an error), first lines:

```
OpenDesign usage — credits, from ~/Library/Application Support/Open Design/namespaces/release-stable/data/app.sqlite (app + opencode)
period: calendar month · ends 2026-12-01 · 8.9K requests · $11.23 credits · 21.4M in / 2.1M out tokens
wallet: daemon not running at http://127.0.0.1:7456 (Connection refused (os error 61))
```

The homebrew build returned the same shape with a slightly older local estimate (`$5.77`). No tool error on either build; wallet-absent is a normal one-line state, not an MCP failure.

## Step 2 — registration

`~/.config/opencode/opencode.json` already had `cmduse`, `ocuse`, `arkuse` under `mcp.servers` and no `oduse`. Added one entry directly after `arkuse`, same object shape and key order, no other bytes changed (hand-maintained file; no formatter, no round-trip):

```json
"oduse": { "type": "local", "command": ["/opt/homebrew/bin/oduse", "mcp"] }
```

Expanded to match its siblings' exact indentation:

```json
			"oduse": {
				"type": "local",
				"command": [
					"/opt/homebrew/bin/oduse",
					"mcp"
				]
			},
```

## Step 3 — memory

- Global `~/.config/opencode/AGENTS.md`, `### Docs and config`: added one bullet (`agents-bullet-add`, anchor = final line of the `mcp auth` bullet). Tool reported `1397 → 1398`, i.e. count rose by exactly one.
- Repo `AGENTS.md` already documents the four binaries' consumption (`cmduse mcp` + `ocuse mcp` + `arkuse mcp` + `oduse mcp` seven-tool MCP parity, installed-binary coupling, consumers table), so the condition applied. Added one bullet after the MCP-parity bullet; `agents-bullet-add` reported `57 → 58`, count rose by exactly one.

## Step 4 — verification

- `bun -e 'JSON.parse(await Bun.file("/Users/jyz/.config/opencode/opencode.json").text())'` → parse OK; server keys include `oduse`, and the parsed value is `{"type":"local","command":["/opt/homebrew/bin/oduse","mcp"]}`.
- `rg -n '"(cmduse|ocuse|arkuse|oduse)":' ~/.config/opencode/opencode.json` → lines 32, 39, 46, 53: all four present with the same shape.
- **Observed stronger-than-expected confirmation:** the config hot-reload surfaced an `oduse` group with all seven tools in this session's tool catalog mid-turn, and a harness-level call `tools.oduse.plans({})` succeeded (2886 bytes, started `OpenDesign plans (hand-maintained, updated 2026-11-16)`). No restart or reload was run.
- Honest limit: that proves this session re-resolved its tool list after the edit. It does **not** prove an arbitrary session that already resolved its tools before the edit will show them without reconnecting — the final proof is an agent in a fresh/not-yet-resolved session seeing all seven `oduse_*` tools. I did not verify that case.
- No opencode restart, reload or process kill. No `git commit`, push or tag. No edits under `cmduse/**`, `core/**` or `opencode-plugin/**`.
