export interface OdModel {
	/** Name OpenDesign prints on /pricing and /model-credits. */
	name: string;
	/** Credits consumed per dollar of token usage. */
	multiplier: number;
	/** `coding` draws Coding Plan credits; `top` draws Top Model Credits. */
	tier: "coding" | "top";
	/** Plans that include the model; absent means every plan. */
	plans?: string[];
	/** Catalog key to price it from when it has no row of its own. */
	priceKey?: string;
}

/**
 * Multipliers from open-design.ai/model-credits (the page's Go tab, checked
 * 2026-11-16). The sources disagree on one row and only that row: /model-credits
 * says Claude Haiku 5.5 2x, /help/billing says 4x (GPT-6 Luna is 4x on both,
 * GLM-5.3 Flash-X 2x on both). This table holds 4x for Haiku 5.5, matching
 * /help/billing; which page wins is the owner's call, do not flip it unasked.
 * A top-model row has no multiplier — Top Model Credits are charged at model
 * value directly.
 */
export const OD_MODELS: OdModel[] = [
	{ name: "DeepSeek V4.1 Flash", multiplier: 0.5, tier: "coding" },
	{
		name: "DeepSeek V4.1 Flash Eco",
		multiplier: 0.27,
		tier: "coding",
		plans: ["go", "plus"],
		// Eco is the same model on a cheaper credit multiplier and its published
		// usage value per request matches V4.1 Flash to the cent, so it is priced
		// from that catalog row rather than given invented rates.
		priceKey: "deepseekv41flash",
	},
	{ name: "MiniMax M3.1 Flash", multiplier: 1, tier: "coding" },
	{ name: "MiMo V2.6 Flash", multiplier: 1, tier: "coding" },
	{ name: "MiMo V2.6 Pro", multiplier: 1, tier: "coding" },
	{ name: "Hy4 Preview", multiplier: 1, tier: "coding" },
	{ name: "DeepSeek V4 Flash", multiplier: 1, tier: "coding" },
	{ name: "DeepSeek V4 Flash Vision Exp", multiplier: 1, tier: "coding" },
	{ name: "DeepSeek V4 Pro", multiplier: 1, tier: "coding" },
	{ name: "GLM-5.3 Flash", multiplier: 1, tier: "coding" },
	{ name: "Kimi K2.7 Code", multiplier: 1, tier: "coding" },
	{ name: "GLM-5.3 Flash-X", multiplier: 2, tier: "coding" },
	{ name: "Claude Haiku 5.5", multiplier: 4, tier: "coding" },
	{ name: "GPT-6 Luna", multiplier: 4, tier: "coding" },
	// Top Model Credits: Plus and up, no 7-day or 5-hour window. Image models
	// on the same page (Seedream, Nano Banana, GPT Image) have no token rate to
	// compare against, so they stay out.
	{ name: "GPT-6 Astra", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Claude Fable 5.2", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Claude Fable 5.1", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Claude Opus 5.5", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "GPT-6 Sol", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "GPT-6.1 Terra", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Kimi K3.1 Pro", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Muse Ember", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Muse Spark 1.3", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Gemini 4 Argon", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Kimi K3", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Grok 4.7", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Gemini 3.8 Flash", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Claude Sonnet 5.5", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
	{ name: "Muse Wonder", multiplier: 1, tier: "top", plans: ["plus", "pro", "max"] },
];
