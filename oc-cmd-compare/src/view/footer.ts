import { LEGEND } from "#~/view/text/help.ts";
import { PROVIDER_COLOR, SGR } from "#~/constants/view.ts";
import type { CompareRow, PlanInfo, SideId, Workload } from "#~/types.ts";
import { tally } from "./layout/segments.ts";
import type { ReportMeta } from "./schema.ts";
import { paint, planTitle, providerName, shortProviderName } from "./text/index.ts";

/** One side's per-request token vector; fields with no measured signal stay out. */
function shapeText(workload: Workload): string {
	const parts = [
		`${workload.input.toLocaleString("en-US")} input`,
		`${workload.cacheRead.toLocaleString("en-US")} cache-read`,
		`${workload.output.toLocaleString("en-US")} output`,
	];
	if (workload.reasoning > 0) {
		parts.push(`${workload.reasoning.toLocaleString("en-US")} reasoning`);
	}
	if (workload.cacheWrite > 0) {
		parts.push(`${workload.cacheWrite.toLocaleString("en-US")} cache-write`);
	}
	return parts.join(" · ");
}

function planBlock(plan: PlanInfo): { title: string; rest: string } {
	if (plan.provider === "oc-go") {
		// Per-model limits, no shared pool, so the sum is only an upper bound.
		return {
			title: planTitle(plan),
			rest: `$${plan.price}/mo · per-model limits (sum $${plan.credits})`,
		};
	}
	const window =
		plan.fiveHour !== null && plan.weekly !== null
			? ` · 5h $${plan.fiveHour} / wk $${plan.weekly}`
			: plan.weekly !== null
				? ` · wk $${plan.weekly}`
				: "";
	const pool = plan.provider === "od" ? "combined credits" : "credits";
	return {
		title: planTitle(plan),
		rest: `$${plan.price}/mo · $${plan.credits} ${pool}${window}`,
	};
}

function windowPercents(plan: PlanInfo, override?: [number, number]): string {
	if (override) {
		return `${Math.round(override[0] * 100)}% / ${Math.round(override[1] * 100)}%`;
	}
	if (plan.provider === "oc-go") return "20% / 50%";
	if (plan.credits <= 0) return "—";
	const five =
		plan.fiveHour === null ? "—" : `${Math.round((plan.fiveHour / plan.credits) * 100)}%`;
	const week = plan.weekly === null ? "—" : `${Math.round((plan.weekly / plan.credits) * 100)}%`;
	return `${five} / ${week}`;
}

export function footer(rows: CompareRow[], meta: ReportMeta): void {
	// A key/value list: labels bold, values plain. It used to be SGR 2 end to
	// end, which made every label as faint as its value and read as one grey
	// block (the shape decision among it).
	const label = (text: string): string => paint(SGR.bold, text.padEnd(10));
	const line = (key: string, text: string): void => console.log(`${label(key)}${text}`);
	const sides: PlanInfo[] = [meta.ocPlan, meta.ccPlan];
	if (meta.odPlan) sides.push(meta.odPlan);
	const plans = sides.map(planBlock);
	const planWidth = Math.max(...plans.map((p) => p.title.length));

	// A measured shape is one profile for every plan, so this reads as a single
	// line; a second is printed only if the sides ever diverge.
	const ocWorkload = meta.workloads["oc-go"];
	const ccWorkload = meta.workloads.cc;
	const odWorkload = meta.workloads.od;
	const odDiverges =
		odWorkload !== undefined && JSON.stringify(odWorkload) !== JSON.stringify(ocWorkload);
	const perSide =
		ccWorkload === undefined || JSON.stringify(ocWorkload) !== JSON.stringify(ccWorkload);
	if (ocWorkload) {
		line(
			"workload",
			`${perSide ? `${shortProviderName("oc-go")} ` : ""}${shapeText(ocWorkload)} tokens per request`,
		);
		if (perSide && ccWorkload) {
			line("", `${shortProviderName("cc")} ${shapeText(ccWorkload)} tokens per request`);
		}
		if (odDiverges && odWorkload) {
			line("", `${shortProviderName("od")} ${shapeText(odWorkload)} tokens per request`);
		}
	}
	if (meta.shapeNote) line("shape", meta.shapeNote);

	sides.forEach((plan, i) => {
		const block = plans[i];
		console.log(
			`${label(i === 0 ? "plans" : "")}${paint(PROVIDER_COLOR[plan.provider as SideId], (block?.title ?? "").padEnd(planWidth))}  ${block?.rest ?? ""}`,
		);
	});
	line(
		"windows",
		`rolling caps as % of monthly allowance: ${sides
			.map((plan) => `${planTitle(plan)} ${windowPercents(plan, meta.window)}`)
			.join(" · ")}`,
	);
	if (meta.odPlan) {
		line(
			"od source",
			"open-design.ai/pricing · Go/Plus allowance = published per-model cap (Pro/Max = credits ÷ multiplier) · 7-day window starts at the subscription, not Monday",
		);
	}
	if (meta.abilityLabel) {
		line("ability", `${meta.abilityLabel}${meta.abilityNote ? ` · ${meta.abilityNote}` : ""}`);
	}

	const t = tally(rows);
	const parts = [`${providerName("oc-go")} ${t.ocWins}`, `${providerName("cc")} ${t.ccWins}`];
	if (meta.odPlan) parts.push(`${providerName("od")} ${t.odWins}`);
	if (t.ties > 0) parts.push(`tie ${t.ties}`);
	line("wins", `head-to-head ${t.headToHead} shared: ${parts.join(" · ")}`);
	const exclusive = [`${providerName("oc-go")} ${t.ocOnly}`, `${providerName("cc")} ${t.ccOnly}`];
	if (meta.odPlan) exclusive.push(`${providerName("od")} ${t.odOnly}`);
	line("", `exclusive: ${exclusive.join(" · ")}`);

	LEGEND.forEach(([key, text], i) => {
		if (key === "OD" && !meta.odPlan) return;
		line(i === 0 ? "legend" : "", `${paint(SGR.bold, (key ?? "").padEnd(9))}${text}`);
	});
}
