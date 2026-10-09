# cmdcode-tools website — design

Date: 2026-10-09 Status: approved in conversation; awaiting spec review Scope: new standalone Next.js documentation + showcase site in `website/`

## Context

`JeffreyJYZ/cmdcode-tools` is one repo holding independently published packages across **six projects — six `README.md` docs pages** (the cmduse project groups the `core` / `cmduse` / `opencode-plugin` components and documents them in one README). Components and their published identities:

| Component | Dir | Kind |
| --- | --- | --- |
| `cmd-usage` CLI (`cmduse` / `ocuse`) | `cmduse/` | Rust crate (crates.io) |
| `cmduse-core` | `core/` | Rust crate (crates.io) |
| `@jeffreyjyz/opencode-command-code` | `opencode-plugin/` | npm plugin |
| `mpc` | `oc-cmd-compare/` | npm CLI |
| `reqshape` | `reqshape/` | npm CLI |
| `@jeffreyjyz/opencode-context` | `opencode-context/` | npm plugin |
| `@jeffreyjyz/opencode-shell-rc` | `opencode-shell-rc/` | npm plugin |
| `@jeffreyjyz/opencode-session-dir` | `opencode-session-dir/` | npm plugin |

There is no site today. The repo rule *"docs always move with code — any user-visible change updates the READMEs … in the same commit"* means the site must not become a second copy of the docs.

## Goals

