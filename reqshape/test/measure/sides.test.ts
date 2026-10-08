import { describe, expect, test } from "bun:test";
import { CC_PREFIXES } from "~/constants/providers.ts";
import { sideOf, sideProfiles } from "~/measure/sides.ts";
import type { Req } from "~/types.ts";

function req(provider: string, values: Partial<Req> = {}): Req {
	return {
		model: "glm-5.2",
		provider,
		tokensIn: 1_000,
		output: 100,
		reasoning: 0,
		cacheRead: 10_000,
		cacheWrite: 0,
		cost: 0,
		position: 1,
		...values,
	};
}

describe("sideOf", () => {
	test("every provider variant the CommandCode plugin registers is cc", () => {
		for (const id of [
			...CC_PREFIXES,
			"command-code-openai",
			"command-code-anthropic",
		]) {
			expect(sideOf(id)).toBe("cc");
		}
	});

	test("opencode's own providers are the other side", () => {
		expect(sideOf("opencode")).toBe("oc");
		expect(sideOf("opencode-go")).toBe("oc");
	});

	test("a router or a local model belongs to neither side", () => {
		for (const id of ["omniroute", "openrouter", "ollama-cloud", ""]) {
			expect(sideOf(id)).toBeNull();
		}
	});
});

describe("sideProfiles", () => {
	test("each side is averaged on its own traffic", () => {
		const sides = sideProfiles([
			req("opencode-go", { cacheRead: 10_000 }),
			req("command-code-openai", { cacheRead: 300_000 }),
			req("omniroute", { cacheRead: 999_999 }),
		]);
		expect(sides.oc?.reqs).toBe(1);
		expect(sides.oc?.profile.cacheRead).toBe(10_000);
		expect(sides.cc?.reqs).toBe(1);
		expect(sides.cc?.profile.cacheRead).toBe(300_000);
	});

	test("a side nobody used is absent rather than zero", () => {
		const sides = sideProfiles([req("opencode")]);
		expect(sides.cc).toBeUndefined();
		expect(sides.oc?.reqs).toBe(1);
	});
});
