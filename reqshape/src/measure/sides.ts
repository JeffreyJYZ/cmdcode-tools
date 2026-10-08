import { CC_PREFIXES } from "~/constants/providers.ts";
import type { Req, Side, SideShape } from "~/types.ts";
import { reqProfile } from "./stats.ts";

/** Which plan a provider id's traffic belongs to; null when it is neither. */
export function sideOf(providerID: string): Side | null {
	const id = providerID.toLowerCase();
	if (CC_PREFIXES.some((prefix) => id.startsWith(prefix))) return "cc";
	if (id.startsWith("opencode")) return "oc";
	return null;
}

/**
 * A profile per side. The two plans do not serve the same request — cache read
 * per req differs by an order of magnitude between them — so pricing each on
 * its own measured traffic is the point. A shared profile would hide that.
 * Providers belonging to neither side (routers, local models) are left out
 * rather than averaged into one.
 */
export function sideProfiles(reqs: Req[]): Partial<Record<Side, SideShape>> {
	const sides: Partial<Record<Side, SideShape>> = {};
	for (const side of ["oc", "cc"] as const) {
		const inside = reqs.filter((req) => sideOf(req.provider) === side);
		if (inside.length === 0) continue;
		sides[side] = { reqs: inside.length, profile: reqProfile(inside) };
	}
	return sides;
}
