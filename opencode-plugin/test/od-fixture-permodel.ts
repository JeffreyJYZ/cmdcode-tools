import { odSnapshot } from "./od-fixture";

/**
 * The same snapshot with the **per-model** cap shape `oduse` is adopting: one
 * allowance per model class, keyed by the model id the store records, plus a
 * `defaultCaps` fallback for a model the table does not name.
 *
 * Go publishes two sets — `$120/$30/$10` on DeepSeek V4.1 Flash and
 * `$220/$55/$18` on Flash Eco — so this fixture is the case that matters: the
 * panel must divide each row by its own model's allowance, and a window holding
 * both must fall under the stricter (Flash) set and say so.
 */
export function odSnapshotPerModel(): string {
	const body = JSON.parse(odSnapshot()) as Record<string, unknown>;
	body.caps = {
		defaultCaps: { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
		caps: {
			"deepseek-v4.1-flash": { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
			"deepseek-v4.1-flash-eco": { month: 220, week: 55, fiveHour: 18, label: "Eco caps" },
			"glm-5.3-flash": { month: 120, week: 30, fiveHour: 10, label: "Flash caps" },
		},
		planModelCreditsUsd: 0,
	};
	return JSON.stringify(body);
}

/** The same snapshot with one window carrying **both** DeepSeek models: the
 *  strictest cap set has to win and the looser one has to be named as the
 *  alternative, never silently dropped. */
export function odSnapshotMixed(): string {
	const body = JSON.parse(odSnapshotPerModel()) as Record<string, unknown>;
	body.models = [
		{
			id: "deepseek-v4.1-flash",
			multiplier: 0.5,
			priced: true,
			month: { requests: 200, credits: 88, costUsd: 176, tokensIn: 1, tokensOut: 2 },
			fiveHour: { requests: 10, credits: 4, costUsd: 8, tokensIn: 1, tokensOut: 2 },
			weekly: { requests: 50, credits: 8, costUsd: 16, tokensIn: 1, tokensOut: 2 },
		},
		{
			id: "deepseek-v4.1-flash-eco",
			multiplier: 0.27,
			priced: true,
			month: { requests: 31, credits: 10.4, costUsd: 38.5, tokensIn: 1, tokensOut: 2 },
			fiveHour: { requests: 2, credits: 0.2, costUsd: 0.74, tokensIn: 1, tokensOut: 2 },
			weekly: { requests: 8, credits: 1.1, costUsd: 4.07, tokensIn: 1, tokensOut: 2 },
		},
	];
	return JSON.stringify(body);
}
