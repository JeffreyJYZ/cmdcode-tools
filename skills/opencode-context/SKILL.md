---
name: opencode-context
description: "Use when the user asks why their context is already high, what is filling the window, or how much room is left before compaction, and wants the /context dialog or a context_breakdown answer."
---

# opencode-context

`@jeffreyjyz/opencode-context` — provider-agnostic opencode plugin. `/context` opens a dialog with a stacked bar and a measured `used / limit` header, breaking the window into system prompt, tool definitions, thinking, tool inputs/outputs (split per tool), and user/assistant messages. The `context_breakdown` tool returns the same numbers as markdown so a model can ask for them itself.

## Install

In `~/.config/opencode/opencode.json`:

```json
{ "plugins": ["@jeffreyjyz/opencode-context"] }
```

Restart or `/reload` opencode. A local checkout path or a symlink under `~/.config/opencode/plugins/` also works. After `bun run build`, root `index.js`/`tui.js` shims load `dist/`.

## Use

- `/context` — breakdown for the current session.
- `context_breakdown` — the model calls it and gets the breakdown as markdown.

The server half (`src/index.ts`) measures system-prompt and tool-definition sizes in `session.context` and registers the tool; the TUI half (`src/tui.tsx`) owns the dialog. They share only the filesystem: sizes are cached at `$XDG_CACHE_HOME/opencode-context/<session>.json` (default `~/.cache/opencode-context/`).

## Reading the numbers

- Each row shows UTF-8 **bytes**; per-row percentages are share of the byte total.
- The header `used / limit` is the provider's **measured tokens** over the model limit (input + output + reasoning + cache read + cache write of the last assistant turn). Never present the per-row byte estimate as exact.
- The breakdown is the **replayable** context (`session.context`, post-compaction), not full history — it describes what the provider would actually receive.

## Traps

- System prompt and tool definitions are not in the message store. Before the first request there is no capture: the System Prompt row falls back to agent instructions and Tool Definitions is hidden. Never invent those numbers.
- Only sizes are cached, never prompt or tool text.
- One classification point (`src/breakdown.ts`); both halves feed it the same shapes, or dialog and tool disagree.
- Build the TUI with `@opentui/solid`'s transform (`scripts/build-tui.ts`), not plain `bun build`; `@opentui/*` and `solid-js` stay external because the host rewrites the entry imports.
- Local-directory loading resolves `index`/`tui` beside the package root, not the `exports` map; keep shims in sync with `dist/`.
- After publishing, opencode's per-package install cache can lag npm. Clear `~/.cache/opencode/npm/@jeffreyjyz/opencode-context@latest` and let the user restart; never restart opencode yourself.

Details: [opencode-context README](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/opencode-context#readme).