- A public site covering **docs for every package**, a landing page, **guides**, an **interactive mpc comparison**, and a **changelog**.
- Single source of truth for docs: each package `README.md` **is** its docs page.
- The READMEs themselves are upgraded to **professional documentation** with a consistent structure the site can rely on.
- Record the documentation + site conventions in `AGENTS.md`.
- Standalone: own `package.json`, own lockfile, own nested `.gitignore`; **not** a bun-workspace member (keeps Next's dependency graph out of the root workspace).
- Deploy target: Vercel (deployment not performed without explicit go).

## Non-goals

- No runtime backend, auth, database, or server API routes.
- No blog, i18n, or user accounts.
- No second copy of any README's prose.

## Decisions (from the brainstorm)

- **Docs pipeline: README-first.** The site imports the root READMEs at build and renders them; site-only content is authored in `website/`. (Alternatives — authoring MDX docs in the site, or sharing partials between README and site — rejected: the first drifts, the second is over-engineered.)
- **Site directory: `website/`**, standalone.
- **Visual direction: the `vobes.jyz.land` house style** (user owns `jyz.land`), adapted for docs (see Design system).
- **Fonts: Satoshi (self-hosted variable) + system mono stack.** No self-hosted SF (license + cross-platform).
- **`/compare` and `/changelog` use build-time snapshots**, because Vercel cannot run the `mpc` binary (bun + live doc scrape) at request time.

## Architecture

```
website/
  package.json            standalone; bun; scripts (dev/build/check/format/typecheck/snapshots)
  tsconfig.json           target ESNext, "@/*" -> "./src/*", no baseUrl, strict
  biome.json              Biome (tabs, width 4)
  next.config.ts          output: "export", reactCompiler: true, images.unoptimized
  postcss.config.mjs      @tailwindcss/postcss
  vercel.json             optional: $schema + ignoreCommand (root dir is a Vercel project setting, not here)
  .gitignore              node_modules, .next, out, tsconfig.tsbuildinfo, .DS_Store
  public/
    fonts/satoshi/        Satoshi variable (woff2), committed
    media/                icons, og image
  scripts/
    snapshot-mpc.ts       runs mpc -> src/data/mpc.json
    snapshot-releases.ts  GitHub Releases + npm + crates.io -> src/data/releases.json
    check-links.ts        (phase 8) verify internal routes + external links resolve
  src/
    app/                  App Router: layout, globals.css, routes
    content/
      projects.ts         THE manifest (see Content model)
      guides/*.mdx        authored guides (frontmatter allowed)
    data/
      mpc.json            generated snapshot (committed)
      releases.json       generated snapshot (committed)
    lib/
      consts/             site constants: SITE_URL, repo URL, nav, links
      docs.ts             README/MDX loader + remark/rehype pipeline
      toc.ts              heading extraction
    ui/
      styles/             tokens.css, variables.css, base.css, fonts.css,
                          font-classes.css, headings.css, links.css, utilities.css
      fonts.ts            next/font/local (Satoshi)
      components/         icons, CopyBlock, nav, sidebar, TOC, cards, tables
```

`src/app` under `src/` (satisfies the "source under `src/`" rule). Aliased imports via `@/*`.

## Content model

`src/content/projects.ts` — one entry per package, the single manifest driving the landing grid, docs sidebar, prev/next, and cross-links:

```ts
type Project = {
  slug: string;            // "/docs" route segment
  name: string;            // display name
  tagline: string;         // one line (fallback if README has none)
  kind: "crate" | "npm-plugin" | "npm-cli";
  repoPath: string;        // e.g. "cmduse" — dir under repo root holding README.md
  links: { github?: string; npm?: string; crates?: string; source: string };
  order: number;
  icon?: string;
};
```

Title and description for each docs page are **derived** from the README's H1 and first paragraph — no frontmatter is added to READMEs (YAML renders badly on GitHub/npm). Guides (`src/content/guides/*.mdx`) are site-only and may use frontmatter (`title`, `description`, `order`).

## Docs pipeline

`src/lib/docs.ts`:

1. Read the README from disk (`../<repoPath>/README.md`, present on Vercel since the whole repo is checked out).
2. Derive `title` (H1) and `description` (first paragraph); locate and drop the shields badge line.
3. Rewrite links: relative repo paths → GitHub blob URLs; cross-README links → site routes (`/docs/<slug>`); anchors preserved.
4. Compile through `next-mdx-remote/rsc` with:
   - `remark-gfm` (tables), `remark-strip-badges`, `remark-rewrite-links`, TOC extraction;
   - `rehype-slug`, `rehype-autolink-headings`, `rehype-pretty-code` (shiki, dark theme).
5. Render through an MDX `components` map styled to the design tokens (headings with anchors, tables, code blocks with `CopyBlock`, links, blockquotes).

READMEs render as one page per project. The sidebar is the docs tree: it lists every project, and the active project's sections (H2, nested H3) appear as anchor links with a scrollspy highlight. There is no separate right-rail TOC — the sections live in the sidebar. Splitting per-H2 into sub-routes is deferred unless it earns its place.

## Routes

| Route | Content |
| --- | --- |
| `/` | Landing: what the repo is, project grid, install one-liners |
| `/docs` | Docs index (all projects + guides) |
| `/docs/[project]` | README-rendered project docs; sidebar shows its sections as anchors; prev/next |
| `/guides` | Guides index |
| `/guides/[slug]` | Authored MDX guide |
| `/compare` | Interactive mpc comparison (build-time snapshot) |
| `/changelog` | Releases timeline (build-time snapshot) |
| `not-found` | 404 |

All routes are statically generated (`output: "export"`), so each dynamic route provides `generateStaticParams` from the manifest / guide list.

## Interactive `/compare`

Vercel cannot run `mpc` (bun + live scrape) at request time. `scripts/snapshot-mpc.ts` runs `mpc --json --shape off` (fixed workload, and `--shape off` is required to avoid the mpc→reqshape→mpc recursion) for each supported CommandCode plan, and writes `src/data/mpc.json`. The page renders it as a client component (`CompareTable`) with: CommandCode plan switch, model filter, sort (req/mo, $/req, ability), and metric toggle — no runtime calls. A "data as of `<generatedAt>`" line is always shown. Refresh: `bun snapshot:mpc`.

## `/changelog`

`scripts/snapshot-releases.ts` aggregates at build:

- GitHub Releases (`/repos/JeffreyJYZ/cmdcode-tools/releases`, public, paginated) — the notes-rich timeline (`cmduse-vX.Y.Z` tags);
- npm version history (`bun info <pkg> time`) for the npm packages;
- crates.io versions (`/api/v1/crates/<crate>/versions`) for `cmd-usage` and `cmduse-core`.

Written to `src/data/releases.json`; the page renders a timeline grouped by package. Refresh: `bun snapshot:releases`.

## Design system (vobes-derived)

Mirror the `vobes.jyz.land` theme, extended for docs and for both color schemes (the global rule: ship dark **and** light). vobes is dark-only; here the dark tokens are the vobes palette and a light variant is added, honouring `prefers-color-scheme` (auto), with an optional toggle.

- **Tokens**: three layers (primitive → semantic → component) in `src/ui/styles/tokens.css`; the vobes file split is mirrored for the rest.
- **Look**: neutral-900 canvas, `text-white`, centered left/right hairline rails (`border-x`), uppercase `tracking-widest` section labels, `.sep` 0.5px hairline, `a { color: lightblue } → hover royalblue`, mono copy-to-clipboard blocks.
- **Docs layout**: the rail shell widens and left-aligns; a sidebar listing every project, with the active project's sections (H2 + nested H3) as anchor links (scrollspy-highlighted), beside the article. No separate right-rail TOC — sections live in the sidebar. Prose measure capped for readability.
- **Fonts**: Satoshi variable (self-hosted from `~/dev/fonts/satoshi`, wired with `next/font/local`, variable `--font-sans`) for UI; mono = system stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`) as `--font-mono` — no shipped mono, no self-hosted SF.
- **Shared components**: `CopyBlock` (copy/check), external-link icon, nav, footer, `ProjectCard`, `CompareTable`, `ReleaseTimeline`, theme toggle.

## README upgrade (the "professional documentation" ask)

Each package README is rewritten to one skeleton:

```
# <Title>                       <- H1: title only (site derives page title + nav label)
<one-sentence tagline>         <- site derives meta description
<badge line, flat-square>      <- site strips it; GitHub/npm keep it
## What it is
## Install
## Quick start
## Usage            (or ## Commands — command/flag tables)
## Configuration
## How it works
## Notes            (or ## Troubleshooting)
## Links            (repo, npm/crates, license)
```

Rules: H1 = title only; H2 = anchor-nav sections; H3 = subsections; fenced code always language-tagged (`sh`, `json`, `rust`, `ts`); links always resolvable (relative repo paths are rewritten by the site); **no hardcoded version numbers** in prose — if a version must appear, the site reads it from the snapshot data; keep `?style=flat-square` badges. The site depends on this structure, so it is fixed by this spec.

## AGENTS.md conventions

- **Root `AGENTS.md`**: a `Documentation conventions` section — README = canonical docs page; the skeleton above; how the site consumes it (title/desc from H1/first paragraph, badges stripped, relative links rewritten); the manifest is `website/src/content/projects.ts`; snapshot refresh commands; `website/` is **standalone** (not a workspace member) and Biome-governed.
- **`website/AGENTS.md`**: site-scoped rules (vobes-style: read before edit; never kill a running dev server; never push without explicit go) plus: docs come from the root READMEs — never duplicate prose; design tokens live in `src/ui/styles`; regenerate `src/data/*` snapshots with the documented commands.

## Stack

Next.js 16 App Router, React 19, TypeScript `^7` (native — matches the workspace and works with Next 16), Tailwind v4, `next-mdx-remote/rsc` + remark/rehype (`gfm`, `slug`, `autolink-headings`, `pretty-code`), Biome for lint/format (tabs, width 4 — **not** create-next-app's ESLint/Prettier stack), bun as package manager. Pagefind (client search) is an optional final phase.

## Build, CI, deploy

- `website/package.json` scripts: `dev`, `build`, `check`/`format`/`lint` (Biome), `typecheck`, `snapshot:mpc`, `snapshot:releases`.
- Root `.github/workflows/ci.yml`: add a job that runs in `website/` (`bun install && bun check && bun typecheck && bun build`), independent of the existing Rust/workspace jobs so it cannot destabilize them.
- Vercel: a project with **Root Directory = `website/`** — a project setting, **not** expressible in `vercel.json`; Vercel auto-detects Next, `next.config.ts` uses `output: "export"`. `vercel.json` is optional and, if present, mirrors vobes: `$schema` + an `ignoreCommand` that skips builds when no `website/` path changed. No deploy/publish without explicit user go.

## Verification

- `bun run build` (static export) succeeds; `bun typecheck` (after build — `next-env.d.ts` imports the generated, gitignored `.next/types`); `biome check` clean.
- Docs render correctly for all six READMEs: tables, code blocks, TOC, rewritten links — checked in a real browser (`agent-browser`) against `bun dev`.
- `scripts/check-links.ts` (phase 8): every internal route in the built output exists; every external link resolves.
- Both color schemes render (dark default, light via `prefers-color-scheme`).

## Risks

- **READMEs vary today**; a uniform renderer needs uniform input → standardize the READMEs in phase 1 before wiring the pipeline.
- **Relative-link rewriting** is the likeliest source of broken links → covered by the link check.
- **Snapshot staleness** (`mpc`, releases) → always show "data as of", expose the refresh commands, and allow a scheduled CI refresh later.
- **`output: "export"`** rules out ISR — acceptable, snapshots are build-time.

## Build order

1. Docs contract: upgrade the six READMEs to the skeleton; add `website/src/content/projects.ts`; add AGENTS.md conventions (root + website).
2. Site scaffold: package.json / tsconfig / biome / next config / Tailwind / tokens + theme / Satoshi fonts / app shell (rails, nav, footer).
3. Docs pipeline: loader + remark/rehype + MDX components + TOC + sidebar; `/docs`, `/docs/[project]`.
4. Landing `/`.
5. Guides `/guides`, `/guides/[slug]`.
6. `/compare` (snapshot + client table).
7. `/changelog` (snapshot + timeline).
8. Polish: 404, OG/meta, sitemap, Pagefind search, CI job, Vercel config, verification.
