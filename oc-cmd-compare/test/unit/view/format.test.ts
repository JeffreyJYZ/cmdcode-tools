import { describe, expect, test } from "bun:test";
import { fmtUsd } from "#~/view/render.ts";

describe("fmtUsd", () => {
	test("no scientific notation for tiny values", () => {
		expect(fmtUsd(0.00003667)).toBe("$0.00003667");
		expect(fmtUsd(0.00011)).toBe("$0.00011");
		expect(fmtUsd(0.065)).toBe("$0.065");
		expect(fmtUsd(0.0367)).toBe("$0.0367");
		expect(fmtUsd(0)).toBe("free");
	});
});
