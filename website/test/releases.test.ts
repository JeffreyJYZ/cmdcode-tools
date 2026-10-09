import { describe, expect, test } from "bun:test";
import {
	buildTimeline,
	groupTimeline,
	type ReleasesSnapshot,
	sourceLabel,
} from "@/lib/releases";

const GH_URL =
	"https://github.com/JeffreyJYZ/cmdcode-tools/releases/tag/cmduse-v0.8.0";
const NPM_URL =
	"https://www.npmjs.com/package/@jeffreyjyz/opencode-context/v/0.1.1";
const CRATE_URL = "https://crates.io/crates/cmd-usage/0.7.7";

/** One entry per source, dated so newest-first ordering is unambiguous. */
const fixture: ReleasesSnapshot = {
	generatedAt: "2026-10-09T00:00:00.000Z",
	github: [
		{
			tag: "cmduse-v0.8.0",
			name: "cmduse-v0.8.0",
			publishedAt: "2026-10-01T00:00:00Z",
			url: GH_URL,
			notes: "**Full Changelog**: https://example.com/compare",
		},
	],
	npm: [
		{
			package: "@jeffreyjyz/opencode-context",
			version: "0.1.1",
			date: "2026-10-04T07:02:34.635Z",
			url: NPM_URL,
		},
	],
	crates: [
		{
			crate: "cmd-usage",
			version: "0.7.7",
			date: "2026-09-29T14:34:18.949Z",
			url: CRATE_URL,
		},
		{
			crate: "cmduse-core",
			version: "2.0.0",
			date: "2026-09-29T11:59:51.899Z",
			url: "https://crates.io/crates/cmduse-core/2.0.0",
		},
	],
};

describe("buildTimeline — empty inputs", () => {
	test("an empty GitHub list yields no entries (no throw)", () => {
		expect(
			buildTimeline({ generatedAt: "", github: [], npm: [], crates: [] }),
		).toEqual([]);
		expect(buildTimeline({ github: [] })).toEqual([]);
	});

	test("a missing or null snapshot yields no entries", () => {
		expect(buildTimeline(null)).toEqual([]);
		expect(buildTimeline(undefined)).toEqual([]);
		expect(buildTimeline({})).toEqual([]);
	});
});

describe("buildTimeline — mixed fixture", () => {
	test("sorts newest-first by date across every source", () => {
		const entries = buildTimeline(fixture);
		expect(entries.map((e) => e.date)).toEqual([
			"2026-10-04T07:02:34.635Z",
			"2026-10-01T00:00:00Z",
			"2026-09-29T14:34:18.949Z",
			"2026-09-29T11:59:51.899Z",
		]);
	});

	test("attaches the source URL to each entry", () => {
		const entries = buildTimeline(fixture);
		expect(entries.find((e) => e.version === "0.1.1")?.url).toBe(NPM_URL);
		expect(entries.find((e) => e.package === "cmd-usage")?.url).toBe(
			CRATE_URL,
		);
		expect(entries.find((e) => e.package === "cmduse")?.url).toBe(GH_URL);
	});

	test("derives the package from a release tag and keeps notes", () => {
		const entries = buildTimeline(fixture);
		const release = entries.find((e) => e.package === "cmduse");
		expect(release?.version).toBe("0.8.0");
		expect(release?.notes).toContain("Full Changelog");
		// Registry entries have no notes.
		expect(
			entries.find((e) => e.package === "cmd-usage")?.notes,
		).toBeUndefined();
	});

	test("every entry has the required fields", () => {
		for (const e of buildTimeline(fixture)) {
			for (const k of ["package", "version", "date", "url"] as const) {
				expect(typeof e[k]).toBe("string");
				expect(e[k].length).toBeGreaterThan(0);
			}
		}
	});
});

describe("groupTimeline", () => {
	test("groups by package; groups and their entries are newest-first", () => {
		const groups = groupTimeline(buildTimeline(fixture));
		expect(groups.map((g) => g.package)).toEqual([
			"@jeffreyjyz/opencode-context",
			"cmduse",
			"cmd-usage",
			"cmduse-core",
		]);
		for (const g of groups) {
			const dates = g.entries.map((e) => e.date);
			expect([...dates].sort().reverse()).toEqual(dates);
		}
	});

	test("an empty timeline yields no groups", () => {
		expect(groupTimeline([])).toEqual([]);
	});
});

describe("sourceLabel", () => {
	test("maps each registry host to a readable name", () => {
		expect(sourceLabel(GH_URL)).toBe("GitHub");
		expect(sourceLabel(NPM_URL)).toBe("npm");
		expect(sourceLabel(CRATE_URL)).toBe("crates.io");
	});

	test("an unknown host falls back to the hostname, never to nothing", () => {
		expect(sourceLabel("https://example.com/x")).toBe("example.com");
	});
});
