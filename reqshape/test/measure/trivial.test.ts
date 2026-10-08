import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYWORDS } from "~/constants/keywords.ts";
import { normalizePrompt, trivialReason } from "~/measure/filter.ts";

const KEYWORDS = new Set(DEFAULT_KEYWORDS);

describe("normalizePrompt", () => {
	test("strips punctuation, case and emoji down to words", () => {
		expect(normalizePrompt("Hi!")).toBe("hi");
		expect(normalizePrompt("  Thank   you.  ")).toBe("thank you");
		expect(normalizePrompt("great, thanks!!")).toBe("great thanks");
		expect(normalizePrompt("😀🎉")).toBe("");
		expect(normalizePrompt("fix `a-b` in tsconfig.json")).toBe(
			"fix a b in tsconfig json",
		);
	});
});

describe("trivialReason", () => {
	test("greetings, acknowledgements and nudges are noise", () => {
		for (const prompt of [
			"hi",
			"Hi!",
			"hey there",
			"thanks",
			"thank you",
			"ty",
			"great",
			"nice work",
			"ok",
			"ok thanks",
			"continue please",
			"yes",
			"continue",
			"go on",
			"lgtm",
			"makes sense",
			"done",
			"wait",
		]) {
			expect(trivialReason(prompt, KEYWORDS, 0)).toBe("trivial prompt");
		}
	});

	test("real asks survive", () => {
		for (const prompt of [
			"fix the auth bug",
			"add a --json flag to reqshape",
			"why is cache read so high?",
			"great work on the sidebar, now make the poll faster",
			"ok so the issue is in the v2 store",
			"then add a test for it",
		]) {
			expect(trivialReason(prompt, KEYWORDS, 0)).toBeNull();
		}
	});

	test("a prompt of nothing but emoji is its own reason", () => {
		expect(trivialReason("😀", KEYWORDS, 0)).toBe("empty prompt");
		expect(trivialReason("   ", KEYWORDS, 0)).toBe("empty prompt");
	});

	test("--min-chars is opt-in and separate", () => {
		expect(trivialReason("fix it", KEYWORDS, 0)).toBeNull();
		expect(trivialReason("fix it", KEYWORDS, 10)).toBe("short prompt");
	});

	test("a custom keyword list replaces the default", () => {
		const custom = new Set(["nope"]);
		expect(trivialReason("hi", custom, 0)).toBeNull();
		expect(trivialReason("nope", custom, 0)).toBe("trivial prompt");
	});

	test("filler alone is not enough to drop an ask", () => {
		// The all-words rule needs a real keyword in the prompt, so a filler-heavy
		// ask is profiled rather than discarded.
		expect(trivialReason("please", KEYWORDS, 0)).toBeNull();
		expect(trivialReason("there", KEYWORDS, 0)).toBeNull();
	});
});
