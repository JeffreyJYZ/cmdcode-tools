import { ALIASES, BOUNDARY } from "#~/constants/data.ts";

/**
 * Collapse a model name from either catalog onto a shared key.
 *
 * "deepseek/deepseek-v4.1-flash" -> "deepseekv41flash"
 * "DeepSeek V4.1 Flash (Off-Peak)" -> "deepseekv41flash"
 * "Qwen/Qwen3.8-Max" -> "qwen38max"
 */
export function normalizeKey(name: string): string {
	let s = name.trim().toLowerCase();
	// Drop parenthetical qualifiers: (Off-Peak), (> 256K tokens), (latest), (exp).
	s = s.replace(/\([^)]*\)/g, " ");
	// Drop a vendor prefix like "deepseek/", "z-ai/", "opencode-go/".
	const parts = s.split("/");
	s = parts[parts.length - 1] ?? s;
	s = s.replace(/[^a-z0-9]+/g, "");
	return ALIASES[s] ?? s;
}

/** Display name: strip parentheticals and collapse whitespace. */
export function displayName(name: string): string {
	return name
		.split(BOUNDARY)
		.join(" ")
		.replace(/\([^)]*\)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
