import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SHAPE_AUTO,
	SHAPE_GUARD_ENV,
	SHAPE_MIN_REQS,
} from "#~/constants/shape.ts";
import { loadShapes, reqsOf, workloadOf } from "#~/data/shape.ts";

const PROFILE = {
	input: 7_151,
	output: 296,
	reasoning: 18,
	cacheRead: 135_020,
	cacheWrite: 16,
};

function payload(profile: unknown): string {
	return JSON.stringify({ weight: "turn", profile, models: [] });
}

/** A full reqshape payload: the profile plus the sample it was measured from. */
function measured(reqs: number): string {
	return JSON.stringify({
		weight: "turn",
		profile: PROFILE,
		shape: { reqs, perReq: PROFILE },
		models: [],
	});
}

function fakeReqshape(payload: string): string {
	const dir = mkdtempSync(join(tmpdir(), "mpc-reqshape-"));
	const path = join(dir, "reqshape");
	writeFileSync(path, `#!/bin/sh\nprintf '%s' '${payload}'\n`);
	chmodSync(path, 0o755);
	return path;
}

describe("workloadOf", () => {
	test("reads the combined per-req profile as one workload", () => {
		expect(workloadOf(payload(PROFILE))).toEqual(PROFILE);
	});

	test("falls back to shape.perReq for an older payload", () => {
		expect(
			workloadOf(JSON.stringify({ shape: { perReq: PROFILE } })),
		).toEqual(PROFILE);
	});

	test("a payload with no profile yields nothing", () => {
		expect(workloadOf("{}")).toBeUndefined();
	});
});

describe("reqsOf", () => {
	test("reads the sample size reqshape measured", () => {
		expect(reqsOf(measured(1_234))).toBe(1_234);
		expect(reqsOf("{}")).toBeUndefined();
	});
});

describe("loadShapes", () => {
	test("off means the fixed workload and shells out to nobody", async () => {
		expect((await loadShapes("off")).workload).toBeUndefined();
		expect((await loadShapes("")).workload).toBeUndefined();
	});

	test("a saved payload is read from disk", async () => {
		const path = join(tmpdir(), `mpc-shape-${Date.now()}.json`);
		await Bun.write(path, payload(PROFILE));
		expect((await loadShapes(path)).workload).toEqual(PROFILE);
	});

	test("a missing file falls back rather than throwing", async () => {
		expect(
			(await loadShapes(join(tmpdir(), "mpc-no-such-shape.json")))
				.workload,
		).toBeUndefined();
	});
});

describe("loadShapes auto", () => {
	const saved = process.env.REQSHAPE_BIN;

	afterEach(() => {
		if (saved === undefined) delete process.env.REQSHAPE_BIN;
		else process.env.REQSHAPE_BIN = saved;
	});

	test("uses reqshape once the sample reaches the floor", async () => {
		process.env.REQSHAPE_BIN = fakeReqshape(measured(SHAPE_MIN_REQS));
		expect((await loadShapes(SHAPE_AUTO)).workload).toEqual(PROFILE);
	});

	test("falls back below the floor, naming the sample", async () => {
		process.env.REQSHAPE_BIN = fakeReqshape(measured(SHAPE_MIN_REQS - 1));
		const resolution = await loadShapes(SHAPE_AUTO);
		expect(resolution.workload).toBeUndefined();
		expect(resolution.note).toContain(String(SHAPE_MIN_REQS));
	});

	test("an explicit measured ignores the floor", async () => {
		process.env.REQSHAPE_BIN = fakeReqshape(measured(1));
		expect((await loadShapes("measured")).workload).toEqual(PROFILE);
	});

	test("a nested mpc refuses to measure, even with a big sample", async () => {
		// The guard must win before any spawn; a fake with a passing sample
		// proves the resolution really short-circuited.
		process.env.REQSHAPE_BIN = fakeReqshape(measured(SHAPE_MIN_REQS));
		const savedGuard = process.env[SHAPE_GUARD_ENV];
		process.env[SHAPE_GUARD_ENV] = "1";
		try {
			expect((await loadShapes(SHAPE_AUTO)).workload).toBeUndefined();
		} finally {
			if (savedGuard === undefined) delete process.env[SHAPE_GUARD_ENV];
			else process.env[SHAPE_GUARD_ENV] = savedGuard;
		}
	});
});
