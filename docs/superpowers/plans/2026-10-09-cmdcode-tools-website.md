# cmdcode-tools website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Next.js documentation + showcase site in `website/` that renders the repo's six package READMEs as docs and adds a landing page, guides, an interactive mpc comparison, and a changelog.

**Architecture:** Every package `README.md` is the single source for its docs page; the site reads the root READMEs at build time and renders them through an MDX pipeline, so docs never drift. Site-only content (landing, guides, `/compare`, `/changelog`) is authored in `website/`. The site is fully static (`output: "export"`) with build-time data snapshots, so Vercel never runs a binary at request time.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript `^7`, Tailwind CSS v4, `next-mdx-remote/rsc` + remark/rehype, Biome, bun.

**Spec:** `docs/superpowers/specs/2026-10-09-cmdcode-tools-website-design.md`

## Global Constraints

- Site lives in `website/`, **standalone** — own `package.json`, own lockfile, own nested `.gitignore`; NOT added to the root `package.json` `workspaces`.
- Next.js 16 App Router, React 19, TypeScript `^7`, Tailwind CSS v4, Biome (tabs, indent width 4); package manager **bun** (never npm).
- Source under `website/src/`; tsconfig path alias `"@/*": ["./src/*"]` with **no** `baseUrl`.
- `next.config.ts` uses `output: "export"`, `reactCompiler: true`, `images: { unoptimized: true }` (static export; no server, no API routes).
- Fonts: **Satoshi** variable woff2 self-hosted from `~/dev/fonts/satoshi`, wired with `next/font/local` as `--font-sans`; **mono = system stack** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` as `--font-mono`. Never self-host SF.
- Ship **both color schemes**; dark is the default, light via `prefers-color-scheme`.
- Docs come from the root READMEs — **never duplicate README prose in the site** (guides/landing/comparison are allowed to be original).
- No hardcoded version numbers in prose or components — read them from constants or the snapshot data.
- Every `website/.gitignore` lists `node_modules`, `.next`, `out`, `tsconfig.tsbuildinfo`, `.DS_Store`.
- Never push, publish, or deploy without explicit user go.
- README skeleton (fixed by the spec): `# Title` (H1 = title only) → one-sentence tagline → shields badge line (`?style=flat-square`) → H2 sections. **Required H2s in every README:** `## What it is`, `## Install`, (`## Usage` or `## Commands`), `## Links`.

## Review Focus

Inputs/conditions the spec implies but whose tests are not exhaustive — each line has a pinning test on the task that owns the code:

1. A README whose first text block after the title is a fence, list, table, or heading (no prose paragraph) — `deriveDescription` must fall back to the provided tagline, never emit code or an empty string. (Task 4)
2. A link target that is already absolute (`https://…`) or a bare anchor (`#…`) — `rewriteLinks` must leave it byte-identical. (Task 4)
3. A README with no shields badge line — `stripBadgeBlock` must be a no-op and must not drop the first paragraph. (Task 4)
4. An mpc row where the CommandCode side is `null` or `free` (`requestsPerMonth: null` meaning *unbounded*) — the comparison table must render a placeholder, never crash or show `NaN`. (Task 8)
5. A guide with frontmatter but no `order` — the guides index must sort deterministically (by title) with no `undefined` in the sort. (Task 7)

---

### Task 1: Docs contract — manifest, README skeleton, structure test

**Files:**
- Create: `website/src/content/projects.ts`
- Create: `website/test/readmes.test.ts`
- Modify: `cmduse/README.md`, `oc-cmd-compare/README.md`, `reqshape/README.md`, `opencode-context/README.md`, `opencode-shell-rc/README.md`, `opencode-session-dir/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Project = {
  	slug: string;
  	name: string;
  	tagline: string;
  	kind: "crate" | "npm-plugin" | "npm-cli";
  	repoPath: string;      // dir under repo root holding README.md, e.g. "cmduse"
  	links: { github: string; npm?: string; crates?: string; source: string };
  	order: number;
  };
  export const projects: Project[];
  export function projectBySlug(slug: string): Project | undefined;
  ```

