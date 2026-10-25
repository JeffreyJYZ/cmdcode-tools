import { describe, expect, test } from "bun:test";
import { type FilterOptions, filterAsks } from "#~/measure/filter.ts";
import type { Ask, Req } from "#~/types.ts";

const OPTIONS: FilterOptions = {
	sessions: "all",
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

		// Subagents are usage, and a one-word prompt is still work: both kept.
		expect(kept).toHaveLength(3);
		expect(kept.some((entry) => entry.child)).toBe(true);

		const reasons = Object.fromEntries(drops.map((drop) => [drop.reason, drop.asks]));
		expect(reasons["synthetic prompt"]).toBe(1);
		expect(reasons["compaction prompt"]).toBe(1);
		expect(reasons["no model call"]).toBe(1);
		expect(reasons["other project"]).toBe(1);
		expect(reasons["subagent session"]).toBeUndefined();
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
