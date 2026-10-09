/**
 * Build-time snapshot of release/registry data for the `/changelog` page.
 *
 * Vercel cannot fetch these registries at request time (and the page should be
 * static), so the timeline is a snapshot: this script fetches the GitHub
 * Releases API, the npm registry and crates.io once and writes the committed
 * `src/data/releases.json`. Re-run with `bun snapshot:releases`.
 *
 * Every source is fetched independently: a single unreachable source is logged
 * and skipped (empty list) rather than aborting the run, so a partial outage
 * still produces a usable snapshot. If *every* source fails, the run throws —
 * a snapshot with no data at all is worse than no write.
 *
 * npm identity guard: every package here is published under the `@jeffreyjyz`
 * scope (the bare `mpc` name on npm belongs to an unrelated package,
 * "Multi-Part Components Parser", maintainer `emilis`). The registry packument
 * is only accepted when it is maintained by `jeffreyjyz`, so this repo's
 * timeline can never misattribute a foreign package's versions.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES_URL } from "@/lib/consts";
import type {
	CrateRelease,
	GitHubRelease,
	NpmRelease,
	ReleasesSnapshot,
} from "@/lib/releases";

const GITHUB_REPO = "JeffreyJYZ/cmdcode-tools";
const GITHUB_API = RELEASES_URL;
const REGISTRY = "https://registry.npmjs.org";
const CRATES_API = "https://crates.io/api/v1/crates";

/** npm package names this repo publishes (all under the `@jeffreyjyz` scope). */
const NPM_PACKAGES = [
	"@jeffreyjyz/mpc",
	"@jeffreyjyz/reqshape",
	"@jeffreyjyz/opencode-command-code",
	"@jeffreyjyz/opencode-context",
	"@jeffreyjyz/opencode-shell-rc",
	"@jeffreyjyz/opencode-session-dir",
] as const;

/** crates.io crates this repo publishes. */
const CRATES = ["cmd-usage", "cmduse-core"] as const;

const NPM_OWNER = "jeffreyjyz";

/** crates.io and GitHub both want a descriptive UA; GitHub rejects anonymous. */
const USER_AGENT = `cmdcode-tools-website-snapshot (https://github.com/${GITHUB_REPO})`;

const OUT_FILE = join(
	fileURLToPath(import.meta.url),
	"..",
	"..",
	"src",
	"data",
	"releases.json",
);

const PAGE_SIZE = 100;

async function getJson<T>(url: string, headers: Record<string, string>) {
	const res = await fetch(url, { headers });
	if (!res.ok) {
		throw new Error(`${res.status} ${res.statusText} — ${url}`);
	}
	return (await res.json()) as T;
}

/** Page through the Releases API until an empty page. */
async function fetchGithub(): Promise<GitHubRelease[]> {
	const headers = {
		Accept: "application/vnd.github+json",
		"User-Agent": USER_AGENT,
	};
	const releases: GitHubRelease[] = [];
	for (let page = 1; ; page++) {
		const batch = await getJson<RawGithubRelease[]>(
			`${GITHUB_API}?per_page=${PAGE_SIZE}&page=${page}`,
			headers,
		);
		if (batch.length === 0) break;
		for (const r of batch) {
			const release: GitHubRelease = {
				tag: r.tag_name,
				name: r.name ?? r.tag_name,
				publishedAt: r.published_at ?? "",
				url: r.html_url,
			};
			if (r.body) release.notes = r.body;
			releases.push(release);
		}
		if (batch.length < PAGE_SIZE) break;
	}
	return releases;
}

type RawGithubRelease = {
	tag_name: string;
	name: string | null;
	published_at: string | null;
	html_url: string;
	body: string | null;
	draft: boolean;
	prerelease: boolean;
};

type RawPackument = {
	name?: string;
	maintainers?: { name?: string }[];
	time?: Record<string, string>;
};

/** Version-time entries for one npm package; empty when foreign or unpublished. */
async function fetchNpmPackage(pkg: string): Promise<NpmRelease[]> {
	const packument = await getJson<RawPackument>(
		`${REGISTRY}/${encodeURIComponent(pkg)}`,
		{ "User-Agent": USER_AGENT },
	);
	const maintained = (packument.maintainers ?? []).some(
		(m) => m.name === NPM_OWNER,
	);
	if (!maintained) {
		console.warn(
			`  skip npm ${pkg}: not maintained by ${NPM_OWNER} (foreign package)`,
		);
		return [];
	}
	const time = packument.time ?? {};
	const versions: NpmRelease[] = [];
	for (const [version, date] of Object.entries(time)) {
		// `created`/`modified` are packument metadata, not published versions.
		if (version === "created" || version === "modified") continue;
		versions.push({
			package: pkg,
			version,
			date,
			url: `https://www.npmjs.com/package/${pkg}/v/${version}`,
		});
	}
	return versions;
}

type RawCrateVersions = {
	versions: {
		num: string;
		created_at: string;
		yanked: boolean;
	}[];
};

/** Non-yanked versions for one crate; newest-first as the API returns them. */
async function fetchCrate(crate: string): Promise<CrateRelease[]> {
	const data = await getJson<RawCrateVersions>(
		`${CRATES_API}/${crate}/versions`,
		{ "User-Agent": USER_AGENT },
	);
	return data.versions
		.filter((v) => !v.yanked)
		.map((v) => ({
			crate,
			version: v.num,
			date: v.created_at,
			url: `https://crates.io/crates/${crate}/${v.num}`,
		}));
}

/** Run one source; a failure is logged and yields `[]` rather than aborting. */
async function settle<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
	try {
		const items = await run();
		console.log(`  ${label}: ${items.length} entries`);
		return items;
	} catch (error) {
		console.warn(
			`  ${label}: FAILED — ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

async function main(): Promise<void> {
	console.log(`snapshot:releases — ${GITHUB_REPO}`);

	const github = await settle("github releases", fetchGithub);

	const npm: NpmRelease[] = [];
	for (const pkg of NPM_PACKAGES) {
		npm.push(
			...((await settle(`npm ${pkg}`, () => fetchNpmPackage(pkg))) ?? []),
		);
	}

	const crates: CrateRelease[] = [];
	for (const crate of CRATES) {
		crates.push(
			...((await settle(`crate ${crate}`, () => fetchCrate(crate))) ??
				[]),
		);
	}

	const total = github.length + npm.length + crates.length;
	if (total === 0) {
		throw new Error(
			"every source returned nothing — refusing to write an empty snapshot",
		);
	}

	const snapshot: ReleasesSnapshot = {
		generatedAt: new Date().toISOString(),
		github,
		npm,
		crates,
	};

	mkdirSync(dirname(OUT_FILE), { recursive: true });
	writeFileSync(OUT_FILE, `${JSON.stringify(snapshot, null, "\t")}\n`);
	console.log(`snapshot:releases — wrote ${OUT_FILE} (${total} entries)`);
}

main();
