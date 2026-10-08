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
	// CommandCode writes "(exp)"; OpenCode Go writes "-exp".
	deepseekv4flashvision: "deepseekv4flashvisionexp",
	// Alibaba's "Qwen3.8-Flash-Next" is the release name of the model
	// CommandCode lists as "Qwen 3.8 Flash": same creator, same $0.47 output
	// price and release window, CommandCode has no "Next" row, and Artificial
	// Analysis has no plain "Flash" one. Without this the row has no ability or
	// speed at all, since neither index scores it under the marketing name.
	qwen38flashnext: "qwen38flash",
};

/** The chip text of a promotion: "-40%", "-98%", "Free", "2x usage". */
export const BADGE = /^-?\d+(?:\.\d+)?%$|^free$|^\d+x(?:\s+usage)?$/i;

/** How CommandCode prints the deal's window beside the chip. */
export const ENDS = /^(?:ends|through|until)\b/i;
