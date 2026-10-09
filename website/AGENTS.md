# AGENTS.md

`website/` — standalone Next.js docs/marketing site for the `cmdcode-tools`
packages. Next 16 App Router, React 19, Tailwind v4, TypeScript, Biome. Its own
`bun.lock`; **not a member of the root bun workspace**.

## Rules

- **Read a file before editing it** — no blind rewrites.
- **Never kill a running dev server.** It is this checkout's live preview; if it
  looks stuck, report, don't restart.
- **Never push or deploy without explicit go** (same policy as the repo root).
- **Docs come from the root READMEs — never duplicate prose here.** The site reads
  each package's `README.md` (manifest `src/content/projects.ts`); edit the README,
  not a copy. Title/description derived from H1 + first paragraph; badges stripped;
  relative links rewritten.
- **Design tokens live in `src/ui/styles`** — import them, never inline hex/px.
- **Regenerate `src/data/*` with `bun snapshot:mpc` / `bun snapshot:releases`**,
  never hand-edit snapshot output.

## Layout

```
src/app/       App Router routes
src/content/   projects.ts — the README manifest (single source of docs pages)
src/data/      generated snapshots (bun snapshot:*)
src/ui/        components + styles (design tokens in src/ui/styles)
test/          bun:test (includes readmes.test.ts — pins the README skeleton)
```

## Commands

```sh
bun dev        # next dev
bun build      # next build
bun test       # bun:test
bun typecheck  # tsc --noEmit
bun check      # biome check
```
