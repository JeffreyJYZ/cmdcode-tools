import type { ColorMode } from "#~/cli/options.ts";
import type { Bag } from "./validate.ts";

/** Comma-separated or repeated flag, read as numbers. */
export function numbers(bag: Bag, key: string): number[] | undefined {
	const value = bag[key];
	if (value === undefined || value === false) return undefined;
	const parts = Array.isArray(value) ? value : String(value).split(",");
	const nums = parts.map((part) => Number(part));
	if (nums.some((n) => !Number.isFinite(n))) {
		throw new Error(
			`--${key} expects comma-separated numbers, got "${value}"`,
		);
	}
	return nums;
}

/** Comma-separated or repeated flag, read as trimmed words. */
export function words(bag: Bag, key: string): string[] {
	const value = bag[key];
	if (value === undefined || value === false) return [];
	const parts = Array.isArray(value) ? value : String(value).split(",");
	return parts.map((part) => String(part).trim()).filter(Boolean);
}

/** Named column presets from config: name -> column ids. */
export function presets(bag: Bag): Record<string, string[]> {
	const value = bag.presets;
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string[]> = {};
	for (const [name, ids] of Object.entries(
		value as Record<string, unknown>,
	)) {
		out[name] = Array.isArray(ids)
			? ids.map((id) => String(id).trim())
			: String(ids)
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean);
	}
	return out;
}

export function usageWindow(value: unknown): "period" | "all" | `${number}d` {
	if (value === "all") return "all";
	if (typeof value === "string" && /^\d+d$/.test(value)) {
		return value as `${number}d`;
	}
	return "period";
}

export function colorMode(value: unknown): ColorMode {
	if (value === false || value === "never") return "never";
	if (value === "always") return "always";
	return "auto";
}

/** A two-number pair, e.g. window ratios or colour thresholds. */
export function pair(value: unknown, name: string): [number, number] {
	const nums = numbers({ v: value }, "v");
	if (nums?.length !== 2) {
		throw new Error(`--${name} expects two comma-separated numbers`);
	}
	return [nums[0] ?? 0, nums[1] ?? 0];
}
