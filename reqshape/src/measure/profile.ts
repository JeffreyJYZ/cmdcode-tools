import type { Ask, Bucket, Profile, Req, Shape, Stats } from "#~/types.ts";
import { sideProfiles } from "./sides.ts";
import { emptyProfile, FIELDS, mean, reqProfile, stats } from "./stats.ts";

const BUCKETS: Array<{ label: string; holds: (position: number) => boolean }> =
	[
		{ label: "1", holds: (position) => position === 1 },
		{ label: "2-5", holds: (position) => position >= 2 && position <= 5 },
		{ label: "6-20", holds: (position) => position >= 6 && position <= 20 },
		{
			label: "21-100",
			holds: (position) => position >= 21 && position <= 100,
		},
		{ label: "101+", holds: (position) => position >= 101 },
	];

const STAT_FIELDS = { ...FIELDS, cost: (req: Req) => req.cost };

/**
 * One vote per conversation: average within each session, then across them, so
 * a single vast session cannot outweigh every short chat in the history.
 */
function sessionProfile(sessions: Req[][]): Profile {
	const profile = emptyProfile();
	for (const [field, read] of Object.entries(FIELDS)) {
		profile[field as keyof Profile] = mean(
			sessions.map((session) => mean(session.map(read))),
		);
	}
	return profile;
}

function bucketsOf(reqs: Req[]): Bucket[] {
	const buckets: Bucket[] = [];
	for (const { label, holds } of BUCKETS) {
		const inside = reqs.filter((req) => holds(req.position));
		if (inside.length === 0) continue;
		buckets.push({
			label,
			reqs: inside.length,
			input: mean(inside.map(FIELDS.input)),
			output: mean(inside.map(FIELDS.output)),
			cacheRead: mean(inside.map(FIELDS.cacheRead)),
		});
	}
	return buckets;
}

function modelsOf(reqs: Req[]): {
	list: Array<{ name: string; reqs: number }>;
	total: number;
} {
	const counts = new Map<string, number>();
	for (const req of reqs) {
		const name = req.model || "unknown";
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return {
		list: [...counts.entries()]
			.map(([name, count]) => ({ name, reqs: count }))
			.sort((a, b) => b.reqs - a.reqs)
			.slice(0, 8),
		total: counts.size,
	};
}

/**
 * Measure the kept asks. Every req carries equal weight by default, because a
 * req is the unit you are billed in; the per-conversation figure is measured
 * alongside it, since the two can disagree by a factor of four.
 */
export function buildShape(asks: Ask[]): Shape {
	const reqs: Req[] = [];
	const bySession = new Map<string, Req[]>();
	const directories = new Set<string>();
	let first = 0;
	let last = 0;

	for (const ask of asks) {
		const session = bySession.get(ask.sessionID) ?? [];
		bySession.set(ask.sessionID, session);
		for (const req of ask.reqs) {
			reqs.push(req);
			session.push(req);
		}
		if (ask.directory) directories.add(ask.directory);
		if (ask.time > 0) {
			first = first === 0 ? ask.time : Math.min(first, ask.time);
			last = Math.max(last, ask.time);
		}
	}

	const record = {} as Record<keyof Profile | "cost", Stats>;
	for (const [field, read] of Object.entries(STAT_FIELDS)) {
		record[field as keyof Profile | "cost"] = stats(reqs.map(read));
	}

	const models = modelsOf(reqs);
	return {
		reqs: reqs.length,
		asks: asks.length,
		sessions: bySession.size,
		projects: directories.size,
		first,
		last,
		stats: record,
		perReq: reqProfile(reqs),
		perSession: sessionProfile([...bySession.values()]),
		sides: sideProfiles(reqs),
		buckets: bucketsOf(reqs),
		modelTotal: models.total,
		models: models.list,
	};
}
