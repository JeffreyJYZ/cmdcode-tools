"use client";

/**
 * Interactive model comparison table for the `/compare` page.
 *
 * Receives the build-time mpc snapshot as a prop (the page is a server
 * component) and lets the reader switch CommandCode plan, filter models, and
 * sort by requests/month, dollars/request or ability. All pricing comes from
 * the snapshot — nothing is fetched at runtime.
 */

import { useMemo, useState } from "react";
import {
	type CompareRow,
	compareRows,
	DASH,
	formatAbility,
	formatCost,
	type MpcSnapshot,
} from "@/lib/mpc";

type Metric = "req" | "cost" | "ability";
type Side = "oc" | "cc";

const METRICS: { id: Metric; label: string; better: "higher" | "lower" }[] = [
	{ id: "req", label: "req / mo", better: "higher" },
	{ id: "cost", label: "$ / req", better: "lower" },
	{ id: "ability", label: "ability", better: "higher" },
];

const DEFAULT_METRIC: Metric = "req";
/** mpc's own default plan — a sensible landing view. */
const PREFERRED_PLAN = "goat";

const LABEL = "ink-muted text-xs uppercase tracking-widest";
const PILL =
	"mono rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]";
const PILL_ON = "border-[var(--accent)] text-[var(--fg)]";
const PILL_OFF =
	"border-[var(--hairline)] ink-muted hover:border-[var(--accent)] hover:text-[var(--fg)]";
const TH = "px-4 py-2.5 text-right font-medium";
const TH_FIRST = "px-4 py-2.5 text-left font-medium";
const TD = "px-4 py-2 text-right mono tabular-nums";

/** Numeric sort value for a side; `null` when the model is unpriced there. */
function metricValue(
	row: CompareRow,
	side: Side,
	metric: Metric,
): number | null {
	const s = row[side];
	if (!s) return null;
	if (metric === "req") {
		// A free model is unbounded, so it tops a descending req/mo sort.
		return s.requestsPerMonth === null
			? Number.POSITIVE_INFINITY
			: s.requestsPerMonth;
	}
	if (metric === "cost") return s.costPerRequest;
	return s.ability;
}

/** Display string for a side under the current metric — never NaN/undefined. */
function metricDisplay(row: CompareRow, side: Side, metric: Metric): string {
	if (metric === "req") return side === "cc" ? row.ccLabel : row.ocLabel;
	const s = row[side];
	return metric === "cost"
		? formatCost(s?.costPerRequest)
		: formatAbility(s?.ability);
}

function winner(
	row: CompareRow,
	metric: Metric,
	better: "higher" | "lower",
): Side | null {
	const ov = metricValue(row, "oc", metric);
	const cv = metricValue(row, "cc", metric);
	if (ov === null || cv === null || ov === cv) return null;
	return (better === "higher" ? ov > cv : ov < cv) ? "oc" : "cc";
}

