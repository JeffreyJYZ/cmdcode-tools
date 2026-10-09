"use client";

/**
 * Interactive model comparison table for the `/compare` page.
 *
 * Receives the build-time mpc snapshot as a prop (the page is a server
 * component) so the first paint and no-JS render show data. After mount it
 * fetches the committed snapshot from `raw.githubusercontent.com` and adopts it
 * only if it parses to the expected shape, so a visitor always sees the newest
 * committed data without a redeploy. The fetch is client-only: nothing runtime
 * is added to the server render.
 *
 * Two views, mirroring mpc's own presets: **Compact** (the default) shows one
 * chosen metric per side plus the win, and **Full** renders every column mpc
 * prints — `MODEL`, each side's `rates`/`allow`/`5h`/`wk`/`mo`/`$/1K`/`req/$`,
 * then `ability`, `tps`, `DEAL`, `WIN`, `COST`, `VAL`. The metric list under
 * Sort is the same set the columns carry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type CompareRow,
	cheaperSide,
	compareRows,
	DASH,
	formatAbility,
	formatAllowance,
	formatCost,
	formatPerDollar,
	formatPerThousand,
	formatRates,
	INFINITY,
	type MpcSide,
	type MpcSnapshot,
	requestsLabel,
	rowAbility,
	rowCost,
	rowDeal,
	rowTps,
	rowValue,
	rowWin,
	windowLabel,
} from "@/lib/mpc";

/** A numeric dimension the table can sort by; `better` decides the winner. */
type Metric =
	| "req"
	| "per1k"
	| "reqdollar"
	| "cost"
	| "ability"
	| "tps"
	| "val";
type Side = "oc" | "cc";
type Mode = "compact" | "full";
type Tone = "ok" | "warn" | "crit";

/** The committed snapshot, served by GitHub with `access-control-allow-origin: *`. */
const SNAPSHOT_URL =
	"https://raw.githubusercontent.com/JeffreyJYZ/cmdcode-tools/main/website/src/data/mpc.json";

const METRICS: {
	id: Metric;
	label: string;
	better: "higher" | "lower";
}[] = [
	{ id: "req", label: "req / mo", better: "higher" },
	{ id: "cost", label: "$ / req", better: "lower" },
	{ id: "per1k", label: "$ / 1K", better: "lower" },
	{ id: "reqdollar", label: "req / $", better: "higher" },
	{ id: "ability", label: "ability", better: "higher" },
	{ id: "tps", label: "tps", better: "higher" },
	{ id: "val", label: "VAL", better: "higher" },
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
const TH_GROUP =
	"border-l border-[var(--hairline)] px-4 py-2.5 text-center font-medium";
const TD = "px-4 py-2 text-right mono tabular-nums";
const TD_GROUP =
	"border-l border-[var(--hairline)] px-4 py-2 text-right mono tabular-nums";

/** Full view's row-level columns — the set mpc puts beside its two groups. */
const META_HEADERS = ["ability", "tps", "DEAL", "WIN", "COST", "VAL"] as const;

/** One per-side column in the full view, mirroring mpc's `oc-*`/`cc-*` columns. */
type SideColumn = {
	id: string;
	header: string;
	value: (side: MpcSide | null) => string;
};

const SIDE_COLUMNS: SideColumn[] = [
	{ id: "rates", header: "rates", value: (s) => formatRates(s) },
	{ id: "allow", header: "allow", value: (s) => formatAllowance(s) },
	{
		id: "5h",
		header: "5h",
		value: (s) => windowLabel(s, s?.requestsPerFiveHour),
	},
	{
		id: "wk",
		header: "wk",
		value: (s) => windowLabel(s, s?.requestsPerWeek),
	},
	{ id: "mo", header: "mo", value: (s) => requestsLabel(s) },
	{ id: "$/1K", header: "$/1K", value: (s) => formatPerThousand(s) },
	{ id: "req/$", header: "req/$", value: (s) => formatPerDollar(s) },
];

/** The two rate columns whose cell is tinted for the cheaper side. */
const WIN_TINTED = new Set(["$/1K", "req/$"]);

/** Build-time snapshot passes `generatedAt`; anything unmatching is rejected. */
function isMpcSnapshot(value: unknown): value is MpcSnapshot {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.generatedAt === "string" &&
		Array.isArray(v.plans) &&
		typeof v.byPlan === "object" &&
		v.byPlan !== null
	);
}

/**
 * Fetch the committed snapshot, or `null` when unreachable or malformed. Any
 * failure is non-fatal: the caller keeps the snapshot it already has.
 */
async function fetchSnapshot(): Promise<MpcSnapshot | null> {
	try {
		const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
		if (!res.ok) return null;
		const data: unknown = await res.json();
		return isMpcSnapshot(data) ? data : null;
	} catch {
		return null;
	}
}

