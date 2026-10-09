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
- **`mpc` is Bun-only — it can never run in a Vercel Function** (`Bun.file`/`Bun.write` in `oc-cmd-compare/src/data/bench/store.ts`, `bun:sqlite` + `Bun.spawn` in the `--usage` path; Vercel Functions are Node/Edge). So don't reach for a serverless endpoint for `/compare`: the data is refreshed by `.github/workflows/snapshot.yml` (cron `*/10 * * * *` → `bun snapshot:mpc`, one run per **CommandCode × OpenCode Go** plan pair — 10 runs, `byPlan[cc][oc]`; commits **only on material change**, ignoring the churning `generatedAt`, with `[skip ci]`), and the page **fetches the committed snapshot in the browser** (raw.githubusercontent, CDN-cached ~5 min). The site stays `output: "export"`. The client `isMpcSnapshot` guard must **reject the previous flat shape** (`byPlan[cc]` was a run, not `{go, go-plus}`) — a cached raw-CDN copy serves it for ~5 min after a push, and adopting it renders `undefined` on every OC cell.
- **Candidate selection probes by running, not resolving.** A machine's global `mpc` can predate `--oc-plan` and exit non-zero on the flag while `Bun.which` still finds it; `scripts/snapshot-mpc.ts` tries each resolved candidate in order and skips any auto one that fails (logging why), so it lands on the workspace source `bun oc-cmd-compare/src/index.ts`. An explicit `MPC_BIN` that fails is **fatal**, never a fall-through.
- **`public/pagefind/` is a committed build artifact** — the search index, shipped so it survives a host that runs a plain `next build` (which never runs our `pagefind` step). `biome.json` excludes it (`!public/pagefind`), since the vendored UI JS otherwise fails `bun check`. Refresh after content changes: `bun run build`, then copy `out/pagefind` over it.
- **Search = Pagefind, indexed in `postbuild`** (`scripts` `build` → `next build`, `postbuild` → `pagefind --site out`; Bun runs `post` lifecycle scripts, verified). Index lands in `out/pagefind/`; `out/` is gitignored so it never enters the repo. `Search` (`src/ui/components/search.tsx`) loads the Default UI (`window.PagefindUI`) as a runtime `<script>`/`<link>` from `/pagefind/` (a static import would fail — files exist only after build), gated on `fetch("/pagefind/pagefind-entry.json")`; absent (dev / pre-build) → renders `hidden`, no error. Theme via `--pagefind-ui-*` vars declared on `.doc-search` in `src/ui/styles/search.css` (nearer ancestor beats Pagefind's `:root` defaults; maps to tokens, both schemes). `processResult` strips `.html` from result URLs (Pagefind indexes exported files; routes are extensionless).

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
