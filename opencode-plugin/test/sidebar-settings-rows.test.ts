import { describe, expect, test } from "bun:test";
import { COST_REFRESH_CHOICES, POLL_CHOICES } from "../src/constants/sidebar";
import type { Prefs } from "../src/sidebar/prefs";
import { durationLabel, type SettingRow, settingRows } from "../src/sidebar/settings-rows";

const DEFAULTS: Prefs = {
	colors: false,
	ocPlan: "go",
	pollMs: 5_000,
	cost: "off",
	costMs: 60_000,
};

/** A getter over mutable state, so `hidden()` can follow a setting change. */
const build = (over: Partial<Prefs> = {}) => {
	const state: Prefs = { ...DEFAULTS, ...over };
	const calls: Partial<Prefs>[] = [];
	const rows = settingRows(
		() => state,
		(patch) => calls.push(patch),
	);
	return { state, rows, calls };
};

const at = (rows: readonly SettingRow[], title: string): SettingRow => {
	const row = rows.find((candidate) => candidate.title === title);
	if (!row) throw new Error(`no row titled ${title}`);
	return row;
};

describe("sidebar settings rows", () => {
	test("rows come out in display order, each with its own labels", () => {
		const { rows } = build();
		expect(rows.map((row) => row.title)).toEqual([
			"Colours",
			"OpenCode plan",
			"Refresh",
			"Local cost rows",
			"Cost refresh",
		]);
		expect(at(rows, "Colours").values()).toEqual(["off", "on"]);
		expect(at(rows, "OpenCode plan").values()).toEqual(["go", "go-plus"]);
		expect(at(rows, "Refresh").values()).toEqual(POLL_CHOICES.map(durationLabel));
		expect(at(rows, "Local cost rows").values()).toEqual(["off", "session", "window"]);
		expect(at(rows, "Cost refresh").values()).toEqual(COST_REFRESH_CHOICES.map(durationLabel));
	});

	test("value() reads the prefs it was handed", () => {
		const { rows } = build({
			colors: true,
			ocPlan: "go-plus",
			pollMs: 30_000,
			cost: "session",
			costMs: 300_000,
		});
		expect(at(rows, "Colours").value()).toBe("on");
		expect(at(rows, "OpenCode plan").value()).toBe("go-plus");
		expect(at(rows, "Refresh").value()).toBe("30s");
		expect(at(rows, "Local cost rows").value()).toBe("session");
		expect(at(rows, "Cost refresh").value()).toBe("5m");

		const off = build().rows;
		expect(at(off, "Colours").value()).toBe("off");
		expect(at(off, "Local cost rows").value()).toBe("off");
	});

	test("set() calls save with the typed patch, never the label string", () => {
		const { rows, calls } = build();
		at(rows, "Colours").set("on");
		at(rows, "Colours").set("off");
		at(rows, "OpenCode plan").set("go-plus");
		at(rows, "Refresh").set("1m");
		at(rows, "Local cost rows").set("window");
		at(rows, "Cost refresh").set("5m");
		at(rows, "Cost refresh").set("30s");
		expect(calls).toEqual([
			{ colors: true },
			{ colors: false },
			{ ocPlan: "go-plus" },
			{ pollMs: 60_000 },
			{ cost: "window" },
			{ costMs: 300_000 },
			{ costMs: 30_000 },
		]);
	});

	test("Cost refresh hides while cost rows are off", () => {
		const { state, rows } = build({ cost: "off" });
		const costRefresh = at(rows, "Cost refresh");
		expect(costRefresh.hidden?.()).toBe(true);
		state.cost = "session";
		expect(costRefresh.hidden?.()).toBe(false);
		state.cost = "window";
		expect(costRefresh.hidden?.()).toBe(false);
		// Every other row is always visible.
		expect(at(rows, "Colours").hidden).toBeUndefined();
		expect(at(rows, "Local cost rows").hidden).toBeUndefined();
	});

	test("an invalid label writes nothing", () => {
		const { rows, calls } = build();
		at(rows, "Refresh").set("nope");
		at(rows, "Local cost rows").set("bogus");
		at(rows, "Cost refresh").set("99s");
		expect(calls).toEqual([]);
	});

	test("durationLabel maps the stored milliseconds to the shown label", () => {
		expect(durationLabel(5_000)).toBe("5s");
		expect(durationLabel(60_000)).toBe("1m");
		expect(durationLabel(300_000)).toBe("5m");
		expect(durationLabel(2_000)).toBe("2s");
	});
});
