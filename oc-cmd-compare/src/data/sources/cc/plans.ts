import { CC_PLANS } from "#~/constants/sources.ts";
import type { PlanInfo } from "#~/types.ts";
import { cmdusePlans, money } from "./cmduse.ts";

/** Plan price + windows for a CommandCode plan, from the official JSON. */
export async function loadCcPlan(planId: string): Promise<PlanInfo> {
	const def = CC_PLANS[planId];
	if (!def) {
		throw new Error(
			`unknown CommandCode plan "${planId}" (have: ${Object.keys(CC_PLANS).join(", ")})`,
		);
	}
	const plans = await cmdusePlans();
	const match = plans.find((p) => p.name === def.cmduse);
	if (!match) {
		throw new Error(
			`cmduse plans --json has no plan named "${def.cmduse}"`,
		);
	}
	return {
		provider: "cc",
		id: planId,
		label: def.label,
		price: money(match.price) ?? 0,
		credits: money(match.creditsMonthly) ?? 0,
		fiveHour: money(match.fiveHour),
		weekly: money(match.weekly),
	};
}