/** `2026-10-09T18:31:00.000Z` → `Oct 9, 2026, 6:31 PM UTC`; passthrough if invalid. */
function formatGeneratedAt(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const formatted = new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date);
	return `${formatted} UTC`;
}

/** Numeric value of one side under a metric; `null` when unpriced there. */
function sideMetricValue(
	side: MpcSide | null | undefined,
	metric: Metric,
): number | null {
	if (!side) return null;
	switch (metric) {
		case "req":
			// A free model is unbounded, so it tops a descending req/mo sort.
			return side.requestsPerMonth === null
				? Number.POSITIVE_INFINITY
				: side.requestsPerMonth;
		case "per1k":
			return side.payPerRequest * 1000;
		case "reqdollar":
			return side.free || side.payPerRequest === 0
				? Number.POSITIVE_INFINITY
				: 1 / side.payPerRequest;
		case "cost":
			return side.costPerRequest;
		case "ability":
			return side.ability;
		case "tps":
			return side.tps;
		case "val":
			return side.valueIndex;
	}
}

/**
 * The best value across both sides for sorting a row: a row is as good as its
 * better side (`max` when higher wins, `min` when lower does). `null` when the
 * model is unpriced on both sides — such rows always sink.
 */
function rowMetricValue(row: CompareRow, metric: Metric): number | null {
	if (metric === "ability") {
		return row.oc?.ability ?? row.cc?.ability ?? null;
	}
	if (metric === "tps") return row.oc?.tps ?? row.cc?.tps ?? null;
	if (metric === "val") return rowValue(row);
	const values = [
		sideMetricValue(row.oc, metric),
		sideMetricValue(row.cc, metric),
	].filter((value): value is number => value !== null);
	if (values.length === 0) return null;
	const better = METRICS.find((m) => m.id === metric)?.better ?? "higher";
	return better === "higher" ? Math.max(...values) : Math.min(...values);
}

/** Display string for one side under the current metric — never NaN/undefined. */
function sideMetricDisplay(
	row: CompareRow,
	side: Side,
	metric: Metric,
): string {
	if (metric === "req") return side === "oc" ? row.ocLabel : row.ccLabel;
	const s = row[side];
	switch (metric) {
		case "per1k":
			return formatPerThousand(s);
		case "reqdollar":
			return formatPerDollar(s);
		case "cost":
			return formatCost(s?.costPerRequest);
		case "ability":
			return formatAbility(s?.ability);
		case "tps":
			return s?.tps === null || s?.tps === undefined
				? DASH
				: Math.round(s.tps).toString();
		case "val":
			return s?.valueIndex === null || s?.valueIndex === undefined
				? DASH
				: s.valueIndex.toString();
	}
}

/** The side that wins the current metric, or `null` on a tie/one-sided row. */
function metricWinnerSide(row: CompareRow, metric: Metric): Side | null {
	const ov = sideMetricValue(row.oc, metric);
	const cv = sideMetricValue(row.cc, metric);
	if (ov === null || cv === null || ov === cv) return null;
	const better = METRICS.find((m) => m.id === metric)?.better ?? "higher";
	return (better === "higher" ? ov > cv : ov < cv) ? "oc" : "cc";
}

function toneClass(tone: Tone | undefined): string {
	if (tone === "ok") return "text-[var(--ok)]";
	if (tone === "warn") return "text-[var(--warn)]";
	if (tone === "crit") return "text-[var(--crit)]";
	return "";
}

/** mpc's COST cut-offs: ≤30 favourable, ≤60 middling, else poor. */
function costTone(row: CompareRow): Tone {
	const cost = rowCost(row);
	if (cost <= 30) return "ok";
	if (cost <= 60) return "warn";
	return "crit";
}

/** mpc's VAL cut-offs: ≥70 favourable, ≥40 middling, else poor. */
function valTone(value: number | null): Tone | undefined {
	if (value === null) return undefined;
	if (value >= 70) return "ok";
	if (value >= 40) return "warn";
	return "crit";
}

/** Ability is ranked min-max across the visible rows, reusing the VAL cut-offs. */
function abilityTone(
	row: CompareRow,
	range: [number, number] | null,
): Tone | undefined {
	const ability = row.oc?.ability ?? row.cc?.ability ?? null;
	if (ability === null || !range || range[1] <= range[0]) return undefined;
	const score = (100 * (ability - range[0])) / (range[1] - range[0]);
	if (score >= 70) return "ok";
	if (score >= 40) return "warn";
	return "crit";
}

