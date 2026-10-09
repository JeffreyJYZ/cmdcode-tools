export type { TocEntry } from "./toc";

export type LinkContext = {
	repoUrl: string;
	ref: string;
	projectPath: string;
	projectByPath: Record<string, string>;
};

const TITLE_RE = /^# (.+)$/m;
const FENCE_RE = /^(`{3,}|~{3,})/;
const HEADING_RE = /^#{1,6}\s/;
const SECTION_RE = /^#{2,}\s/;
const STRUCTURAL_RE = /^([-*+>|]|\d+\.)\s?/;
const BADGE_RE = /\[!\[[^\]]*\]\(https?:\/\/img\.shields\.io\//;

/** Page title = the README's first H1, else the project name. */
export function deriveTitle(md: string, fallback: string): string {
	const m = md.match(TITLE_RE);
	return m ? m[1].trim() : fallback;
}

/**
 * Index of the first plain-prose line (a tagline), or -1.
 *
 * Only the preamble counts — the title's own H1 and the tagline that follows,
 * before the first `##` section. A `##`+ heading ends the search (returns -1),
 * so a README with no tagline never has a section paragraph mistaken for one.
 * Skips fences (whole block), the H1, list/table/blockquote starts and badge
 * lines, so a README that opens with code or structure yields no prose line.
 * Shared by `deriveDescription` and `stripLeadParagraph` so both agree on which
 * line is the tagline.
 */
function findFirstProseLine(lines: string[]): number {
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line === "") continue;
		if (SECTION_RE.test(line)) return -1;
		if (HEADING_RE.test(line)) continue;
		if (STRUCTURAL_RE.test(line)) continue;
		if (BADGE_RE.test(line)) continue;
		return i;
	}
	return -1;
}

/**
 * Page description = the first plain paragraph after the title.
 *
 * Falls back to `fallback` when the README opens with code or structure rather
 * than a prose tagline.
 */
export function deriveDescription(md: string, fallback: string): string {
	const lines = md.split("\n");
	const i = findFirstProseLine(lines);
	return i === -1 ? fallback : lines[i].trim();
}

/**
 * Remove the lead paragraph from `md` (plus one following blank line).
 *
 * Only strips when the first prose line equals `description`; otherwise the
 * description came from `fallback` (the README had no prose tagline) and `md`
 * is returned unchanged, so a real paragraph from the first section is never
 * lost. Pure: no fs/network/framework imports.
 */
export function stripLeadParagraph(md: string, description: string): string {
	const lines = md.split("\n");
	const i = findFirstProseLine(lines);
	if (i === -1 || lines[i].trim() !== description.trim()) return md;
	let end = i + 1;
	if (lines[end] !== undefined && lines[end].trim() === "") end += 1;
	return [...lines.slice(0, i), ...lines.slice(end)].join("\n");
}

/**
 * Remove the shields.io badge block.
 *
 * Dropped lines are every shield image link in the leading badge run; blank
 * lines inside the run are kept, and the run ends at the first non-matching
 * non-empty line. No `[![` anywhere → the input is returned byte-identical.
 */
export function stripBadgeBlock(md: string): string {
	if (!md.includes("[![")) return md;
	const lines = md.split("\n");
	const start = lines.findIndex((l) => BADGE_RE.test(l));
	if (start === -1) return md;
	const out: string[] = lines.slice(0, start);
	let open = true;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		if (open && BADGE_RE.test(line)) continue; // drop badge line
		if (open && line.trim() === "") {
			out.push(line); // blank line: keep, run stays open
			continue;
		}
		open = false; // first non-matching non-empty line closes the run
		out.push(line);
	}
	return out.join("\n");
}

const LINK_RE = /(\[[^\]]*\])\(([^)\s]+)\)/;
const LINK_RE_G = new RegExp(LINK_RE.source, "g");
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Rewrite README-relative links for the docs site (absolute + anchors unchanged). */
export function rewriteLinks(md: string, ctx: LinkContext): string {
	return md.replace(LINK_RE_G, (whole, text: string, target: string) => {
		if (target.startsWith("#") || target.startsWith("/")) return whole;
		if (target.startsWith("//") || SCHEME_RE.test(target)) return whole;
		const resolved = resolvePath(ctx.projectPath, target);
		const dir = resolved.includes("/")
			? resolved.slice(0, resolved.lastIndexOf("/"))
			: "";
		const isReadme = /(^|\/)README\.md$/.test(resolved);
		if (isReadme) {
			const slug = ctx.projectByPath[dir];
			if (slug) return `${text}(/docs/${slug})`;
		}
		return `${text}(${ctx.repoUrl}/blob/${ctx.ref}/${resolved})`;
	});
}

/** Posix path join with `.`/`..` folding, relative to `base`. */
function resolvePath(base: string, target: string): string {
	const segs = `${base}/${target}`.split("/");
	const out: string[] = [];
	for (const seg of segs) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") out.pop();
		else out.push(seg);
	}
	return out.join("/");
}
