/**
 * Marks a text-node boundary inside a scraped cell, so "$60" + "4x" stays two
 * tokens instead of collapsing into an ambiguous "$604x".
 */
export const BOUNDARY = "\u0001";

/**
 * Canonical keys that differ only by vendor/branding between the two catalogs.
 * Keys are already lowercased and stripped of punctuation; map the variant onto
 * the shared canonical form. Applied after normalizeKey's base cleaning.
 */
export const ALIASES: Record<string, string> = {
	// CommandCode prefixes these with "Tencent"; OpenCode Go does not.
	tencenthy3: "hy3",
	tencenthy4preview: "hy4preview",
	// AA's slug keeps the vendor the catalogs drop: "tencent-hy4", "reflection-beam".
	tencenthy4: "hy4",
	reflectionbeam: "beam10",
	// OpenCode's "Beam Free" is the same model CommandCode sells as "Beam 1.0";
	// the trailing "Free" is stripped generically, so the bare key is what lands here.
	beam: "beam10",
	// AA suffixes the bake date onto the slug: "mimo-v2-5-0424".
	mimov250424: "mimov25",
	// CommandCode lists the same Jev build twice, once with its version suffix.
	jev1140: "jev",
	// CommandCode writes "(exp)"; OpenCode Go writes "-exp".
	deepseekv4flashvision: "deepseekv4flashvisionexp",
	// Alibaba's "Qwen3.8-Flash-Next" is the release name of the model
	// CommandCode lists as "Qwen 3.8 Flash": same creator, same $0.47 output
	// price and release window, CommandCode has no "Next" row, and Artificial
	// Analysis has no plain "Flash" one. Without this the row has no ability or
	// speed at all, since neither index scores it under the marketing name.
	qwen38flashnext: "qwen38flash",
	// CommandCode's own blurb calls these "Muse Spark 1.2/1.3 at ~95% off": the
	// same model in a discounted contributor tier, so it shares the base ability.
	// Both have an id/price of their own and neither has a separate AA score.
	musespark12contributor: "musespark12",
	musespark13contributor: "musespark13",
	// OpenCode prefixes the vendor; CommandCode's slug is bare. Same model, both
	// currently unscored, but one key must not split it in two.
	tencenthy4flash: "hy4flash",
};

/** The monthly-limit cell of a free model: "Unlimited", often with a note. */
export const UNLIMITED = /\bunlimited\b/i;

/** The chip text of a promotion: "-40%", "-98%", "Free", "2x usage". */
export const BADGE = /^-?\d+(?:\.\d+)?%$|^free$|^\d+x(?:\s+usage)?$/i;

/** How CommandCode prints the deal's window beside the chip. */
export const ENDS = /^(?:ends|through|until)\b/i;