/** Full view's row-level cells, mirroring mpc's meta columns. */
function MetaCells({
	row,
	abilityRange,
	winSide,
}: {
	row: CompareRow;
	abilityRange: [number, number] | null;
	winSide: "oc" | "cc" | "tie" | "none";
}) {
	const value = rowValue(row);
	const cells: { header: string; text: string; tone?: Tone }[] = [
		{
			header: "ability",
			text: rowAbility(row),
			tone: abilityTone(row, abilityRange),
		},
		{ header: "tps", text: rowTps(row) },
		{
			header: "DEAL",
			text: rowDeal(row),
			tone: row.cc?.deal ? "ok" : undefined,
		},
		{
			header: "WIN",
			text: rowWin(row),
			tone: winSide === "oc" || winSide === "cc" ? "ok" : undefined,
		},
		{ header: "COST", text: rowCost(row).toString(), tone: costTone(row) },
		{
			header: "VAL",
			text: value === null ? DASH : value.toString(),
			tone: valTone(value),
		},
	];
	return (
		<>
			{cells.map((cell) => (
				<td
					key={cell.header}
					className={`${TD} ${toneClass(cell.tone) || "ink-muted"}`}
				>
					{cell.text}
				</td>
			))}
		</>
	);
}

export function CompareTable({
	initialSnapshot,
}: {
	initialSnapshot: MpcSnapshot;
}) {
	const [snapshot, setSnapshot] = useState<MpcSnapshot>(initialSnapshot);
	const [refreshError, setRefreshError] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	const planKeys = snapshot.plans.map((p) => p.key);
	const initialPlan = planKeys.includes(PREFERRED_PLAN)
		? PREFERRED_PLAN
		: (planKeys[0] ?? "");

	const [planKey, setPlanKey] = useState(initialPlan);
	const [query, setQuery] = useState("");
	const [metric, setMetric] = useState<Metric>(DEFAULT_METRIC);
	const [asc, setAsc] = useState(false);
	const [mode, setMode] = useState<Mode>("compact");

	/** Reuse the same loader for the on-mount fetch and the manual control. */
	const load = useCallback(async (announceFailure: boolean) => {
		setRefreshing(true);
		const next = await fetchSnapshot();
		if (next) {
			setSnapshot(next);
			setRefreshError(false);
		} else if (announceFailure) {
			setRefreshError(true);
		}
		setRefreshing(false);
	}, []);

	// Auto-refresh after mount; a failure is silent (the initial snapshot stands).
	useEffect(() => {
		void load(false);
	}, [load]);

	// If the live snapshot drops the selected plan, fall back to the first one.
	useEffect(() => {
		if (!snapshot.plans.some((p) => p.key === planKey)) {
			setPlanKey(snapshot.plans[0]?.key ?? "");
		}
	}, [snapshot, planKey]);

	const active = METRICS.find((m) => m.id === metric) ?? METRICS[0];
	const plan = snapshot.plans.find((p) => p.key === planKey);
	const tally = snapshot.byPlan[planKey]?.tally;

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
			const av = rowMetricValue(a, metric);
			const bv = rowMetricValue(b, metric);
			if (av === null && bv === null) return a.name.localeCompare(b.name);
			if (av === null) return 1;
			if (bv === null) return -1;
			if (av === bv) return a.name.localeCompare(b.name);
			return av < bv ? -dir : dir;
		});
	}, [rows, query, metric, asc]);

	// mpc ranks ability against the rows on screen; mirror that over the visible set.
	const abilityRange = useMemo<[number, number] | null>(() => {
		const abilities = visible
			.map((row) => row.oc?.ability ?? row.cc?.ability)
			.filter((value): value is number => typeof value === "number");
		if (abilities.length === 0) return null;
		return [Math.min(...abilities), Math.max(...abilities)];
	}, [visible]);

	function pickMetric(next: Metric) {
		setMetric(next);
		const better = METRICS.find((m) => m.id === next)?.better ?? "higher";
		setAsc(better === "lower");
	}

	const colSpan = mode === "full" ? 1 + SIDE_COLUMNS.length * 2 + 6 : 4;
	const planLabel = plan?.label ?? planKey;

	return (
		<>
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

					<div className="flex items-center gap-2">
						<span className={LABEL}>View</span>
						{(["compact", "full"] as const).map((m) => (
							<button
								key={m}
								type="button"
								aria-pressed={m === mode}
								onClick={() => setMode(m)}
								className={`${PILL} ${m === mode ? PILL_ON : PILL_OFF}`}
							>
								{m === "compact" ? "Compact" : "Full"}
							</button>
						))}
					</div>
				</div>

				<div className="overflow-x-auto rounded-lg border border-[var(--hairline)]">
					<table className="w-full border-collapse text-sm">
						<thead>
							{mode === "full" ? (
								<>
									<tr className="border-b border-[var(--hairline)] bg-[var(--surface)]">
										<th
											scope="col"
											rowSpan={2}
											className={TH_FIRST}
										>
											Model
										</th>
										<th
											scope="colgroup"
											colSpan={SIDE_COLUMNS.length}
											className={TH_GROUP}
										>
											OpenCode Go
										</th>
										<th
											scope="colgroup"
											colSpan={SIDE_COLUMNS.length}
											className={TH_GROUP}
										>
											{`CommandCode ${planLabel}`}
										</th>
										{META_HEADERS.map((header) => (
											<th
												key={header}
												scope="col"
												rowSpan={2}
												className={TH}
											>
												{header}
											</th>
										))}
									</tr>
									<tr className="border-b border-[var(--hairline)] bg-[var(--surface)]">
										{SIDE_COLUMNS.map((c) => (
											<th
												key={`oc-${c.id}`}
												scope="col"
												className={TH}
											>
												{c.header}
											</th>
										))}
										{SIDE_COLUMNS.map((c) => (
											<th
												key={`cc-${c.id}`}
												scope="col"
												className={TH}
											>
												{c.header}
											</th>
										))}
									</tr>
								</>
							) : (
								<tr className="border-b border-[var(--hairline)] bg-[var(--surface)]">
									<th scope="col" className={TH_FIRST}>
										Model
									</th>
									<th scope="col" className={TH}>
										OpenCode Go
									</th>
									<th scope="col" className={TH}>
										{`CommandCode ${planLabel}`}
									</th>
									<th scope="col" className={TH}>
										WIN
									</th>
								</tr>
							)}
						</thead>
						<tbody>
							{visible.map((row) => {
								const winSide = cheaperSide(row);
								const metricWin = metricWinnerSide(row, metric);
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
										{mode === "compact" ? (
											<>
												<td
													className={`${TD} ${
														metricWin === "oc"
															? "ink-fg font-semibold"
															: "ink-muted"
													}`}
												>
													{sideMetricDisplay(
														row,
														"oc",
														metric,
													)}
												</td>
												<td
													className={`${TD} ${
														metricWin === "cc"
															? "ink-fg font-semibold"
															: "ink-muted"
													}`}
												>
													{sideMetricDisplay(
														row,
														"cc",
														metric,
													)}
												</td>
												<td
													className={`${TD} ink-muted`}
												>
													{rowWin(row)}
												</td>
											</>
										) : (
											<>
												{SIDE_COLUMNS.map((c) => (
													<td
														key={`oc-${c.id}`}
														className={`${TD} ${
															row.oc?.free
																? "text-[var(--ok)]"
																: WIN_TINTED.has(
																			c.id,
																		) &&
																		winSide ===
																			"oc"
																	? "ink-fg font-semibold"
																	: "ink-muted"
														}`}
													>
														{c.value(row.oc)}
													</td>
												))}
												{SIDE_COLUMNS.map((c, i) => (
													<td
														key={`cc-${c.id}`}
														className={`${i === 0 ? TD_GROUP : TD} ${
															row.cc?.free
																? "text-[var(--ok)]"
																: WIN_TINTED.has(
																			c.id,
																		) &&
																		winSide ===
																			"cc"
																	? "ink-fg font-semibold"
																	: "ink-muted"
														}`}
													>
														{c.value(row.cc)}
													</td>
												))}
												<MetaCells
													row={row}
													abilityRange={abilityRange}
													winSide={winSide}
												/>
											</>
										)}
									</tr>
								);
							})}
							{visible.length === 0 && (
								<tr>
									<td
										colSpan={colSpan}
										className="ink-muted px-4 py-8 text-center"
									>
										{`No models match “${query}”.`}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>

				<p className="mono ink-muted text-xs">
					{`${visible.length} of ${rows.length} models · sorted by ${active.label}, ${asc ? "ascending" : "descending"} · WIN = cheaper per request · ${DASH} unpriced · “unbounded”/“${INFINITY}” = free`}
				</p>
				{mode === "full" && tally && (
					<p className="mono ink-muted text-xs">
						{`${tally.headToHead} head-to-head · ${tally.ocWins} OC · ${tally.ccWins} CC · ${tally.ties} ties · ${tally.ocOnly} OC-only · ${tally.ccOnly} CC-only`}
					</p>
				)}
			</div>

			<div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1">
				<p className="ink-muted text-xs">
					{`Data as of `}
					<time dateTime={snapshot.generatedAt}>
						{formatGeneratedAt(snapshot.generatedAt)}
					</time>
					{`. Regenerate with `}
					<code className="mono">bun snapshot:mpc</code>.
				</p>
				<button
					type="button"
					onClick={() => void load(true)}
					disabled={refreshing}
					className={`${PILL} ${PILL_OFF} disabled:opacity-50`}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
				{refreshError && (
					<span className="mono ink-muted text-xs">
						refresh failed — showing the committed snapshot
					</span>
				)}
			</div>
		</>
	);
}
