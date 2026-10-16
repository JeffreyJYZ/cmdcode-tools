import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCapture, writeCapture } from "../src/capture";

// Hermetic: point the capture cache at a fresh temp dir, never the real
// $HOME/.cache. capture.ts reads XDG_CACHE_HOME at call time.
const originalXdg = process.env.XDG_CACHE_HOME;
const root = mkdtempSync(join(tmpdir(), "oc-context-capture-"));
process.env.XDG_CACHE_HOME = root;
const cacheDir = join(root, "opencode-context");

afterAll(() => {
	if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
	else process.env.XDG_CACHE_HOME = originalXdg;
	rmSync(root, { recursive: true, force: true });
});

const sample = { systemBytes: 1234, toolDefsBytes: 56, at: 1_700_000_000_000 };

describe("capture", () => {
	test("round-trips the sizes through the cache dir", async () => {
		await writeCapture("ses_round", sample);
		expect(await readCapture("ses_round")).toEqual(sample);
	});

	test("sanitises a session id into a filename-safe name", async () => {
		// Slashes and colons are not path segments; the id still round-trips
		// because read and write share the same sanitiser.
		const id = "ses/../a:b c";
		const value = { systemBytes: 1, toolDefsBytes: 2, at: 3 };
		await writeCapture(id, value);
		expect(await readCapture(id)).toEqual(value);
	});

	test("a capture that was never written reads as undefined", async () => {
		expect(await readCapture("ses_never_written")).toBeUndefined();
	});

	test("malformed JSON and missing fields read as undefined", async () => {
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(join(cacheDir, "ses_bad.json"), "not json");
		expect(await readCapture("ses_bad")).toBeUndefined();
		// Both sizes are required; `at` is not.
		writeFileSync(
			join(cacheDir, "ses_partial.json"),
			JSON.stringify({ at: 5 }),
		);
		expect(await readCapture("ses_partial")).toBeUndefined();
	});

	test("a missing `at` defaults to 0", async () => {
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(
			join(cacheDir, "ses_nofield.json"),
			JSON.stringify({ systemBytes: 7, toolDefsBytes: 8 }),
		);
		expect(await readCapture("ses_nofield")).toEqual({
			systemBytes: 7,
			toolDefsBytes: 8,
			at: 0,
		});
	});
});
