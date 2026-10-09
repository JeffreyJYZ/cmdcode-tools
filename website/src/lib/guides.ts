import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export type GuideMeta = {
	slug: string;
	title: string;
	description: string;
	order: number;
};

export type Guide = GuideMeta & { body: string };

// Resolve the content dir from this module's own path instead of a `new URL`
// asset reference: Turbopack const-folds a string target and then tries to
// bundle the directory as a module, which fails. A bare `import.meta.url`
// stays a runtime value, same as `@/lib/load` uses for the package READMEs.
const GUIDES_DIR = join(
	fileURLToPath(import.meta.url),
	"..",
	"..",
	"content",
	"guides",
);
const EXT = ".mdx";

/**
 * Parse one guide source: frontmatter becomes metadata, the remainder the body.
 *
 * A missing or non-numeric `order` falls back to `Number.MAX_SAFE_INTEGER` so
 * the comparator below never sees `undefined`/`NaN` — with those the sort is
 * implementation-defined and the listing could reorder between calls.
 */
export function parseGuide(slug: string, source: string): Guide {
	const { data, content } = matter(source);
	return {
		slug,
		title: typeof data.title === "string" ? data.title : slug,
		description:
			typeof data.description === "string" ? data.description : "",
		order:
			typeof data.order === "number"
				? data.order
				: Number.MAX_SAFE_INTEGER,
		body: content,
	};
}

/**
 * Ascending `order`, then title A→Z, then slug — a total order, so two guides
 * sharing both `order` and `title` still sort the same on every machine (the
 * slug tiebreak removes the filesystem/`readdir` dependence).
 */
export function compareGuides(a: GuideMeta, b: GuideMeta): number {
	if (a.order !== b.order) return a.order - b.order;
	return a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
}

function guideSlugs(): string[] {
	return readdirSync(GUIDES_DIR)
		.filter((name) => name.endsWith(EXT))
		.map((name) => name.slice(0, -EXT.length));
}

function readSource(slug: string): string {
	return readFileSync(join(GUIDES_DIR, `${slug}${EXT}`), "utf8");
}

/** Every guide's metadata, sorted by `order` then title. */
export function listGuides(): GuideMeta[] {
	return guideSlugs()
		.map((slug) => parseGuide(slug, readSource(slug)))
		.map(({ slug, title, description, order }) => ({
			slug,
			title,
			description,
			order,
		}))
		.sort(compareGuides);
}

/** Render one guide, or `undefined` for an unknown slug. */
export function loadGuide(slug: string): Guide | undefined {
	if (!guideSlugs().includes(slug)) return undefined;
	return parseGuide(slug, readSource(slug));
}
