/**
 * Shared site constants: brand identity, canonical URL and the outbound links
 * that appear in more than one place (metadata, sitemap, nav, footer).
 *
 * The brand is `cmdtools`, but the GitHub repository is still
 * `cmdcode-tools` — every github.com URL below points at the repo and must
 * not be renamed with the brand. `projects` is re-exported here so routes have
 * one import for both the identity constants and the project links.
 */

/** Public brand name. The repo keeps the old name (`REPO_URL`). */
export const SITE_NAME = "cmdtools";

/** Canonical origin the site is served from; `metadataBase` and the sitemap. */
export const SITE_URL = "https://cmdtools.jyz.land";

/** GitHub repository. Still `cmdcode-tools` — a dev identity, not the brand. */
export const REPO_URL = "https://github.com/JeffreyJYZ/cmdcode-tools";

/** GitHub Releases API for this repo (the changelog snapshot source). */
export const RELEASES_URL =
	"https://api.github.com/repos/JeffreyJYZ/cmdcode-tools/releases";

/** User-facing GitHub Releases page. */
export const RELEASES_PAGE_URL = `${REPO_URL}/releases`;

/** npm organisation that owns every scoped package in this repo. */
export const NPM_ORG_URL = "https://www.npmjs.com/org/jeffreyjyz";

/** Primary navigation, shared by the header and the footer. */
export const NAV_LINKS = [
	{ href: "/", label: "Home" },
	{ href: "/docs", label: "Docs" },
	{ href: "/guides", label: "Guides" },
	{ href: "/compare", label: "Compare" },
	{ href: "/changelog", label: "Changelog" },
] as const;

export type { Project } from "@/content/projects";
export { projectBySlug, projects } from "@/content/projects";