- [ ] **Step 1: Write the failing structure test**

Create `website/test/readmes.test.ts` (bun:test). It reads each `projects` entry's README from the repo root (`new URL(\`../../${repoPath}/README.md\`, import.meta.url)` from `website/test/`) and asserts, for every project: the first non-empty line matches `/^# \S/`; a shields badge line (`[![` … `img.shields.io`) appears within the first 6 non-empty lines; the README contains each required H2 (`## What it is`, `## Install`, one of `## Usage` / `## Commands`, `## Links`); and every opening code fence (a line matching `/^```/` while not inside a fence) is language-tagged (`/^```\S/`).

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { projects } from "@/content/projects";

const REQUIRED = ["## What it is", "## Install", "## Links"];

for (const p of projects) {
	const md = readFileSync(new URL(`../../${p.repoPath}/README.md`, import.meta.url), "utf8");
	test(`${p.slug}: README follows the docs skeleton`, () => {
		const lines = md.split("\n");
		const nonEmpty = lines.filter((l) => l.trim() !== "");
		expect(nonEmpty[0]).toMatch(/^# \S/);
		expect(nonEmpty.slice(0, 6).some((l) => l.includes("[![") && l.includes("img.shields.io"))).toBe(true);
		for (const h of REQUIRED) expect(md).toContain(`\n${h}`);
		expect(md).toMatch(/\n## (Usage|Commands)\b/);
		let inFence = false;
		for (const line of lines) {
			if (line.startsWith("```")) {
				if (!inFence) expect(line).toMatch(/^```\S/);
				inFence = !inFence;
			}
		}
		expect(inFence).toBe(false);
	});
}
```

- [ ] **Step 2: Create the manifest and run the test — it must fail**

Create `website/src/content/projects.ts` with the six projects in this order: `cmduse` (kind `crate`, repoPath `cmduse`, links: github `https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/cmduse`, crates `https://crates.io/crates/cmd-usage`), `mpc` (`npm-cli`, `oc-cmd-compare`, npm `https://www.npmjs.com/package/mpc`), `reqshape` (`npm-cli`, `reqshape`, npm omitted — not published), `opencode-context` (`npm-plugin`, `opencode-context`, npm `https://www.npmjs.com/package/@jeffreyjyz/opencode-context`), `opencode-shell-rc` (`npm-plugin`, `opencode-shell-rc`, npm `…/@jeffreyjyz/opencode-shell-rc`), `opencode-session-dir` (`npm-plugin`, `opencode-session-dir`, npm `…/@jeffreyjyz/opencode-session-dir`). Give each a one-line `tagline` (reuse the README's opening line) and `order` 0..5. `source` for every project: `https://github.com/JeffreyJYZ/cmdcode-tools`.

Run: `cd website && bun install && bun test test/readmes.test.ts` Expected: FAIL — existing READMEs lack `## What it is` / `## Links`.

- [ ] **Step 3: Rewrite all six READMEs to the skeleton**

For each README, keep the existing content but restructure to: `# Title` → tagline line → existing badge line → `## What it is` (move the intro paragraph here) → `## Install` → `## Quick start` → `## Usage` (or `## Commands`) → `## Configuration` (where one exists) → `## How it works` → `## Notes` → `## Links` (repo, npm/crates, license). Preserve every existing command, table, and code block; add a language tag to any untagged fence (`sh`, `json`, `rust`, `ts`). Remove any hardcoded version number from prose. Commit per README if easier, but the task ends when all six pass.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd website && bun test test/readmes.test.ts` Expected: PASS (6 tests).

- [ ] **Step 5: Record the documentation conventions**

Add a `Documentation conventions` section to the root `AGENTS.md`: README = canonical docs page; the skeleton above; the site derives title/description from H1 + first paragraph, strips badges, and rewrites relative links; the manifest is `website/src/content/projects.ts`; the snapshot refresh commands; `website/` is standalone (not a workspace member) and Biome-governed. Create `website/AGENTS.md` with the site-scoped rules: read a file before editing; never kill a running dev server; never push without explicit go; docs come from the root READMEs (never duplicate prose); design tokens live in `src/ui/styles`; regenerate `src/data/*` with `bun snapshot:mpc` / `bun snapshot:releases`.

- [ ] **Step 6: Commit**

```bash
git add website/src/content/projects.ts website/test/readmes.test.ts website/AGENTS.md AGENTS.md \
  cmduse/README.md oc-cmd-compare/README.md reqshape/README.md \
  opencode-context/README.md opencode-shell-rc/README.md opencode-session-dir/README.md
git commit -m "docs: professional README skeleton, site manifest, and doc conventions"
```

---

### Task 2: Site scaffold and tooling

**Files:**
- Create: `website/package.json`, `website/tsconfig.json`, `website/biome.json`, `website/next.config.ts`, `website/postcss.config.mjs`, `website/.gitignore`, `website/next-env.d.ts` (generated by build), `website/src/app/layout.tsx`, `website/src/app/page.tsx`, `website/src/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a Next project where `bun typecheck`, `bun check`, and `bun build` all succeed.

- [ ] **Step 1: Create the config files**

`package.json` mirrors `~/dev/websites/jyz-land/vobes/package.json`: `"packageManager": "bun"`, scripts `dev`/`build` (`next dev`/`next build`), `check` (`biome check`), `format` (`biome format --write`), `lint` (`biome lint`), `typecheck` (`tsc --noEmit`), plus `snapshot:mpc` / `snapshot:releases` (added in Tasks 8/9). Dependencies: `next`, `react`, `react-dom`, `tailwindcss`, `typescript`, `@biomejs/biome`, `@types/node`, `@types/react`, `@vercel/analytics`, `babel-plugin-react-compiler`; devDependency `@tailwindcss/postcss`. Pin versions to match vobes (`next ^16.3.1`, `react ^19.2.8`, `react-dom ^19.2.8`, `tailwindcss ^4.3.3`, `typescript ^7.0.2`, `@biomejs/biome ^2.5.8`, `@types/node 26.2.0`, `@types/react ^19.2.18`) and run `bun install`, then confirm the lockfile took those majors.

`tsconfig.json`: copy vobes' (target `ESNext`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `paths: { "@/*": ["./src/*"] }` without `baseUrl`, `include` the `next-env.d.ts` + `.next/types` globs).

`biome.json`: `{ "$schema": "https://biomejs.dev/schemas/2.5.8/schema.json", "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true } }`.

`next.config.ts`:
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { reactCompiler: true, output: "export", images: { unoptimized: true } };
export default nextConfig;
```

`postcss.config.mjs`: `export default { plugins: { "@tailwindcss/postcss": {} } };`

`.gitignore`: `node_modules`, `.next`, `out`, `tsconfig.tsbuildinfo`, `.DS_Store`.

- [ ] **Step 2: Add a minimal app and verify the build**

`globals.css`: `@import "tailwindcss";`. `layout.tsx`: a root layout returning `<html lang="en"><body>{children}</body></html>` with a `metadata` export (`title`, `description`). `page.tsx`: a placeholder heading. Run from `website/`:

Run: `bun typecheck && bun check && bun build` Expected: all three exit 0; `out/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add website
git commit -m "chore(website): scaffold standalone Next.js site"
```

---

### Task 3: Design system and app shell

**Files:**
- Create: `website/public/fonts/satoshi/` (copied woff2), `website/src/ui/fonts.ts`, `website/src/ui/styles/{tokens,variables,base,fonts,font-classes,headings,links,utilities}.css`, `website/src/ui/components/{site-nav,site-footer}.tsx`
- Modify: `website/src/app/layout.tsx`, `website/src/app/globals.css`

**Interfaces:**
- Consumes: `projects` from Task 1 for nav links.
- Produces: CSS custom properties `--font-sans`, `--font-mono`, `--bg`, `--fg`, `--muted`, `--hairline`, `--accent`, `--accent-hover`, `--surface`, plus the `.sep`, `.sf-pro`-equivalent `.sans`, `.mono` utility classes; `<SiteNav/>` and `<SiteFooter/>` components.

- [ ] **Step 1: Copy Satoshi and wire the font**

Copy `Satoshi-Variable.woff2` (and italic if present) from `~/dev/fonts/satoshi/Fonts/WEB/fonts/` into `website/public/fonts/satoshi/`; commit the font files. `src/ui/fonts.ts`:
```ts
import localFont from "next/font/local";
export const sans = localFont({
	src: [{ path: "../../public/fonts/satoshi/Satoshi-Variable.woff2", weight: "300 900", style: "normal" }],
	variable: "--font-sans",
	display: "swap",
});
```
`src/ui/styles/variables.css` defines `--font-mono` as the system stack and `--font-sans: var(--font-sans), system-ui, sans-serif` (mirror vobes' variable pattern).

- [ ] **Step 2: Write the three-layer tokens and theme**

`tokens.css`: primitive layer (raw neutral/blue scales), semantic layer (`--bg`, `--fg`, `--muted`, `--surface`, `--hairline`, `--accent`, `--accent-hover` mapped from primitives), component layer (rail width, prose measure). Dark values under `:root` (neutral-900 canvas, white text, lightblue accent); a `@media (prefers-color-scheme: light)` block overrides the semantic layer only. `base.css` sets `body { font-family: var(--font-sans); background: var(--bg); color: var(--fg) }`. `headings.css` reproduces the vobes heading scale. `links.css`: `a { color: var(--accent); transition-duration: .2s } a:hover { color: var(--accent-hover) }`. `utilities.css`: `.sep { border: 0.5px solid var(--hairline) }`, `.mono { font-family: var(--font-mono) }`.

- [ ] **Step 3: Build the shell and verify visually**

`layout.tsx` imports the style files in vobes' order, applies `${sans.variable}` to `<html>`, and wraps `{children}` in the rail shell (`border-x border-x-[var(--hairline)]`, centered container, `min-h-screen`) with `<SiteNav/>` above and `<SiteFooter/>` below. `SiteNav` links to `/`, `/docs`, `/guides`, `/compare`, `/changelog`. Run `bun dev`, then with `agent-browser` set a viewport, load `http://localhost:3000`, and confirm the rails, nav, and both themes (toggle the OS scheme) render with no console errors.

- [ ] **Step 4: Verify build gate and commit**

Run: `bun typecheck && bun check && bun build` Expected: exit 0.

```bash
git add website
git commit -m "feat(website): design tokens, Satoshi font, and app shell"
```

---

### Task 4: Docs pipeline — pure transforms

**Files:**
- Create: `website/src/lib/docs.ts`, `website/src/lib/toc.ts`, `website/test/docs.test.ts`, `website/test/toc.test.ts`

**Interfaces:**
- Consumes: `Project` from Task 1.
- Produces:
  ```ts
  export type TocEntry = { depth: 2 | 3; id: string; text: string };
  export type LinkContext = { repoUrl: string; ref: string; projectPath: string; projectByPath: Record<string, string> };
  export function deriveTitle(md: string, fallback: string): string;
  export function deriveDescription(md: string, fallback: string): string;
  export function stripBadgeBlock(md: string): string;
  export function rewriteLinks(md: string, ctx: LinkContext): string;
  export function extractToc(md: string): TocEntry[];   // toc.ts
  ```

- [ ] **Step 1: Write the failing tests**

`website/test/docs.test.ts` — assert with fixtures:
- `deriveTitle("# cmduse\n\nLive dashboard", "x")` → `"cmduse"`; `deriveTitle("no heading", "fallback")` → `"fallback"`.
- `deriveDescription("# T\n\nLive [Command Code](https://commandcode.ai) usage dashboard.", "fb")` → `"Live [Command Code](https://commandcode.ai) usage dashboard."`; and, for **Review Focus 1**, `deriveDescription("# T\n\n```sh\nx\n```\n\nAfter.", "fb")` → `"After."` (skips the fence), `deriveDescription("# T\n\n```sh\nx\n```", "fb")` → `"fb"` (no prose anywhere), and a heading/list/table-first input → `"fb"`.
- `stripBadgeBlock` — for **Review Focus 3**: input with a three-line badge block returns the input minus those lines; input with no `[![` line returns the input **byte-identical**.
- `rewriteLinks` — for **Review Focus 2**: `[x](https://a.b/c)` and `[y](#anchor)` return unchanged. `[LICENSE](LICENSE-MIT)` with `projectPath: "cmduse"` → `https://github.com/JeffreyJYZ/cmdcode-tools/blob/main/cmduse/LICENSE-MIT`. `[MPC](../oc-cmd-compare/README.md)` with `projectByPath: { "oc-cmd-compare": "mpc" }` → `/docs/mpc`.

`website/test/toc.test.ts` — `extractToc("# T\n## One\n### A B\n## Two")` → `[{depth:2,id:"one",text:"One"},{depth:3,id:"a-b",text:"A B"},{depth:2,id:"two",text:"Two"}]`; headings inside a fenced code block are ignored.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd website && bun test test/docs.test.ts test/toc.test.ts` Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the transforms**

`docs.ts`: `deriveTitle` = first `/^# (.+)$/m`; `deriveDescription` = first non-empty line after the title that is a plain paragraph (skip fences, headings, list/table/blockquote starts, and badge lines), trimmed of surrounding whitespace; `stripBadgeBlock` = drop every line, in the leading block, that matches a markdown image link to `img.shields.io`, stopping at the first non-matching non-empty line (no `[![` → return input unchanged); `rewriteLinks` = regex-replace `[text](target)`: leave `http(s)://` and `#…` untouched; if `target` resolves (against `projectPath`) to `<dir>/README.md` and `dir` ∈ `projectByPath`, emit `/docs/<slug>`; otherwise if relative, emit `${repoUrl}/blob/${ref}/${resolved}`. `toc.ts`: `extractToc` scans lines outside fences for `/^(#{2,3}) (.+)$/`, slugifies with `github-slugger` (add the dep; the same slugger rehype-slug uses, so ids match), and returns `{ depth, id, text }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd website && bun test test/docs.test.ts test/toc.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add website/src/lib website/test
git commit -m "feat(website): docs transforms (title, description, badges, links, toc)"
```

---

### Task 5: Docs pages — MDX rendering, sidebar, TOC

**Files:**
- Create: `website/src/lib/load.ts`, `website/src/ui/components/{mdx-components,doc-sidebar}.tsx`, `website/src/app/docs/page.tsx`, `website/src/app/docs/[project]/page.tsx`

**Interfaces:**
- Consumes: `deriveTitle`/`deriveDescription`/`stripBadgeBlock`/`rewriteLinks`/`extractToc` (Task 4), `projects`/`projectBySlug` (Task 1).
- Produces: `loadProjectDoc(project: Project): Promise<{ title: string; description: string; body: string; toc: TocEntry[] }>` in `load.ts`.

- [ ] **Step 1: Implement the loader**

`load.ts` reads `new URL(\`../../../${project.repoPath}/README.md\`, import.meta.url)` (from `website/src/lib/`, four levels up is the repo root), derives title/description (fallback `project.name` / `project.tagline`), strips badges, rewrites links with `{ repoUrl: "https://github.com/JeffreyJYZ/cmdcode-tools", ref: "main", projectPath: project.repoPath, projectByPath: map(dir→slug from projects) }`, and extracts the TOC.

- [ ] **Step 2: Render it**

`mdx-components.tsx` exports an MDX component map: headings with `id` + an anchor link (`rehype-slug`, `rehype-autolink-headings`), `table`/`th`/`td` styled to tokens, `pre`/`code` through `rehype-pretty-code` (shiki, dark theme) with a copy button, and `a` (internal `next/link` vs external). `docs/[project]/page.tsx` is a server component with `export function generateStaticParams()` from `projects`, uses `<MDXRemote source={body} components={…} options={{ mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings, [rehypePrettyCode, …]] } }} />`, and lays out `DocSidebar` + article (no right-rail TOC).

**Sidebar carries the sections** (the user's requirement — "section links in the sidebar"): `DocSidebar` lists every project, and the active project expands to its sections from `toc` — H2 entries as links to `#<id>`, H3 entries nested and indented — so each project "has its part" and its parts are navigable. Highlight the section currently in view with an `IntersectionObserver` scrollspy; the anchor hrefs use the same `github-slugger` ids `rehype-slug` emits, so the jump lands. `docs/page.tsx` lists all projects and guides. Add `notFound()` for an unknown slug.

- [ ] **Step 3: Verify build + browser**

Run: `bun build` (expect six static routes under `out/docs/`). Then `bun dev` + `agent-browser`: load `/docs/cmduse`, confirm tables, badge line is gone, a relative link now points at GitHub, the TOC links jump to headings, both themes read.

- [ ] **Step 4: Commit**

```bash
git add website/src
git commit -m "feat(website): render READMEs as docs with sidebar and TOC"
```

---

### Task 6: Landing page

**Files:**
- Create: `website/src/ui/components/{copy-block,project-card,icon-*}.tsx`
- Modify: `website/src/app/page.tsx`

**Interfaces:**
- Consumes: `projects` (Task 1); `CopyBlock` pattern from vobes.
- Produces: `<CopyBlock value={string} />` (client component, copy→check for ~1.2s), `<ProjectCard project={Project} />`.

- [ ] **Step 1: Build the components**

`copy-block.tsx` = the vobes `CopyBlock` (bordered mono button, copy/check icons, `navigator.clipboard`). `project-card.tsx` links to `/docs/<slug>` and shows name, tagline, kind badge, and npm/crates links.

- [ ] **Step 2: Compose the landing page**

`page.tsx`: a hero (repo name + one-line description), an `Install` section with `CopyBlock`s (`brew install JeffreyJYZ/tap/cmduse`, `cargo binstall cmd-usage`, `bun add -g mpc`), a grid of `ProjectCard`s, and links to `/docs`, `/guides`, `/compare`, `/changelog`.

- [ ] **Step 3: Verify + commit**

Run: `bun build && bun typecheck && bun check`; preview `/` in `agent-browser` in both themes; confirm the copy button writes to the clipboard.

```bash
git add website/src
git commit -m "feat(website): landing page with install blocks and project grid"
```

---

### Task 7: Guides

**Files:**
- Create: `website/src/content/guides/*.mdx` (at least 3), `website/src/lib/guides.ts`, `website/src/app/guides/page.tsx`, `website/src/app/guides/[slug]/page.tsx`, `website/test/guides.test.ts`

**Interfaces:**
- Consumes: the MDX component map (Task 5).
- Produces: `listGuides(): { slug: string; title: string; description: string; order: number }[]` sorted by `order` then title (Review Focus 5).

- [ ] **Step 1: Write the failing test (Review Focus 5)**

`website/test/guides.test.ts`: `listGuides()` returns entries where a guide with no `order` in frontmatter does not produce `undefined`/`NaN` in comparison and the result is deterministic across calls.

- [ ] **Step 2: Implement the guide loader and pages**

Each `.mdx` has frontmatter (`title`, `description`, optional `order`). `guides.ts` parses with `gray-matter` (add the dep), defaults `order` to `Number.MAX_SAFE_INTEGER`, and sorts by `order` then `title.localeCompare`. Write guides: *Install the opencode plugins*, *Set up Command Code*, *Read the dashboard*. Index lists them; `[slug]` renders with `generateStaticParams`.

- [ ] **Step 3: Verify + commit**

Run: `cd website && bun test test/guides.test.ts && bun build`; preview `/guides` and one guide.

```bash
git add website/src website/test
git commit -m "feat(website): guides section"
```

---

### Task 8: Interactive mpc comparison

**Files:**
- Create: `website/scripts/snapshot-mpc.ts`, `website/src/data/mpc.json` (generated, committed), `website/src/lib/mpc.ts`, `website/src/ui/components/compare-table.tsx`, `website/src/app/compare/page.tsx`, `website/test/mpc.test.ts`
- Modify: `website/package.json` (add `snapshot:mpc`)

**Interfaces:**
- Consumes: `mpc --json --shape off` output `{ plans, rows }`.
- Produces: `compareRows(snapshot: MpcSnapshot, planKey: string): CompareRow[]` where a side may be `null`/`free` and the row renders a placeholder (Review Focus 4).

- [ ] **Step 1: Write the failing test (Review Focus 4)**

`website/test/mpc.test.ts`: given a fixture with one row whose `cc` side is `null` and one whose `cc.requestsPerMonth` is `null` (unbounded/free), `compareRows` returns rows with `ccLabel === "—"` (null side) and `"unbounded"` (null requests), never `NaN`/`undefined`.

- [ ] **Step 2: Implement the snapshot script and transform**

`snapshot-mpc.ts` resolves the binary (`MPC_BIN` env → `mpc` → `~/.bun/bin/mpc` → `/opt/homebrew/bin/mpc`), runs `mpc --json --shape off` once per supported CommandCode plan (`go`, `pro`, `max`, `goat`), and writes `src/data/mpc.json` as `{ generatedAt, plans, byPlan }`. `mpc.ts` exposes `compareRows` + types. Add `"snapshot:mpc": "bun scripts/snapshot-mpc.ts"` to `package.json`. Run it once to produce the committed snapshot (if no binary is present locally, seed the file from a captured `mpc --json --shape off` and note it).

- [ ] **Step 3: Build the table and page**

`compare-table.tsx` (client): plan switch, model filter, sort by req/mo · $/req · ability, metric toggle. `compare/page.tsx` (server) reads `src/data/mpc.json`, renders `<CompareTable snapshot={…}/>` plus a "data as of `<generatedAt>`" line and the regenerate command.

- [ ] **Step 4: Verify + commit**

Run: `cd website && bun test test/mpc.test.ts && bun build`; preview `/compare`, switch plans, filter, sort.

```bash
git add website
git commit -m "feat(website): interactive mpc comparison from a build-time snapshot"
```

---

### Task 9: Changelog

**Files:**
- Create: `website/scripts/snapshot-releases.ts`, `website/src/data/releases.json` (generated, committed), `website/src/lib/releases.ts`, `website/src/ui/components/release-timeline.tsx`, `website/src/app/changelog/page.tsx`, `website/test/releases.test.ts`
- Modify: `website/package.json` (add `snapshot:releases`)

**Interfaces:**
- Consumes: GitHub Releases API, npm `bun info <pkg> time`, crates.io `/api/v1/crates/<crate>/versions`.
- Produces: `buildTimeline(data): { package: string; version: string; date: string; url: string; notes?: string }[]` handling an empty release list without throwing.

- [ ] **Step 1: Write the failing test**

`website/test/releases.test.ts`: `buildTimeline` on an empty GitHub list returns `[]` (no throw) and on a mixed fixture sorts newest-first by date and attaches the source URL per entry.

- [ ] **Step 2: Implement the script and transform**

`snapshot-releases.ts` fetches `https://api.github.com/repos/JeffreyJYZ/cmdcode-tools/releases?per_page=100` (public, paginated), npm version times for `mpc`, `reqshape`, `@jeffreyjyz/opencode-command-code`, `@jeffreyjyz/opencode-context`, `@jeffreyjyz/opencode-shell-rc`, `@jeffreyjyz/opencode-session-dir`, and crates.io versions for `cmd-usage` + `cmduse-core`; writes `src/data/releases.json`. `releases.ts` merges into a per-package newest-first timeline. Add the script to `package.json`; run once.

- [ ] **Step 3: Build the page**

`release-timeline.tsx` renders entries grouped by package with version, date, source link, and notes (rendered as plain text/markdown-lite, no raw HTML injection). `changelog/page.tsx` reads the snapshot and shows a "data as of" line + the regenerate command.

- [ ] **Step 4: Verify + commit**

Run: `cd website && bun test test/releases.test.ts && bun build`; preview `/changelog`.

```bash
git add website
git commit -m "feat(website): changelog from release/registry snapshots"
```

---

### Task 10: Metadata, OG, sitemap, 404

**Files:**
- Create: `website/src/app/not-found.tsx`, `website/src/app/sitemap.ts`, `website/src/lib/consts/index.ts`, `website/src/app/opengraph-image.tsx` (or a static OG asset)
- Modify: `website/src/app/layout.tsx`, `website/src/app/docs/[project]/page.tsx`

**Interfaces:**
- Consumes: `projects` (Task 1).
- Produces: `SITE_URL` and nav/link constants in `src/lib/consts/index.ts`; per-route `metadata`.

- [ ] **Step 1: Add constants and per-route metadata**

`src/lib/consts/index.ts`: `REPO_URL`, `SITE_URL`, `RELEASES_URL`, `NPM_ORG_URL`, and re-export the project links. Add `generateMetadata` to the docs route (title/description from the loader) and static `metadata` to layout/landing/guides/compare/changelog using `SITE_URL`.

- [ ] **Step 2: Add 404, sitemap, OG**

`not-found.tsx` styled to the shell. `sitemap.ts` enumerates `/`, `/docs`, each `/docs/<slug>`, `/guides`, each guide, `/compare`, `/changelog` with `SITE_URL`. Add an OG image (static asset or `opengraph-image.tsx`) referenced from layout metadata.

- [ ] **Step 3: Verify + commit**

Run: `bun build && bun typecheck && bun check`; confirm `out/sitemap.xml` and `out/404.html` exist.

```bash
git add website/src
git commit -m "feat(website): metadata, sitemap, OG image, and 404"
```

---

### Task 11: Client-side search (Pagefind)

**Files:**
- Create: `website/scripts/search-index.ts` (or a postbuild script)
- Modify: `website/package.json`

**Interfaces:**
- Consumes: the built `out/` HTML.
- Produces: `out/pagefind/` index and a search UI mounted in the docs sidebar.

- [ ] **Step 1: Add Pagefind and index the build**

Add `pagefind` (dev) and a `postbuild` script that runs `pagefind --site out` after `next build`; add a `Search` client component to the docs sidebar that dynamically imports the Pagefind UI and hides itself when the index is absent.

- [ ] **Step 2: Verify + commit**

Run: `bun build` (which now runs the index step); preview `/docs`, type a query, confirm results.

```bash
git add website
git commit -m "feat(website): client-side search with Pagefind"
```

---

### Task 12: CI, Vercel config, link check, final verification

**Files:**
- Modify: `.github/workflows/ci.yml` (root)
- Create: `website/vercel.json`, `website/scripts/check-links.ts`
- Modify: `website/package.json` (add `check:links`)

**Interfaces:**
- Consumes: the built `out/`.
- Produces: a CI job for the site and a link-integrity script.

- [ ] **Step 1: Add the CI job**

Append a job to the root `.github/workflows/ci.yml` that sets `working-directory: website` and runs `bun install --frozen-lockfile && bun check && bun typecheck && bun build`. It must not alter the existing Rust/workspace jobs.

- [ ] **Step 2: Add Vercel config and the link checker**

`vercel.json` sets the project's Root Directory expectation (`website/`) and an `ignoreCommand` only if desired. `scripts/check-links.ts` scans the built `out/**/*.html` for `href` values: internal links must resolve to a file in `out/`; external links are HEAD-checked and reported. Add `"check:links": "bun scripts/check-links.ts"`.

- [ ] **Step 3: Full verification**

Run from `website/`: `bun install && bun check && bun typecheck && bun build && bun check:links`. Expected: all exit 0; the six `/docs/<slug>` routes, `/guides/*`, `/compare`, `/changelog`, `sitemap.xml`, and `404.html` exist in `out/`. Preview the whole site once with `agent-browser` in both themes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml website
git commit -m "chore(website): CI job, Vercel config, and link check"
```

---

## Notes for the implementer

- Deploy/publish is **not** part of this plan — it requires explicit user go.
- Vercel sets **Root Directory = `website/`**; the build can read `../<repoPath>/README.md` because the whole repo is checked out.
- If `next-mdx-remote` or `rehype-pretty-code` versions disagree with the installed Next/React 19 majors, pin the newest release that installs cleanly and note it in `website/AGENTS.md`.
