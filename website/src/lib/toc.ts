import GithubSlugger from "github-slugger";

export type TocEntry = { depth: 2 | 3; id: string; text: string };

const HEADING_RE = /^(#{2,3}) (.+)$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * Extract the H2/H3 table of contents from a README.
 *
 * Ids come from `github-slugger`, the same slugger `rehype-slug` runs on the
 * rendered MDX, so sidebar anchors land on the right heading. Headings inside
 * fenced code blocks are ignored.
 */
export function extractToc(md: string): TocEntry[] {
	const slugger = new GithubSlugger();
	const entries: TocEntry[] = [];
	let inFence = false;
	for (const line of md.split("\n")) {
		if (FENCE_RE.test(line.trim())) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = line.match(HEADING_RE);
		if (!m) continue;
		const text = m[2].trim();
		entries.push({
			depth: m[1].length as 2 | 3,
			id: slugger.slug(text),
			text,
		});
	}
	return entries;
}
