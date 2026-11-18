import type { OdModel } from "./models.ts";

/**
 * Top Model Credits: Plus and up, no 7-day or 5-hour window. Image models on
 * the same page (Seedream, Nano Banana, GPT Image) have no token rate to compare
 * against, so they stay out. Multiplier 1 means charged at model value.
 */
export const OD_TOP_MODELS: OdModel[] = [
	{
		name: "GPT-6 Astra",
		id: "gpt-6-astra",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Claude Fable 5.2",
		id: "claude-fable-5.2",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Claude Fable 5.1",
		id: "claude-fable-5.1",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Claude Opus 5.5",
		id: "claude-opus-5.5",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "GPT-6 Sol",
		id: "gpt-6-sol",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "GPT-6.1 Terra",
		id: "gpt-6.1-terra",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Kimi K3.1 Pro",
		id: "kimi-k3.1-pro",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Muse Ember",
		id: "muse-ember-1.0",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Muse Spark 1.3",
		id: "muse-spark-1.3",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Gemini 4 Argon",
		id: "gemini-4-argon",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Kimi K3",
		id: "kimi-k3",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Grok 4.7",
		id: "grok-4.7",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Gemini 3.8 Flash",
		id: "gemini-3.8-flash",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Claude Sonnet 5.5",
		id: "claude-sonnet-5.5",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
	{
		name: "Muse Wonder",
		id: "muse-wonder",
		multiplier: 1,
		tier: "top",
		plans: ["plus", "pro", "max"],
	},
];
