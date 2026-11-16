/**
 * A snapshot in `oduse -1 --json`'s shape
 * (`cmduse/src/oduse/render/json.rs`): Go plan, one answered wallet, two priced
 * models. Shared by the parse and row tests so the two cannot drift apart, and
 * built relative to now so the countdowns and elapsed shares are real.
 */
export function odSnapshot(): string {
	const now = Date.now();
	return JSON.stringify({
		source: "open-design",
		generatedAt: now,
		plan: "go",
		caps: {
			monthlyUsd: 220,
			weeklyUsd: 55,
			fiveHourUsd: 18,
			planModelCreditsUsd: 0,
		},
		periodStart: now - 10 * 86_400_000,
		periodStartAt: now - 10 * 86_400_000,
		periodEndAt: now + 20 * 86_400_000,
		periodEnd: "2027-01-01",
		periodInferred: false,
		summary: {
			requests: 231,
			tokensIn: 936_500,
			tokensOut: 118_500,
			costUsd: 196.8,
			credits: 98.4,
		},
		totals: {
			month: {
				requests: 231,
				tokensIn: 936_500,
				tokensOut: 118_500,
				costUsd: 196.8,
				credits: 98.4,
			},
			fiveHour: {
				requests: 12,
				tokensIn: 40_000,
				tokensOut: 5_000,
				costUsd: 8.4,
				credits: 4.2,
			},
			weekly: {
				requests: 58,
				tokensIn: 200_000,
				tokensOut: 25_000,
				costUsd: 18.2,
				credits: 9.1,
			},
		},
		wallet: {
			balanceUsd: 18.4,
			source: "vela",
			profile: "default",
			user: "jyz",
			stale: false,
		},
		walletError: null,
		models: [
			{
				id: "deepseek-v4.1-flash",
				multiplier: 0.5,
				priced: true,
				month: { requests: 200, credits: 88, costUsd: 176, tokensIn: 1, tokensOut: 2 },
				fiveHour: { requests: 10, credits: 4, costUsd: 8, tokensIn: 1, tokensOut: 2 },
				weekly: { requests: 50, credits: 8, costUsd: 16, tokensIn: 1, tokensOut: 2 },
			},
			{
				id: "glm-5.3-flash",
				multiplier: 1,
				priced: true,
				month: {
					requests: 31,
					credits: 10.4,
					costUsd: 10.4,
					tokensIn: 1,
					tokensOut: 2,
				},
				fiveHour: { requests: 2, credits: 0.2, costUsd: 0.2, tokensIn: 1, tokensOut: 2 },
				weekly: { requests: 8, credits: 1.1, costUsd: 1.1, tokensIn: 1, tokensOut: 2 },
			},
		],
	});
}