export function CompareTable({ snapshot }: { snapshot: MpcSnapshot }) {
	const planKeys = snapshot.plans.map((p) => p.key);
	const initialPlan = planKeys.includes(PREFERRED_PLAN)
		? PREFERRED_PLAN
		: (planKeys[0] ?? "");

	const [planKey, setPlanKey] = useState(initialPlan);
	const [query, setQuery] = useState("");
	const [metric, setMetric] = useState<Metric>(DEFAULT_METRIC);
	const [asc, setAsc] = useState(false);

	const active = METRICS.find((m) => m.id === metric) ?? METRICS[0];
	const plan = snapshot.plans.find((p) => p.key === planKey);

	const rows = useMemo(
		() => compareRows(snapshot, planKey),
		[snapshot, planKey],
	);

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filtered = q
			? rows.filter(
					(r) =>
						r.name.toLowerCase().includes(q) || r.key.includes(q),
				)
			: rows;
		const dir = asc ? 1 : -1;
		// Unpriced rows always sink to the bottom, regardless of direction.
		return [...filtered].sort((a, b) => {
			const av = metricValue(a, "cc", metric);
			const bv = metricValue(b, "cc", metric);
			if (av === null && bv === null) return a.name.localeCompare(b.name);
			if (av === null) return 1;
			if (bv === null) return -1;
			if (av === bv) return a.name.localeCompare(b.name);
			return av < bv ? -dir : dir;
		});
	}, [rows, query, metric, asc]);

	function pickMetric(next: Metric) {
		setMetric(next);
		const better = METRICS.find((m) => m.id === next)?.better ?? "higher";
		setAsc(better === "lower");
	}

	return (
		<div className="mt-8 flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-3">
				<span className={LABEL}>Plan</span>
				{snapshot.plans.map((p) => (
					<button
						key={p.key}
						type="button"
						aria-pressed={p.key === planKey}
						onClick={() => setPlanKey(p.key)}
						className={`${PILL} ${p.key === planKey ? PILL_ON : PILL_OFF}`}
					>
						{p.label}
					</button>
				))}
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
				<label className="flex items-center gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5">
					<span className="sr-only">Filter models</span>
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Filter models…"
						className="mono w-full min-w-40 bg-transparent text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]"
					/>
				</label>

				<div className="flex items-center gap-2">
					<span className={LABEL}>Sort</span>
					{METRICS.map((m) => (
						<button
							key={m.id}
							type="button"
							aria-pressed={m.id === metric}
							onClick={() => pickMetric(m.id)}
							className={`${PILL} ${m.id === metric ? PILL_ON : PILL_OFF}`}
						>
							{m.label}
						</button>
					))}
				</div>

				<button
					type="button"
					onClick={() => setAsc((v) => !v)}
					aria-label="Toggle sort direction"
					className={`${PILL} ${PILL_OFF}`}
				>
					{asc ? "ascending ↑" : "descending ↓"}
				</button>
			</div>

			<div className="overflow-x-auto rounded-lg border border-[var(--hairline)]">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr className="border-b border-[var(--hairline)] bg-[var(--surface)]">
							<th scope="col" className={TH_FIRST}>
								Model
							</th>
							<th scope="col" className={TH}>
								OpenCode Go
							</th>
							<th scope="col" className={TH}>
								CommandCode {plan?.label ?? planKey}
							</th>
							<th scope="col" className={TH}>
								Win
							</th>
						</tr>
					</thead>
					<tbody>
						{visible.map((row) => {
							const win = winner(row, metric, active.better);
							return (
								<tr
									key={row.key}
									className="border-b border-[var(--hairline)] last:border-0 hover:bg-[var(--surface)]"
								>
									<td className="px-4 py-2">
										<span className="ink-fg">
											{row.name}
										</span>
										{row.cc?.deal && (
											<span className="mono ml-2 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--accent)]">
												{row.cc.deal.badge}
											</span>
										)}
									</td>
									<td
										className={`${TD} ${
											win === "oc"
												? "ink-fg font-semibold"
												: "ink-muted"
										}`}
									>
										{metricDisplay(row, "oc", metric)}
									</td>
									<td
										className={`${TD} ${
											win === "cc"
												? "ink-fg font-semibold"
												: "ink-muted"
										}`}
									>
										{metricDisplay(row, "cc", metric)}
									</td>
									<td className={`${TD} ink-muted`}>
										{win === "oc"
											? "OC"
											: win === "cc"
												? "CC"
												: DASH}
									</td>
								</tr>
							);
						})}
						{visible.length === 0 && (
							<tr>
								<td
									colSpan={4}
									className="ink-muted px-4 py-8 text-center"
								>
									No models match “{query}”.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			<p className="mono ink-muted text-xs">
				{visible.length} of {rows.length} models · sorted by{" "}
				{active.label}, {asc ? "ascending" : "descending"} · {DASH}{" "}
				unpriced · “unbounded” = free
			</p>
		</div>
	);
}
