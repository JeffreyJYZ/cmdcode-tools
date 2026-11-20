import { expect, test } from "bun:test";
import { parseAaLeaderboard } from "#~/data/sources/aa/leaderboard.ts";

// Trimmed RSC flight: a scored row keyed by release.slug, an effort variant of
// the same release, a null-index row, and a row with only a speed figure.
const flight = JSON.stringify({
	initialModels: [
		{
			id: "a",
			release: { slug: "tencent-hy4", name: "Tencent Hy4" },
			name: "Tencent Hy4",
			shortName: "Tencent Hy4",
			intelligenceIndex: 34.5552385392508,
			outputSpeed: 71.2,
		},
		{
			id: "b",
			release: { slug: "deepseek-v4-1-flash-1017", name: "DeepSeek V4.1 Flash" },
			name: "DeepSeek V4.1 Flash (High)",
			shortName: "DeepSeek V4.1 Flash (High)",
			intelligenceIndex: 28.6,
		},
		{
			id: "c",
			release: { slug: "longcat-2-0", name: "LongCat 2.0" },
			name: "LongCat 2.0",
			intelligenceIndex: null,
		},
		{
			id: "d",
			release: { slug: "mimo-v2-6-flash", name: "MiMo-V2.6-Flash" },
			name: "MiMo-V2.6-Flash",
			intelligenceIndex: null,
			outputSpeed: 210.5,
		},
		{
			id: "e",
			release: { slug: "jev-1-14", name: "Jev 1.14" },
			name: "Jev 1.14",
			intelligenceIndex: null,
			// Homepage contestants carry a 0-100 `indexScore` for decision models.
			// It is a different benchmark, never an Intelligence Index substitute.
			indexScore: 66.23416034232282,
		},
	],
});
const HTML = `<html><script>self.__next_f.push([1,${JSON.stringify(flight)}])</script></html>`;

test("parseAaLeaderboard keys on release.slug, then name", () => {
	const data = parseAaLeaderboard(HTML);
	expect(data.intelligence.get("hy4")).toBe(34.5552385392508);
	expect(data.tps.get("hy4")).toBe(71.2);
	expect(data.intelligence.get("deepseekv41flash")).toBe(28.6);
	expect(data.intelligence.get("deepseekv41flash1017")).toBe(28.6);
});

test("parseAaLeaderboard keeps null index unscored but still reads speed", () => {
	const data = parseAaLeaderboard(HTML);
	expect(data.intelligence.has("longcat20")).toBe(false);
	expect(data.intelligence.has("mimov26flash")).toBe(false);
	expect(data.tps.get("mimov26flash")).toBe(210.5);
});

test("parseAaLeaderboard never substitutes indexScore for intelligenceIndex", () => {
	const data = parseAaLeaderboard(HTML);
	expect(data.intelligence.has("jev114")).toBe(false);
	expect(data.intelligence.has("jev1140")).toBe(false);
	expect(data.intelligence.has("jev")).toBe(false);
});

test("parseAaLeaderboard is empty without the array", () => {
	expect(parseAaLeaderboard("<html></html>").intelligence.size).toBe(0);
});
