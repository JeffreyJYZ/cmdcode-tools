import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { type Project, projects } from "@/content/projects";
import { REPO_URL } from "@/lib/consts";
import {
	deriveDescription,
	deriveTitle,
	type LinkContext,
	rewriteLinks,
	stripBadgeBlock,
	stripLeadParagraph,
} from "@/lib/docs";
import { extractToc, type TocEntry } from "@/lib/toc";

export type ProjectDoc = {
	title: string;
	description: string;
	body: string;
	toc: TocEntry[];
};

export const DOCS_REF = "main";

const H1_RE = /^# .+$/;

/** dir under repo root → docs slug, for cross-project relative links. */
const projectByPath: Record<string, string> = Object.fromEntries(
	projects.map((p) => [p.repoPath, p.slug]),
);

function readmeUrl(project: Project): URL {
	// From `website/src/lib/` three levels up is the repo root, where each
	// package's README lives (`<repoRoot>/<repoPath>/README.md`).
	return new URL(`../../../${project.repoPath}/README.md`, import.meta.url);
}

/**
 * Drop the leading `# Title` line (plus one following blank) so the page can
 * render its own `<h1>` without duplicating the README title.
 *
 * `extractToc` is H2/H3-only, so the sidebar ids stay aligned with the
 * headings `rehype-slug` emits over the stripped body.
 */
function stripLeadingH1(md: string): string {
	const lines = md.split("\n");
	const start = lines.findIndex((line) => H1_RE.test(line));
	if (start === -1) return md;
	let end = start + 1;
	if (lines[end] !== undefined && lines[end].trim() === "") end += 1;
	return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/**
 * Load one package README as a docs page.
 *
 * Derived title/description fall back to the manifest's name/tagline; the
 * shields badge run is removed; README-relative links are rewritten to GitHub
 * blob URLs (or `/docs/<slug>` for a cross-project README); the leading H1 and
 * the lead paragraph (rendered separately in the page header) are stripped and
 * the H2/H3 table of contents is extracted from the body.
 */
export async function loadProjectDoc(project: Project): Promise<ProjectDoc> {
	const raw = await readFile(fileURLToPath(readmeUrl(project)), "utf8");
	// Parse order: strip badges → derive title/description → strip H1 → strip
	// lead paragraph (so the header's lead `<p>` is not repeated in the body).
	const stripped = stripBadgeBlock(raw);
	const title = deriveTitle(stripped, project.name);
	const description = deriveDescription(stripped, project.tagline);
	const ctx: LinkContext = {
		repoUrl: REPO_URL,
		ref: DOCS_REF,
		projectPath: project.repoPath,
		projectByPath,
	};
	// Strip the lead paragraph before link rewriting so the line still matches
	// the `description` it was derived from (a relative link would have moved it).
	const body = rewriteLinks(
		stripLeadParagraph(stripLeadingH1(stripped), description),
		ctx,
	);
	return { title, description, body, toc: extractToc(body) };
}
