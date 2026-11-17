// The OpenDesign section must appear for *every* spelling of the provider, and
// for no other family. A session records whichever provider id it ran under, and
// a hand-written `opencode.json` block such as `open-design-tmp` coexists with
// the plugin's own `open-design`; matching the id alone hid every turn on the
// hand-written one, so the section had no rows while `oduse` was healthy.
//
// The test goes through both halves the panel uses — `sessionKind` decides the
// family and `odRows` builds the block — so a future narrowing of either one
// fails here rather than blanking the panel.
import { describe, expect, test } from "bun:test";
import { isOpenDesignProvider, OPEN_DESIGN_PROVIDER_ID } from "../src/constants/providers";
import { parseOdJson } from "../src/sidebar/od";
import { odRows } from "../src/sidebar/od-rows";
import { panelTitle, sessionKind } from "../src/sidebar/useRows";
import { odSnapshot } from "./od-fixture";

const snapshot = parseOdJson(odSnapshot());

/** What the panel would draw for a session on this provider. */
function sectionFor(providerID: string) {
	return sessionKind(providerID) === "od" ? odRows(snapshot) : [];
}

describe("the OpenDesign provider prefix", () => {
	test("both real spellings count, and so does a future third one", () => {
		expect(isOpenDesignProvider(OPEN_DESIGN_PROVIDER_ID)).toBe(true);
		expect(isOpenDesignProvider("open-design-tmp")).toBe(true);
		expect(isOpenDesignProvider("open-design-2")).toBe(true);
	});

	test("nothing else counts, and an unresolved provider is not ours", () => {
		expect(isOpenDesignProvider("command-code-openai")).toBe(false);
		expect(isOpenDesignProvider("opencode-go")).toBe(false);
		expect(isOpenDesignProvider("agent-plan")).toBe(false);
		// A bare `open` or a suffix match must not read as the family.
		expect(isOpenDesignProvider("open")).toBe(false);
		expect(isOpenDesignProvider("my-open-design")).toBe(false);
		expect(isOpenDesignProvider(undefined)).toBe(false);
		expect(isOpenDesignProvider("")).toBe(false);
	});
});

describe("the section a session on each provider gets", () => {
	test("open-design and open-design-tmp both produce a titled, populated block", () => {
		for (const providerID of [OPEN_DESIGN_PROVIDER_ID, "open-design-tmp"]) {
			expect(sessionKind(providerID)).toBe("od");
			expect(panelTitle(sessionKind(providerID))).toBe("OpenDesign");
			const rows = sectionFor(providerID);
			// Not merely "not empty": the headline plus the meters are what the
			// reader sees, and a section that renders no rows looks broken.
			expect(rows.length).toBeGreaterThan(5);
			expect(rows[0]?.[0]).toBe("OpenDesign");
			expect(rows.map((row) => row[0])).toContain("Monthly");
		}
	});

	test("an unrelated provider gets no OpenDesign block at all", () => {
		for (const providerID of ["command-code-openai", "opencode-go"]) {
			expect(sessionKind(providerID)).not.toBe("od");
			expect(panelTitle(sessionKind(providerID))).not.toBe("OpenDesign");
			expect(sectionFor(providerID)).toEqual([]);
		}
	});
});
