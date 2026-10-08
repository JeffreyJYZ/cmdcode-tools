import { LEGEND, PROVIDER_COLOR, SGR } from "~/constants/view.ts";
import type { CompareRow, PlanInfo, Workload } from "~/types.ts";
import { tally } from "./layout/segments.ts";
import type { ReportMeta } from "./schema.ts";
import {
	paint,
	planTitle,
	providerName,
	shortProviderName,
} from "./text/index.ts";

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
		parts.push(
			`${workload.cacheWrite.toLocaleString("en-US")} cache-write`,
		);
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
			: "";
	return {
		title: planTitle(plan),
		rest: `$${plan.price}/mo · $${plan.credits} credits${window}`,
	};
}

function windowPercents(plan: PlanInfo, override?: [number, number]): string {
	if (override) {
		return `${Math.round(override[0] * 100)}% / ${Math.round(override[1] * 100)}%`;
	}
	if (plan.provider === "oc-go") return "20% / 50%";
	if (plan.fiveHour !== null && plan.weekly !== null && plan.credits > 0) {
		return `${Math.round((plan.fiveHour / plan.credits) * 100)}% / ${Math.round(
			(plan.weekly / plan.credits) * 100,
		)}%`;
	}
	return "—";
}

export function footer(rows: CompareRow[], meta: ReportMeta): void {
	// A key/value list: labels bold, values plain. It used to be SGR 2 end to
	// end, which made every label as faint as its value and read as one grey
	// block (the shape decision among it).
	const label = (text: string): string => paint(SGR.bold, text.padEnd(10));
	const line = (key: string, text: string): void =>
		console.log(`${label(key)}${text}`);
	const plans = [meta.ocPlan, meta.ccPlan].map(planBlock);
	const planWidth = Math.max(...plans.map((p) => p.title.length));
	const [ocBlock, ccBlock] = plans;

	// A measured shape is one profile for both plans, so this reads as a single
	// line; a second is printed only if the two sides ever diverge.
	const ocWorkload = meta.workloads["oc-go"];
	const ccWorkload = meta.workloads.cc;
	const perSide = JSON.stringify(ocWorkload) !== JSON.stringify(ccWorkload);
	line(
		"workload",
		`${perSide ? `${shortProviderName("oc-go")} ` : ""}${shapeText(ocWorkload)} tokens per request`,
	);
	if (perSide) {
		line(
			"",
			`${shortProviderName("cc")} ${shapeText(ccWorkload)} tokens per request`,
		);
	}
	if (meta.shapeNote) line("shape", meta.shapeNote);

	console.log(
		`${label("plans")}${paint(PROVIDER_COLOR["oc-go"], (ocBlock?.title ?? "").padEnd(planWidth))}  ${ocBlock?.rest ?? ""}`,
	);
	console.log(
		`${label("")}${paint(PROVIDER_COLOR.cc, (ccBlock?.title ?? "").padEnd(planWidth))}  ${ccBlock?.rest ?? ""}`,
	);
	line(
		"windows",
		`rolling caps as % of monthly allowance: ${planTitle(meta.ocPlan)} ${windowPercents(meta.ocPlan, meta.window)} · ${planTitle(meta.ccPlan)} ${windowPercents(meta.ccPlan, meta.window)}`,
	);
	if (meta.abilityLabel) {
		line(
			"ability",
			`${meta.abilityLabel}${meta.abilityNote ? ` · ${meta.abilityNote}` : ""}`,
		);
	}

	const t = tally(rows);
	const parts = [
		`${providerName("oc-go")} ${t.ocWins}`,
		`${providerName("cc")} ${t.ccWins}`,
	];
	if (t.ties > 0) parts.push(`tie ${t.ties}`);
	line("wins", `head-to-head ${t.headToHead} shared: ${parts.join(" · ")}`);
	line(
		"",
		`exclusive: ${providerName("oc-go")} ${t.ocOnly} · ${providerName("cc")} ${t.ccOnly}`,
	);

	LEGEND.forEach(([key, text], i) => {
		line(
			i === 0 ? "legend" : "",
			`${paint(SGR.bold, (key ?? "").padEnd(9))}${text}`,
		);
	});
}
