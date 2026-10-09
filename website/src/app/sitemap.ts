import type { MetadataRoute } from "next";
import { projects } from "@/content/projects";
import { SITE_URL } from "@/lib/consts";
import { listGuides } from "@/lib/guides";

const url = (path: string): string => `${SITE_URL}${path}`;

// `output: "export"` prerenders metadata routes; without this Next refuses to
// emit `sitemap.xml` at build time.
export const dynamic = "force-static";

/**
 * Every static route on the site, resolved against `SITE_URL`.
 *
 * The docs and guide entries come from the same loaders the pages use, so a
 * new project in `src/content/projects.ts` or guide `.mdx` file is listed
 * without touching this file. `output: "export"` renders it to `sitemap.xml`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();

	return [
		{
			url: url(""),
			lastModified,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: url("/docs"),
			lastModified,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		...projects.map((project) => ({
			url: url(`/docs/${project.slug}`),
			lastModified,
			changeFrequency: "weekly" as const,
			priority: 0.7,
		})),
		{
			url: url("/guides"),
			lastModified,
			changeFrequency: "weekly",
			priority: 0.8,
		},
		...listGuides().map((guide) => ({
			url: url(`/guides/${guide.slug}`),
			lastModified,
			changeFrequency: "monthly" as const,
			priority: 0.6,
		})),
		{
			url: url("/compare"),
			lastModified,
			changeFrequency: "weekly",
			priority: 0.7,
		},
		{
			url: url("/changelog"),
			lastModified,
			changeFrequency: "weekly",
			priority: 0.6,
		},
	];
}
