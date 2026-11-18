# Lane H — `oduse` is the only binary with no MCP server registration

## Why this exists

`~/.config/opencode/opencode.json` registers three of the four usage readers as MCP servers so an agent can call them as tools:

```
cmduse  {"type":"local","command":["/opt/homebrew/bin/cmduse","mcp"]}
ocuse   {"type":"local","command":["/opt/homebrew/bin/ocuse","mcp"]}
arkuse  {"type":"local","command":["/opt/homebrew/bin/arkuse","mcp"]}
```

`oduse` is absent. That is a parity gap on the *registration* axis — the binary supports `oduse mcp` and exposes the same seven tools (`usage`, `plans`, `models`, `daily`, `hourly`, `session`, `model`), but no agent can reach them because nothing starts it.

Prove it first, then close it.

## Step 1 — prove the server works, without touching any config

Run the real binary:

```
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | /opt/homebrew/bin/oduse mcp
```

and a real call, e.g. `tools/call` for `usage`. Paste both responses in the report. Confirm the seven tool names and that a call returns content rather than an error. If `/opt/homebrew/bin/oduse` is older than the working tree, use `~/dev/cmdcode-tools/target/debug/oduse` for the proof and say which build you proved.

## Step 2 — register it, mirroring its three siblings exactly

Edit `~/.config/opencode/opencode.json` and add, beside the existing three (same object shape, same key order, nothing else changed):

```json
"oduse": { "type": "local", "command": ["/opt/homebrew/bin/oduse", "mcp"] }
```

Rules for this edit:
- **Read the file first.** It has a `mcp.servers` map (note: the servers live under `mcp.servers`, not directly under `mcp`). Match wherever the other three actually are.
- Preserve formatting — this file is hand-maintained JSON. Do not reformat it, reorder keys, or round-trip it through a formatter. Make the smallest possible edit.
- Validate with a real parser afterwards (`bun -e 'JSON.parse(await Bun.file(...).text())'`). `opencode.json` tolerates a trailing comma that `jq` rejects, so a `jq` check is not the verdict.
- **Never restart or reload opencode.** The config hot-reloads; the new server appears on its own. Do not run `opencode service restart`, `opencode reload`, or kill the process.
- If the file already has an `oduse` entry (maybe added by hand earlier), do nothing beyond reporting it.

## Step 3 — record it where a future session looks

- The global `AGENTS.md` mentions the three servers' registration only obliquely. Add **one bullet** to the existing `### Docs and config` section (never a new file, never a new section) stating that all four usage readers are registered as MCP servers under `mcp.servers` in `~/.config/opencode/opencode.json`, that each command is `<bin> mcp`, and that a reader without an entry is unreachable by an agent even though its own `mcp` subcommand works. Use `agents-bullet-add` with an anchor that is the FINAL line of an existing bullet, then confirm the count rose by exactly one.
- Do the same for the repo's own `AGENTS.md` **only if** it already documents how the four binaries are installed/consumed; if it does not, leave it alone and say so.

## Step 4 — verify what you can, and be honest about what you cannot

The tools will not appear in this session (the config hot-reloads for a running server, but a tool list already resolved for a session may not pick it up). So your verification is limited to:
- the raw `tools/list` / `tools/call` proof from step 1,
- the config parsing and a read-back showing the entry in place beside its three siblings,
- and a `rg` showing all four entries present with the same shape.

Say plainly in the report that the final proof is an agent seeing the four new tools appear, which needs a session that has not already resolved its tool list — do not claim you verified that.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything in the repo.
- Never reload or restart opencode, and never kill its process.
- Never use `agent-desktop`, and never move the user's cursor.
- Never edit anything under `cmduse/**`, `core/**`, or `opencode-plugin/**` — five sibling lanes own those.
- Your files: `~/.config/opencode/opencode.json`, the global `AGENTS.md` (one bullet), and optionally the repo `AGENTS.md` (only if it already documents this).

## Report

Append to `docs/plan/opendesign/reports/lane-h-oduse-mcp-registration.md`. Final chat reply under 12 lines: the tools/list proof, the exact entry added, the config validation result, and what you could not verify.
