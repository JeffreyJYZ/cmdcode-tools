import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYWORDS } from "#~/constants/keywords.ts";
import { type FilterOptions, filterAsks } from "#~/measure/filter.ts";
import type { Ask, Req } from "#~/types.ts";

const OPTIONS: FilterOptions = {
	sessions: "all",
	keywords: new Set(DEFAULT_KEYWORDS),
	minChars: 0,
	minOutput: 0,
	keepTrivial: false,
	since: 0,
	project: "",
};

function req(output = 100, position = 1): Req {
	return {
		model: "glm-5.2",
		provider: "opencode-go",
		tokensIn: 10,
		output,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		position,
	};
}

function ask(overrides: Partial<Ask> = {}): Ask {
	return {
		sessionID: "ses_1",
		directory: "/dev/one",
		child: false,
		kind: "user",
		text: "make the sidebar poll faster",
		time: 1_000_000,
		reqs: [req()],
		...overrides,
	};
}

describe("filterAsks", () => {
	test("keeps real asks and counts everything it drops", () => {
		const { kept, drops } = filterAsks(
			[
				ask(),
				ask({ text: "hi", reqs: [req(1), req(2)] }),
				ask({ kind: "synthetic", text: "continue" }),
				ask({ kind: "compaction", text: "summary" }),
				ask({ child: true, text: "subagent work" }),
				ask({ reqs: [] }),
				ask({ directory: "/dev/two" }),
			].map((entry, index) => ({ ...entry, sessionID: `ses_${index}` })),
			{ ...OPTIONS, project: "/dev/one" },
		);

		// Subagents are usage, so they are kept unless asked otherwise.
		expect(kept).toHaveLength(2);
		expect(kept.some((entry) => entry.child)).toBe(true);

		const reasons = Object.fromEntries(
			drops.map((drop) => [drop.reason, drop.asks]),
		);
		expect(reasons["trivial prompt"]).toBe(1);
		expect(reasons["synthetic prompt"]).toBe(1);
		expect(reasons["compaction prompt"]).toBe(1);
		expect(reasons["no model call"]).toBe(1);
		expect(reasons["other project"]).toBe(1);
		expect(reasons["subagent session"]).toBeUndefined();
		// Dropped asks carry the reqs they would have contributed.
		expect(
			drops.find((drop) => drop.reason === "trivial prompt")?.reqs,
		).toBe(2);
	});

	test("--sessions user drops subagent sessions", () => {
		const { kept, drops } = filterAsks([ask({ child: true })], {
			...OPTIONS,
			sessions: "user",
		});
		expect(kept).toHaveLength(0);
		expect(drops[0]?.reason).toBe("subagent session");
	});

	test("--since and --project scope the run", () => {
		const asks = [
			ask({ time: 5_000 }),
			ask({ sessionID: "b", time: 1_000 }),
			ask({ sessionID: "c", directory: "/dev/elsewhere" }),
		];
		const scoped = filterAsks(asks, {
			...OPTIONS,
			since: 2_000,
			project: "/dev/one",
		});
		expect(scoped.kept.map((entry) => entry.sessionID)).toEqual(["ses_1"]);
	});

	test("--keep-trivial profiles everything, noise included", () => {
		const { kept, drops } = filterAsks(
			[
				ask({ text: "hi" }),
				ask({ sessionID: "b", kind: "synthetic" }),
				ask({ sessionID: "c", child: true }),
			],
			{ ...OPTIONS, keepTrivial: true },
		);
		// Only the structural drops survive: noise is kept, non-asks are not.
		expect(kept).toHaveLength(2);
		expect(drops.map((drop) => drop.reason)).toEqual(["synthetic prompt"]);
	});

	test("--min-output drops asks that produced almost nothing", () => {
		const { kept, drops } = filterAsks(
			[ask({ reqs: [req(5), req(5)] }), ask({ sessionID: "b" })],
			{ ...OPTIONS, minOutput: 50 },
		);
		expect(kept).toHaveLength(1);
		expect(drops[0]?.reason).toBe("under --min-output");
	});

	test("a dropped ask reports the reqs it held, and drops are ranked", () => {
		const { drops } = filterAsks(
			[
				ask({ kind: "synthetic", reqs: [req(), req(), req()] }),
				ask({ sessionID: "b", text: "hi", reqs: [req()] }),
			],
			OPTIONS,
		);
		expect(drops[0]?.reason).toBe("synthetic prompt");
		expect(drops[0]?.reqs).toBe(3);
	});
});
