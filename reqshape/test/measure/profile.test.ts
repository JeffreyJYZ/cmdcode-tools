import { describe, expect, test } from "bun:test";
import { buildShape } from "#~/measure/profile.ts";
import type { Ask, Req } from "#~/types.ts";

function req(
	position: number,
	values: { input?: number; output?: number; cacheRead?: number } = {},
): Req {
	return {
		model: "glm-5.2",
		provider: "opencode-go",
		tokensIn: values.input ?? 100,
		output: values.output ?? 10,
		reasoning: 0,
		cacheRead: values.cacheRead ?? 1_000,
		cacheWrite: 0,
		cost: 0,
		position,
	};
}

function ask(overrides: Partial<Ask> = {}): Ask {
	return {
		sessionID: "a",
		directory: "/dev/one",
		child: false,
		kind: "user",
		text: "do the thing",
		time: 1_000,
		reqs: [req(1)],
		...overrides,
	};
}

describe("buildShape", () => {
	test("an empty run yields zeros rather than NaN", () => {
		const shape = buildShape([]);
		expect(shape.reqs).toBe(0);
		expect(shape.perReq.cacheRead).toBe(0);
		expect(shape.perSession.cacheRead).toBe(0);
		expect(shape.buckets).toEqual([]);
		expect(shape.models).toEqual([]);
		expect(shape.modelTotal).toBe(0);
		expect(shape.first).toBe(0);
	});

	test("every req weighs equally, with a per-conversation contrast", () => {
		// Session A: two cheap reqs at the top of the conversation.
		// Session B: three reqs deep in a long one, each re-reading a large context.
		const shape = buildShape([
			ask({
				reqs: [req(1, { cacheRead: 100 }), req(2, { cacheRead: 200 })],
			}),
			ask({
				sessionID: "b",
				directory: "/dev/two",
				time: 2_000,
				reqs: [
					req(1, { cacheRead: 1_000 }),
					req(2, { cacheRead: 1_000 }),
					req(3, { cacheRead: 1_000 }),
				],
			}),
		]);

		expect(shape.reqs).toBe(5);
		expect(shape.asks).toBe(2);
		expect(shape.sessions).toBe(2);
		expect(shape.projects).toBe(2);
		expect(shape.first).toBe(1_000);
		expect(shape.last).toBe(2_000);

		// Per req: (100 + 200 + 1000*3) / 5 = 660
		expect(shape.perReq.cacheRead).toBe(660);
		// Per conversation: (150 + 1000) / 2 = 575 — closer to a typical chat.
		expect(shape.perSession.cacheRead).toBe(575);
	});

	test("buckets by the req's position in its session", () => {
		const shape = buildShape([
			ask({ reqs: [req(1, { cacheRead: 400 })] }),
			ask({
				sessionID: "b",
				reqs: [
					req(1, { cacheRead: 1_000 }),
					req(2, { cacheRead: 3_000 }),
				],
			}),
		]);
		expect(shape.buckets.map((bucket) => bucket.label)).toEqual([
			"1",
			"2-5",
		]);
		expect(shape.buckets[0]?.reqs).toBe(2);
		expect(shape.buckets[0]?.cacheRead).toBe(700);
		expect(shape.buckets[1]?.cacheRead).toBe(3_000);
	});

	test("position buckets cover the depth where the context actually grows", () => {
		const shape = buildShape([
			ask({
				reqs: Array.from({ length: 102 }, (_, index) => req(index + 1)),
			}),
		]);
		expect(shape.buckets.map((bucket) => bucket.label)).toEqual([
			"1",
			"2-5",
			"6-20",
			"21-100",
			"101+",
		]);
		expect(shape.buckets.at(-1)?.reqs).toBe(2);
	});

	test("several asks in one session count as one conversation", () => {
		const shape = buildShape([
			ask({ reqs: [req(1, { cacheRead: 1_000 })] }),
			ask({ text: "next", reqs: [req(2, { cacheRead: 3_000 })] }),
		]);
		expect(shape.asks).toBe(2);
		expect(shape.sessions).toBe(1);
		// The conversation averages 2000; per-req happens to agree here.
		expect(shape.perSession.cacheRead).toBe(2_000);
		expect(shape.perReq.cacheRead).toBe(2_000);
	});

	test("models are ranked by reqs and capped", () => {
		const reqs = Array.from({ length: 12 }, (_, index) => ({
			...req(index + 1),
			model: `vendor/model-${index}`,
		}));
		const shape = buildShape([ask({ reqs })]);
		expect(shape.models).toHaveLength(8);
		expect(shape.models[0]?.name).toBe("vendor/model-0");
		expect(shape.models[0]?.reqs).toBe(1);
		// The display list is capped, but the report's "…N more" needs the true
		// total, not `capped - 6`.
		expect(shape.modelTotal).toBe(12);
	});

	test("stats carry the shape of the distribution", () => {
		const shape = buildShape([
			ask({
				reqs: [
					req(1, { cacheRead: 0, input: 1, output: 2 }),
					req(2, { cacheRead: 10_000, input: 3, output: 4 }),
				],
			}),
		]);
		expect(shape.stats.cacheRead.mean).toBe(5_000);
		expect(shape.stats.cacheRead.max).toBe(10_000);
		expect(shape.stats.input.mean).toBe(2);
		expect(shape.stats.output.max).toBe(4);
	});
});
