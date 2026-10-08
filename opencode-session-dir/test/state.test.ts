import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addBinding,
	bindingsFile,
	bindingsFor,
	expandHome,
	freshBindings,
	invalidateCache,
	isChildOf,
	isDirectory,
	isUnderAny,
	readBindings,
	removeBinding,
	stateDir,
} from "../src/state";

const saved = {
	HOME: process.env.HOME,
	XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "session-dir-test-"));
	process.env.HOME = dir;
	process.env.XDG_DATA_HOME = join(dir, "data");
	invalidateCache();
});

afterEach(() => {
	process.env.HOME = saved.HOME;
	process.env.XDG_DATA_HOME = saved.XDG_DATA_HOME;
	invalidateCache();
	rmSync(dir, { recursive: true, force: true });
});

describe("paths", () => {
	test("honours XDG_DATA_HOME", () => {
		expect(stateDir()).toBe(join(dir, "data", "opencode", "session-dir"));
		expect(bindingsFile()).toBe(join(stateDir(), "bindings.json"));
	});

	test("falls back under HOME without XDG_DATA_HOME", () => {
		delete process.env.XDG_DATA_HOME;
		expect(stateDir()).toBe(
			join(dir, ".local", "share", "opencode", "session-dir"),
		);
	});

	test("expandHome", () => {
		expect(expandHome("~/x")).toBe(join(dir, "x"));
		expect(expandHome("/abs")).toBe("/abs");
	});
});

describe("matching", () => {
	test("isChildOf includes descendants, not siblings", () => {
		expect(isChildOf("/a/b", "/a/b")).toBe(true);
		expect(isChildOf("/a/b", "/a/b/c")).toBe(true);
		expect(isChildOf("/a/b", "/a/bc")).toBe(false);
		expect(isChildOf("/a/b", "/a")).toBe(false);
	});

	test("isUnderAny", () => {
		expect(isUnderAny(["/a", "/x/y"], "/x/y/z")).toBe(true);
		expect(isUnderAny(["/a", "/x/y"], "/x/z")).toBe(false);
		expect(isUnderAny([], "/a")).toBe(false);
	});

	test("isDirectory", () => {
		expect(isDirectory(dir)).toBe(true);
		expect(isDirectory(join(dir, "nope"))).toBe(false);
		expect(isDirectory(bindingsFile())).toBe(false);
	});
});

describe("bindings", () => {
	test("add / read / remove are per session", () => {
		expect(bindingsFor("ses_a")).toEqual([]);
		expect(addBinding("ses_a", "/one")).toBe(true);
		expect(addBinding("ses_a", "/two")).toBe(true);
		expect(addBinding("ses_a", "/one")).toBe(false);
		addBinding("ses_b", "/other");

		expect(bindingsFor("ses_a")).toEqual(["/one", "/two"]);
		expect(bindingsFor("ses_b")).toEqual(["/other"]);
		expect(bindingsFor("ses_c")).toEqual([]);

		expect(removeBinding("ses_a", "/one")).toBe(true);
		expect(bindingsFor("ses_a")).toEqual(["/two"]);
		expect(removeBinding("ses_a", "/missing")).toBe(false);

		// removing the last entry drops the session key entirely
		expect(removeBinding("ses_a", "/two")).toBe(true);
		expect(freshBindings()).toEqual({ ses_b: ["/other"] });
	});

	test("readBindings tolerates missing and malformed files", () => {
		expect(readBindings()).toEqual({});

		mkdirSync(stateDir(), { recursive: true });
		writeFileSync(bindingsFile(), "not json");
		expect(readBindings()).toEqual({});

		writeFileSync(bindingsFile(), '["array"]');
		expect(readBindings()).toEqual({});

		writeFileSync(bindingsFile(), '{"ses":[1,2]}');
		expect(readBindings()).toEqual({});
	});
});
