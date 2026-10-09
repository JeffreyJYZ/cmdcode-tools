# @jeffreyjyz/opencode-context

Context-window breakdown for opencode: where the window went, with a stacked bar and a measured used / limit header.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@jeffreyjyz/opencode-context?style=flat-square)](https://www.npmjs.com/package/@jeffreyjyz/opencode-context)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

Context-window breakdown for opencode. `/context` opens a dialog showing where
the window went — system prompt, tool definitions, thinking, tool inputs and
outputs (split per tool), user and assistant messages — with a stacked bar and a
measured `used / limit` header, in the style of delta.app's Context Window. A
`context_breakdown` tool returns the same numbers as markdown so a model can ask
for them itself.

## Install

Add it to the `plugins` array in `~/.config/opencode/opencode.json` and restart
(or `/reload`) opencode:

```json
{
  "plugins": ["@jeffreyjyz/opencode-context"]
}
```

For local development point at the checkout instead — an absolute path is treated
as a local plugin:

```json
{
  "plugins": ["/Users/you/dev/cmdcode-tools/opencode-context"]
}
```

A symlink under `~/.config/opencode/plugins/` is also picked up. After `bun run
build` in the checkout, the root `index.js` / `tui.js` shims load `dist/`.

## Usage

- **`/context`** — opens the breakdown for the current session.
- **`context_breakdown`** — the model calls it and gets the breakdown as
  markdown.

## How it works

Two halves of one package, because they run in different processes:

| half | file | job |
| --- | --- | --- |
| server | `src/index.ts` | measures the assembled system prompt and tool definitions on every request (their **sizes** only) and registers the tool |
| TUI | `src/tui.tsx` | the `/context` slash command and the dialog |

The message store holds no system prompt or tool schemas, so the server half
records their byte sizes in `$XDG_CACHE_HOME/opencode-context/<session>.json`
(one small JSON per session; no prompt text) and the dialog reads them. The rest
of the breakdown comes straight from opencode's live data — the *replayable*
context (`session.context`, post-compaction), the model's context limit, and the
agent instructions as a fallback.

Units: each row shows UTF-8 **bytes** (delta's size column) and the header shows
the provider's **measured tokens** over the model limit. Per-row percentages are
share of the byte total.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Notes

- The System Prompt and Tool Definitions rows need one request to have happened
  in the session (that is when they are measured); before that the System Prompt
  row falls back to the agent instructions and Tool Definitions is hidden.
- Only sizes are cached, never prompt or tool text.
- The install cache for a published version can lag npm; see the ecosystem notes
  in `AGENTS.md` before publishing.

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-context)
- [npm: @jeffreyjyz/opencode-context](https://www.npmjs.com/package/@jeffreyjyz/opencode-context)
- [MIT license](LICENSE)
