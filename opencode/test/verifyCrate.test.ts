import { describe, expect, test } from "bun:test";
import {
	type CrateFacts,
	formulaPin,
	manifestVersion,
	sha256Hex,
	verdict,
} from "../scripts/verify-crate";

const FORMULA = `
class Cmduse < Formula
  desc "Live usage dashboards"
  url "https://static.crates.io/crates/cmd-usage/cmd-usage-0.7.4.crate"
  sha256 "0db0dd4a4c84eb58a1260b56275f5b3808e7d342effa4ec438cc21f3d23c71d0"
  license "MIT"
end
`;

describe("verify-crate helpers", () => {
	test("reads the version the formula pins, from the crate url", () => {
		const pin = formulaPin(FORMULA, "Formula/cmduse.rb");
		expect(pin.urlVersion).toBe("0.7.4");
		expect(pin.sha256).toBe(
			"0db0dd4a4c84eb58a1260b56275f5b3808e7d342effa4ec438cc21f3d23c71d0",
		);
		expect(pin.path).toBe("Formula/cmduse.rb");
	});

	test("a formula with a git url rather than a crate still parses its sha", () => {
		const pin = formulaPin(
			`url "https://example.test/x-1.2.3.tar.gz"\nsha256 "${"ab".repeat(32)}"`,
		);
		expect(pin.urlVersion).toBeUndefined();
		expect(pin.sha256).toBe("ab".repeat(32));
	});

	test("manifest version comes from the first version line", () => {
		expect(
			manifestVersion(
				`[package]\nname = "cmd-usage"\nversion = "0.7.5"\n`,
			),
		).toBe("0.7.5");
		expect(manifestVersion("no version here")).toBeUndefined();
	});

	test("sha256 matches a known vector", () => {
		expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	test("the verdict names the failing link", () => {
		const absent: CrateFacts = {
			versionPresent: false,
			indexStatus: 404,
			tarballUrl: "",
		};
		expect(verdict("0.7.5", absent, 404)).toContain(
			"absent from the index",
		);
		const indexed: CrateFacts = {
			versionPresent: true,
			indexStatus: 200,
			tarballUrl: "",
		};
		expect(verdict("0.7.5", indexed, 404)).toContain("tarball=404");
		expect(
			verdict("0.7.5", indexed, 200, "a".repeat(64), "a".repeat(64)),
		).toContain("MATCH");
		expect(
			verdict("0.7.5", indexed, 200, "a".repeat(64), "b".repeat(64)),
		).toContain("MISMATCH");
	});
});
