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
const STRUCTURAL_RE = /^([-*+>|]|\d+\.)\s?/;
const BADGE_RE = /\[!\[[^\]]*\]\(https?:\/\/img\.shields\.io\//;

/** Page title = the README's first H1, else the project name. */
export function deriveTitle(md: string, fallback: string): string {
	const m = md.match(TITLE_RE);
	return m ? m[1].trim() : fallback;
}

/**
 * Page description = the first plain paragraph after the title.
 *
 * Skips fences (whole block), headings, list/table/blockquote starts and badge
 * lines, so a README that opens with code or structure falls back rather than
 * emitting code or an empty string.
 */
export function deriveDescription(md: string, fallback: string): string {
	let inFence = false;
	for (const raw of md.split("\n")) {
		const line = raw.trim();
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line === "") continue;
		if (HEADING_RE.test(line)) continue;
		if (STRUCTURAL_RE.test(line)) continue;
		if (BADGE_RE.test(line)) continue;
		return line;
	}
	return fallback;
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
