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
	// OpenCode's docs append a "Free" marker to every free model ("Step 5
	// Preview Free"); the other catalog omits it. That marker is systematic, not
	// per-model branding, so strip one trailing occurrence here — never add
	// per-model ALIASES entries for it. Trailing only: "Freestyle" or "Free Tier
	// X" keeps its token.
	s = s.replace(/[\s_-]+free\s*$/i, " ");
	s = s.replace(/[^a-z0-9]+/g, "");
	return ALIASES[s] ?? s;
}

/**
 * Keys an Artificial Analysis row may answer to. AA writes the bake date and the
 * effort variant into the slug itself (`deepseek-v4-1-flash-1017-high`) while the
 * catalogs name the model bare (`DeepSeek V4.1 Flash`), so the exact key never
 * matches and a scored model reads as unscored.
 *
 * The strippings only run when a 3-4 digit bake date is present: without that
 * anchor they would eat a real name token (`Qwen3.8-Max` -> `qwen38`).
 */
export function aaKeyVariants(name: string): string[] {
	const out = [normalizeKey(name)];
	const dated = /[\s_-]+\d{3,4}(?:$|[\s_-])/i.test(name);
	if (!dated) return out;
	const noDate = name.replace(/[\s_-]+\d{3,4}(?=$|[\s_-])/i, "");
	for (const candidate of [
		noDate,
		noDate.replace(
			/[\s_-]+(?:non[\s_-]*reasoning|reasoning|minimal|medium|xhigh|high|low|max)$/i,
			"",
		),
	]) {
		const key = normalizeKey(candidate);
		if (!out.includes(key)) out.push(key);
	}
	return out;
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
