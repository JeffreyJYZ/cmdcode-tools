import { describe, expect, test } from "bun:test";
import {
	assetLine,
	type CrateFacts,
	compareAssets,
	formulaPin,
	formulaShape,
	manifestVersion,
	parseSums,
	sha256Hex,
	sumsUrl,
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

/** The real tap shape: four release assets, one url+sha256 per platform. */
const RELEASE_FORMULA = `
class Cmduse < Formula
  on_macos do
    on_arm do
      url "https://github.com/o/r/releases/download/cmduse-v0.7.8/cmduse-0.7.8-aarch64-apple-darwin.tar.gz"
      sha256 "${"a".repeat(64)}"
    end
    on_intel do
      url "https://github.com/o/r/releases/download/cmduse-v0.7.8/cmduse-0.7.8-x86_64-apple-darwin.tar.gz"
      sha256 "${"b".repeat(64)}"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/o/r/releases/download/cmduse-v0.7.8/cmduse-0.7.8-aarch64-unknown-linux-musl.tar.gz"
      sha256 "${"c".repeat(64)}"
    end
  end
end
`;

const SUMS = [
	`${"a".repeat(64)}  cmduse-0.7.8-aarch64-apple-darwin.tar.gz`,
	`${"b".repeat(64)}  cmduse-0.7.8-x86_64-apple-darwin.tar.gz`,
	`${"c".repeat(64)}  cmduse-0.7.8-aarch64-unknown-linux-musl.tar.gz`,
].join("\n");

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

describe("verify-crate release-asset formulas", () => {
	test("detects the shape from the url set", () => {
		expect(
			formulaShape([
				"https://github.com/o/r/releases/download/cmduse-v0.7.8/cmduse-0.7.8-aarch64-apple-darwin.tar.gz",
			]),
		).toBe("release");
		expect(formulaShape(["https://x/cmd-usage-0.7.4.crate"])).toBe("crate");
		expect(formulaShape(["https://x/x-1.2.3.tar.gz"])).toBe("unknown");
	});

	test("parses every url + its following sha256", () => {
		const pin = formulaPin(RELEASE_FORMULA, "Formula/cmduse.rb");
		expect(pin.shape).toBe("release");
		expect(pin.assets).toHaveLength(3);
		expect(pin.assets.map((a) => a.file)).toEqual([
			"cmduse-0.7.8-aarch64-apple-darwin.tar.gz",
			"cmduse-0.7.8-x86_64-apple-darwin.tar.gz",
			"cmduse-0.7.8-aarch64-unknown-linux-musl.tar.gz",
		]);
		expect(pin.assets.every((a) => a.version === "0.7.8")).toBe(true);
		expect(pin.assets[0]?.sha256).toBe("a".repeat(64));
	});

	test("derives the SHA256SUMS url from the asset url", () => {
		expect(
			sumsUrl(
				"https://github.com/o/r/releases/download/cmduse-v0.7.8/cmduse-0.7.8-x86_64-apple-darwin.tar.gz",
			),
		).toBe(
			"https://github.com/o/r/releases/download/cmduse-v0.7.8/SHA256SUMS",
		);
		expect(sumsUrl("https://static.crates.io/x.crate")).toBeUndefined();
	});

	test("parses SHA256SUMS tolerating ./ and * markers", () => {
		const sums = parseSums(
			`${"a".repeat(64)}  ./a.tar.gz\n${"b".repeat(64)} *b.tar.gz\n`,
		);
		expect(sums["a.tar.gz"]).toBe("a".repeat(64));
		expect(sums["b.tar.gz"]).toBe("b".repeat(64));
	});

	test("every formula pin must match its sums entry", () => {
		const pin = formulaPin(RELEASE_FORMULA);
		const verdicts = compareAssets(pin.assets, parseSums(SUMS));
		expect(verdicts.every((v) => v.status === "MATCH")).toBe(true);
	});

	test("a corrupted pin is reported as MISMATCH naming the asset", () => {
		const pin = formulaPin(
			RELEASE_FORMULA.replace(
				`sha256 "${"a".repeat(64)}"`,
				`sha256 "${"f".repeat(64)}"`,
			),
		);
		const verdicts = compareAssets(pin.assets, parseSums(SUMS));
		const bad = verdicts.filter((v) => v.status !== "MATCH");
		expect(bad).toHaveLength(1);
		expect(bad.map(assetLine).join("\n")).toContain(
			"cmduse-0.7.8-aarch64-apple-darwin.tar.gz MISMATCH",
		);
		expect(bad[0]?.sums).toBe("a".repeat(64));
	});

	test("an asset missing from SHA256SUMS is a finding", () => {
		const pin = formulaPin(RELEASE_FORMULA);
		const short = parseSums(
			`${"a".repeat(64)}  cmduse-0.7.8-aarch64-apple-darwin.tar.gz`,
		);
		const verdicts = compareAssets(pin.assets, short);
		expect(
			verdicts.filter((v) => v.status === "no-sums").map((v) => v.file),
		).toEqual([
			"cmduse-0.7.8-x86_64-apple-darwin.tar.gz",
			"cmduse-0.7.8-aarch64-unknown-linux-musl.tar.gz",
		]);
	});
});
