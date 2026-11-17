import type { EntryMetrics, SideId } from "#~/types.ts";
import type { Row } from "#~/view/schema.ts";
import { bestAbility, bestTps } from "./side.ts";

export function fmtCount(n: number): string {
	if (!Number.isFinite(n)) return "∞";
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	if (n >= 10) return n.toFixed(0);
	return n.toFixed(1);
}

export function fmtUsd(n: number): string {
	if (n === 0) return "free";
	// Stay in fixed-point for tiny per-request costs; scientific notation is
	// hard to read at a glance. Trim trailing zeros so $0.000110 reads cleanly.
	const digits = n >= 0.01 ? 4 : n >= 1e-6 ? 8 : 11;
	const fixed = n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
	return `$${fixed}`;
}

export function fmtRate(n: number): string {
	if (n === 0) return "free";
	return `$${Number(n.toFixed(4))}`;
}

export function fmtAllowance(m: EntryMetrics | undefined): string {
	if (!m) return "—";
	return m.free ? "free" : fmtRate(m.allowance);
}

/** Cost per 1,000 requests — the per-request figure scaled up to readable dollars. */
export function fmtPerThousand(m: EntryMetrics | undefined): string {
	if (!m) return "—";
	return fmtUsd(m.payPerRequest * 1000);
}

/** Requests one dollar of subscription buys on this model. */
export function fmtPerDollar(m: EntryMetrics | undefined): string {
	if (!m) return "—";
	if (m.free || m.payPerRequest === 0) return "∞";
	return fmtCount(1 / m.payPerRequest);
}

export function fmtRequests(value: number | undefined, hasEntry: boolean): string {
	if (!hasEntry || value === undefined) return "—";
	return fmtCount(value);
}

export function fmtAbility(row: Row): string {
	const ability = bestAbility(row);
	return ability === null ? "—" : ability.toFixed(1);
}

export function fmtTps(row: Row): string {
	const tps = bestTps(row);
	return tps === null ? "—" : Math.round(tps).toString();
}

const PROVIDER_NAMES: Record<SideId, string> = {
	"oc-go": "OpenCode",
	cc: "CommandCode",
	od: "OpenDesign",
};

const SHORT_NAMES: Record<SideId, string> = { "oc-go": "OC", cc: "CC", od: "OD" };

export function providerName(provider: SideId): string {
	return PROVIDER_NAMES[provider];
}

/** Short provider tag, for the WIN column. */
export function shortProviderName(provider: SideId): string {
	return SHORT_NAMES[provider];
}

/** e.g. "OpenCode Go", "CommandCode GOAT", "OpenDesign Go". */
export function planTitle(plan: { provider: SideId; label: string }): string {
	return `${providerName(plan.provider)} ${plan.label}`;
}
