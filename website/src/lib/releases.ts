/**
 * Types, the timeline transform and display helpers for the `/changelog` page.
 *
 * Pure module — no filesystem, no network — so both the build-time snapshot
 * script (`scripts/snapshot-releases.ts`) and the page/component can import it.
 * The data itself is generated into `src/data/releases.json`, committed, and
 * read statically at build time (Vercel never fetches these registries).
 *
 * Release notes are untrusted registry text: they are carried through as plain
 * strings and rendered as plain text — never as raw HTML.
 */

/** Where a timeline entry came from. Derived from the entry's URL host. */
export type ReleaseSource = "release" | "npm" | "crate";

/** One GitHub Release, trimmed to the fields the timeline reads. */
export type GitHubRelease = {
	tag: string;
	name: string;
	publishedAt: string;
	url: string;
	/** Release body, markdown-lite. Rendered as plain text. */
	notes?: string;
};

/** One published npm version. */
export type NpmRelease = {
	package: string;
	version: string;
	date: string;
	url: string;
};

/** One published crates.io version (yanked versions are excluded upstream). */
export type CrateRelease = {
	crate: string;
	version: string;
	date: string;
	url: string;
};

/** The committed snapshot written by `scripts/snapshot-releases.ts`. */
export type ReleasesSnapshot = {
	generatedAt: string;
	github: GitHubRelease[];
	npm: NpmRelease[];
	crates: CrateRelease[];
};

/** A single flattened changelog row. */
export type TimelineEntry = {
	package: string;
	version: string;
	date: string;
	url: string;
	notes?: string;
};

/** Entries for one package, newest-first. */
export type TimelineGroup = {
	package: string;
	/** Newest entry's ISO date — the group's sort key. */
	date: string;
	entries: TimelineEntry[];
};

/** `cmduse-v0.7.7` → `{ package: "cmduse", version: "0.7.7" }`. */
export function releaseFromTag(
	tag: string,
	fallbackVersion: string,
): { package: string; version: string } {
	const match = /^(.+)-v(\d.+)$/.exec(tag);
	if (match) return { package: match[1], version: match[2] };
	return { package: tag, version: fallbackVersion };
}

/** Milliseconds since epoch; `0` for an unparseable date so sorting never NaNs. */
function timeOf(iso: string): number {
	const t = Date.parse(iso);
	return Number.isNaN(t) ? 0 : t;
}

/**
 * Flatten the snapshot into one newest-first timeline.
 *
 * Tolerant of a missing or empty release list — and of a missing snapshot
 * entirely — so a partially-failed snapshot still renders. Every entry keeps
 * the URL of the source it came from.
 */
export function buildTimeline(
	data: Partial<ReleasesSnapshot> | null | undefined,
): TimelineEntry[] {
	const github = data?.github ?? [];
	const npm = data?.npm ?? [];
	const crates = data?.crates ?? [];

	const entries: TimelineEntry[] = [];

	for (const r of github) {
		const { package: pkg, version } = releaseFromTag(r.tag, r.name);
		const entry: TimelineEntry = {
			package: pkg,
			version,
			date: r.publishedAt,
			url: r.url,
		};
		if (r.notes) entry.notes = r.notes;
		entries.push(entry);
	}

	for (const n of npm) {
		entries.push({
			package: n.package,
			version: n.version,
			date: n.date,
			url: n.url,
		});
	}

	for (const c of crates) {
		entries.push({
			package: c.crate,
			version: c.version,
			date: c.date,
			url: c.url,
		});
	}

	return entries.sort((a, b) => {
		const byDate = timeOf(b.date) - timeOf(a.date);
		if (byDate !== 0) return byDate;
		const byPackage = a.package.localeCompare(b.package);
		if (byPackage !== 0) return byPackage;
		return b.version.localeCompare(a.version);
	});
}

/**
 * Group a timeline by package, newest group first, entries newest-first within.
 * `buildTimeline` already sorts; this only partitions, preserving that order.
 */
export function groupTimeline(entries: TimelineEntry[]): TimelineGroup[] {
	const byPackage = new Map<string, TimelineEntry[]>();
	for (const entry of entries) {
		const bucket = byPackage.get(entry.package);
		if (bucket) bucket.push(entry);
		else byPackage.set(entry.package, [entry]);
	}

	const groups: TimelineGroup[] = [];
	for (const [pkg, list] of byPackage) {
		groups.push({ package: pkg, date: list[0].date, entries: list });
	}

	// Entry order within a group is already newest-first; sort only the groups.
	return groups.sort((a, b) => {
		const byDate = timeOf(b.date) - timeOf(a.date);
		return byDate !== 0 ? byDate : a.package.localeCompare(b.package);
	});
}

/** Readable source name for an entry URL, keyed on its host. */
export function sourceLabel(url: string): string {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return url;
	}
	if (host === "github.com") return "GitHub";
	if (host === "npmjs.com" || host === "www.npmjs.com") return "npm";
	if (host === "crates.io") return "crates.io";
	return host;
}

/** Short UTC date, e.g. `Sep 29, 2026`; the raw string when unparseable. */
export function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(date);
}
