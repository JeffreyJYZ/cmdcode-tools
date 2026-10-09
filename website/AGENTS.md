# AGENTS.md

`website/` — standalone Next.js site rendering the `cmdcode-tools` packages' docs. Next 16 App Router, React 19, Tailwind v4, TS, Biome. Own `bun.lock`; **not a root bun-workspace member**.

## Rules

- **Read a file before editing** — no blind rewrites.
- **Never kill a running dev server** — it is the checkout's live preview; stuck → report, don't restart.
- **Never push/deploy without explicit go** (same as repo root).
- **Docs come from root READMEs — never duplicate prose here.** Site reads each package `README.md` (manifest `src/content/projects.ts`); edit the README, not a copy. Title/description from H1 + first paragraph, badges stripped, relative links rewritten.
- **Design tokens live in `src/ui/styles`** — import, never inline hex/px.
- **MDX pipeline lives in `src/lib/mdx-options.ts`** — import it in every MDX render; never re-declare the remark/rehype lists, or docs and guides drift apart silently.
- **Resolve a content *directory* from the module path** — `new URL(dir, import.meta.url)` makes Turbopack const-fold and bundle the directory as a module (build fails); use `join(fileURLToPath(import.meta.url), …)`. `new URL` is correct for a single file (`src/lib/load.ts`).
- **Regenerate `src/data/*` with `bun snapshot:mpc` / `bun snapshot:releases`** — never hand-edit snapshot output.

## Layout

```
src/app/       App Router routes
src/content/   projects.ts — README manifest (single source of docs pages)
src/data/      generated snapshots (bun snapshot:*)
src/ui/        components + styles (tokens in src/ui/styles)
test/          bun:test (readmes.test.ts pins README skeleton)
```

## Commands

```sh
bun dev         # next dev
bun run build   # next build — `bun build` is Bun's own bundler, so always `bun run`
bun test        # bun:test
bun typecheck   # tsc --noEmit
bun check       # biome check
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
