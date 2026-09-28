import { describe, expect, test } from "bun:test";
import {
	rememberModelUsage,
	rememberSnapshot,
	seededModelUsage,
	seededRows,
	sessionKind,
} from "../src/sidebar/useRows";

describe("session kind", () => {
	test("an unresolved provider is unknown, not someone else's", () => {
		// The host leaves the provider undefined for a frame when the tab bar
		// switches sessions; treating that as "other" is what blanked the panel.
		expect(sessionKind(undefined)).toBe("unknown");
		expect(sessionKind("")).toBe("unknown");
	});

	test("our providers are ours, the rest are other", () => {
		expect(sessionKind("command-code")).toBe("ours");
		expect(sessionKind("command-code-openai")).toBe("ours");
		expect(sessionKind("opencode-go")).toBe("go");
		expect(sessionKind("opencode")).toBe("zen");
		expect(sessionKind("opencode-zen")).toBe("zen");
		expect(sessionKind("anthropic")).toBe("other");
	});
});

describe("account snapshot cache", () => {
	test("seeds nothing before the first snapshot, then the account rows", () => {
		const before = seededRows();
		rememberSnapshot({
			plan: "GOAT",
			monthlyCap: 70,
			monthlyCredits: 12.68,
		});
		const after = seededRows();
		// Whatever ran first, the cached snapshot must yield the plan row now.
		expect(after[0]).toEqual(["Plan", "GOAT · $70/mo credits", "base", true]);
		expect(after.map((row) => row[0])).toContain("Monthly");
		expect(before.length).toBeLessThanOrEqual(after.length);
	});
});

describe("model usage cache", () => {
	test("the model block keeps its last figure, like the account block", () => {
		// Canonical key: the session id's vendor prefix and punctuation drop out,
		// so the same model under either spelling hits the same slot.
		rememberModelUsage("command-code-openai/deepseek-v4.1-flash", {
			requests: 12,
			cost: 1.5,
		});
		expect(seededModelUsage("deepseek-v4.1-flash")).toEqual({
			requests: 12,
			cost: 1.5,
		});
		expect(seededModelUsage("DeepSeek V4.1 Flash")).toEqual({
			requests: 12,
			cost: 1.5,
		});
	});

	test("never paints another model's figure", () => {
		rememberModelUsage("command-code-openai/deepseek-v4.1-flash", {
			requests: 12,
			cost: 1.5,
		});
		// A model the panel has not seen shows nothing rather than someone else's
		// numbers, which is what a stale shared signal used to do after a switch.
		expect(seededModelUsage("kimi-k2.7")).toBeUndefined();
		// An unresolved id (mid-switch) keeps the row up instead of blanking it.
		expect(seededModelUsage(undefined)).toEqual({ requests: 12, cost: 1.5 });
	});
});
