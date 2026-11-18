import { OD_TOP_MODELS } from "./topModels.ts";

export interface OdModel {
	/** Name OpenDesign prints on /pricing and /model-credits. */
	name: string;
	/** Gateway wire id, keying the published row in core/od.json. */
	id: string;
	/** Fallback multiplier when core/od.json has no row (it always publishes one). */
	multiplier: number;
	/** `coding` draws Coding Plan credits; `top` draws Top Model Credits. */
	tier: "coding" | "top";
	/** Plans that include the model; absent means every plan. */
	plans?: string[];
}

/**
 * Models OpenDesign publishes, keyed by the wire id that keys `core/od.json`.
 *
 * Rates AND multipliers come from that published row at runtime, not from here.
 * `multiplier` is only the fallback for a model with no row in core/od.json —
 * today every model here has one. The one unresolved source conflict is Claude
 * Haiku 5.5: /model-credits says 2x, /help/billing 4x. core/od.json carries the
 * 2x figure and wins because it is the declared source of truth; the 4x here is
 * the fallback only, never shown while the published row exists.
 */
export const OD_MODELS: OdModel[] = [
	{ name: "DeepSeek V4.1 Flash", id: "deepseek-v4.1-flash", multiplier: 0.5, tier: "coding" },
	{
		name: "DeepSeek V4.1 Flash Eco",
		id: "deepseek-v4.1-flash-eco",
		multiplier: 0.27,
		tier: "coding",
		plans: ["go", "plus"],
	},
	{ name: "MiniMax M3.1 Flash", id: "minimax-m3.1-flash", multiplier: 1, tier: "coding" },
	{ name: "MiMo V2.6 Flash", id: "mimo-v2.6-flash", multiplier: 1, tier: "coding" },
	{ name: "MiMo V2.6 Pro", id: "mimo-v2.6-pro", multiplier: 1, tier: "coding" },
	{ name: "Hy4 Preview", id: "hy4-preview", multiplier: 1, tier: "coding" },
	{ name: "DeepSeek V4 Flash", id: "deepseek-v4-flash", multiplier: 1, tier: "coding" },
	{
		name: "DeepSeek V4 Flash Vision Exp",
		id: "deepseek-v4-flash-vision-exp",
		multiplier: 1,
		tier: "coding",
	},
	{ name: "DeepSeek V4 Pro", id: "deepseek-v4-pro", multiplier: 1, tier: "coding" },
	{ name: "GLM-5.3 Flash", id: "glm-5.3-flash", multiplier: 1, tier: "coding" },
	{ name: "Kimi K2.7 Code", id: "kimi-k2.7-code", multiplier: 1, tier: "coding" },
	{ name: "GLM-5.3 Flash-X", id: "glm-5.3-flashx", multiplier: 2, tier: "coding" },
	{ name: "Claude Haiku 5.5", id: "claude-haiku-5.5", multiplier: 4, tier: "coding" },
	{ name: "GPT-6 Luna", id: "gpt-6-luna", multiplier: 4, tier: "coding" },
	...OD_TOP_MODELS,
];
