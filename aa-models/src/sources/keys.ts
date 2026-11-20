/**
 * Canonical keys a model may be matched by.
 *
 * Ported from mpc's `src/keys.ts` (which is the working implementation), minus the
 * scraped-cell boundary marker: nothing here reads HTML text nodes.
 */

/**
 * Canonical keys that differ only by vendor/branding between AA and the sibling
 * catalogues. Applied after the base cleaning, so a consumer's own key resolves
 * against an AA model listed under a different spelling.
 */
const ALIASES: Record<string, string> = {
	// CommandCode prefixes these with "Tencent"; the others do not.
	tencenthy3: "hy3",
	tencenthy4preview: "hy4preview",
	// AA's slug keeps the vendor the catalogues drop: "tencent-hy4", "reflection-beam".
	tencenthy4: "hy4",
	reflectionbeam: "beam10",
	// "Beam Free" is the same model CommandCode sells as "Beam 1.0".
	beam: "beam10",
	// AA suffixes the bake date onto the slug: "mimo-v2-5-0424".
	mimov250424: "mimov25",
	// The same Jev build listed twice, once with its version suffix.
	jev1140: "jev",
	// CommandCode writes "(exp)"; OpenCode Go writes "-exp".
	deepseekv4flashvision: "deepseekv4flashvisionexp",
	// Alibaba's "Qwen3.8-Flash-Next" is CommandCode's "Qwen 3.8 Flash".
	qwen38flashnext: "qwen38flash",
	// "Muse Spark 1.2/1.3 Contributor" are ~95%-off tiers of the same model.
	musespark12contributor: "musespark12",
	musespark13contributor: "musespark13",
	tencenthy4flash: "hy4flash",
};

/**
 * Collapse a model name onto a shared key.
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
	// A trailing "Free" is a docs marker, not part of any model's name.
	s = s.replace(/[\s_-]+free\s*$/i, " ");
	s = s.replace(/[^a-z0-9]+/g, "");
	return ALIASES[s] ?? s;
}

/**
 * Keys an Artificial Analysis row may answer to. AA writes the bake date and the
 * effort variant into the slug itself (`deepseek-v4-1-flash-1017-high`) while a
 * consumer names the model bare (`DeepSeek V4.1 Flash`), so the exact key never
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
		.replace(/\([^)]*\)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
