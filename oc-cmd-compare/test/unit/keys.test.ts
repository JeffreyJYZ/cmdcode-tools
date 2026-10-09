import { describe, expect, test } from "bun:test";
import { BOUNDARY } from "#~/constants/data.ts";
import { displayName, normalizeKey } from "#~/keys.ts";

describe("normalizeKey", () => {
	test("strips vendor prefix and punctuation", () => {
		expect(normalizeKey("deepseek/deepseek-v4.1-flash")).toBe(
			"deepseekv41flash",
		);
		expect(normalizeKey("Qwen/Qwen3.8-Max")).toBe("qwen38max");
		expect(normalizeKey("z-ai/glm-5.3-flash")).toBe("glm53flash");
	});
	test("same key from both catalogs' spellings", () => {
		expect(normalizeKey("DeepSeek V4.1 Flash (Off-Peak)")).toBe(
			normalizeKey("deepseek/deepseek-v4.1-flash"),
		);
		expect(normalizeKey("Kimi K2.7 Code")).toBe(
			normalizeKey("moonshotai/Kimi-K2.7-Code"),
		);
		expect(normalizeKey("opencode-go/deepseek-v4.1-flash")).toBe(
			"deepseekv41flash",
		);
	});
	test("aliases vendor-branded variants", () => {
		expect(normalizeKey("Tencent Hy3")).toBe("hy3");
		expect(normalizeKey("Tencent Hy4 Preview")).toBe("hy4preview");
		expect(normalizeKey("DeepSeek V4 Flash Vision (exp)")).toBe(
			"deepseekv4flashvisionexp",
		);
		// Alibaba's release name for the model CommandCode sells as "Qwen 3.8
		// Flash", so the AA index lands on the row that is listed here.
		expect(normalizeKey("Qwen3.8-Flash-Next")).toBe("qwen38flash");
		expect(normalizeKey("qwen3-8-flash-next")).toBe(
			normalizeKey("Qwen 3.8 Flash"),
		);
	});
	test("keeps speed variants distinct", () => {
		expect(normalizeKey("GLM-5.2 Fast")).not.toBe(normalizeKey("GLM-5.2"));
		expect(normalizeKey("Qwen 3.8 Max 0902")).not.toBe(
			normalizeKey("Qwen 3.8 Max"),
		);
	});
});

describe("displayName", () => {
	test("drops parentheticals and boundaries", () => {
		expect(displayName("DeepSeek V4.1 Flash (Off-Peak)")).toBe(
			"DeepSeek V4.1 Flash",
		);
		expect(displayName(`Kimi K3${BOUNDARY}`)).toBe("Kimi K3");
	});
});
