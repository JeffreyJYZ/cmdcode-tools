import { expect, test } from "bun:test";
import { parseCcFlight } from "#~/data/bench/cc.ts";

// A trimmed RSC payload: one scored model, one unscored (`"$undefined"`), and a
// branded slug that must alias back to the catalog key. The chunk is built the
// same way Next.js emits it: a JSON string literal holding the flight text.
const flight = JSON.stringify({
	models: [
		{ slug: "tencent-hy3", name: "Tencent HY3", intelligenceIndex: 25.3 },
		{
			slug: "muse-spark-1-2-contributor",
			name: "Muse Spark 1.2 Contributor",
			intelligenceIndex: "$undefined",
		},
		{
			slug: "deepseek-v4-flash-vision",
			name: "DeepSeek V4 Flash Vision",
			intelligenceIndex: 34.8,
		},
	],
});
const HTML = `<html><body><script>self.__next_f.push([1,${JSON.stringify(flight)}])</script></body></html>`;

test("parseCcFlight reads scored models from the RSC models array", () => {
	const data = parseCcFlight(HTML);
	expect(data.intelligence.get("hy3")).toBe(25.3);
	expect(data.intelligence.get("deepseekv4flashvisionexp")).toBe(34.8);
});

test("parseCcFlight never coerces an unscored row to a number", () => {
	const data = parseCcFlight(HTML);
	expect(data.intelligence.has("musespark12contributor")).toBe(false);
	expect(data.tps.size).toBe(0);
});

test("parseCcFlight returns empty data when no models array exists", () => {
	expect(parseCcFlight("<html></html>").intelligence.size).toBe(0);
});
