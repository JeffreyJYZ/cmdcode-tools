import type { Model } from "#~/model.ts";

/** Build a record with contract defaults, so a test names only what it exercises. */
export function mk(over: Partial<Model> & { slug: string; name: string }): Model {
	return {
		shortName: null,
		creator: null,
		release: { slug: null, name: null, date: null },
		keys: [over.slug, over.name],
		intelligenceIndex: null,
		outputSpeed: null,
		latency: null,
		contextWindow: null,
		maxOutputTokens: null,
		price: null,
		openWeights: null,
		modalities: { input: ["text"], output: ["text"] },
		reasoning: { supported: null, efforts: [] },
		evals: {},
		variants: [],
		sources: ["manifest"],
		...over,
	};
}

/**
 * Five rows covering every branch the view code has: a full record, a 1M context,
 * an unscored model, a null everything model and a null-vs-true open-weights model.
 */
export const FIXTURE: Model[] = [
	mk({
		slug: "gpt-6",
		name: "GPT-6",
		creator: "OpenAI",
		release: { slug: "gpt-6", name: "GPT-6", date: "2026-09-01" },
		intelligenceIndex: 72.4,
		outputSpeed: 180.2,
		latency: 0.42,
		contextWindow: 200000,
		maxOutputTokens: 32000,
		price: { input: 2.5, output: 10, blended: 6.25 },
		openWeights: false,
		reasoning: { supported: true, efforts: ["low", "high"] },
	}),
	mk({
		slug: "claude-opus-5",
		name: "Claude Opus 5",
		creator: "Anthropic",
		release: { slug: "claude-opus-5", name: "Claude Opus 5", date: "2026-06-15" },
		intelligenceIndex: 68,
		outputSpeed: 95.4,
		contextWindow: 1000000,
		price: { input: 15, output: 75, blended: 45 },
		openWeights: false,
	}),
	mk({
		slug: "deepseek-v4-1-flash",
		name: "DeepSeek V4.1 Flash",
		creator: "DeepSeek",
		release: { slug: "deepseek-v4-1-flash", name: "DeepSeek V4.1 Flash", date: "2026-10-17" },
		outputSpeed: 120.5,
		contextWindow: 128000,
		price: { input: 0.15, output: 0.6, blended: 0.375 },
		openWeights: true,
		reasoning: { supported: true, efforts: ["low", "high"] },
	}),
	mk({ slug: "mystery-1", name: "Mystery 1", intelligenceIndex: 40.5 }),
	mk({
		slug: "acme-mini",
		name: "Acme Mini",
		creator: "OpenAI",
		intelligenceIndex: 40.5,
		outputSpeed: 12,
		contextWindow: 32000,
		price: { input: 0.05, output: 0.1, blended: 0.075 },
	}),
];

/** Remove SGR sequences without a control-char regex (Biome forbids those). */
export function stripSgr(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "\x1b") {
			const end = text.indexOf("m", i);
			if (end > i) {
				i = end;
				continue;
			}
		}
		out += char;
	}
	return out;
}
