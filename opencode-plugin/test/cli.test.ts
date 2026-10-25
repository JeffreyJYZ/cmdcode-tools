import { describe, expect, test } from "bun:test";
import {
	buildCmduseArgs,
	buildMpcArgs,
	cmduseCandidates,
	mpcCandidates,
	ocuseArgs,
	ocuseCandidates,
	runCmduse,
	runMpc,
	runOcuse,
	splitCliArgs,
} from "../src/cli";
import {
	CMDUSE_BIN_CANDIDATES,
	MPC_BIN_CANDIDATES,
	OCUSE_BIN_CANDIDATES,
} from "../src/constants/binaries";

describe("splitCliArgs", () => {
	test("whitespace split", () => {
		expect(splitCliArgs("--tz +05:30 daily")).toEqual(["--tz", "+05:30", "daily"]);
	});
	test("multiple spaces / tabs collapse", () => {
		expect(splitCliArgs("  a\t b   c ")).toEqual(["a", "b", "c"]);
	});
	test("double quotes keep spaces", () => {
		expect(splitCliArgs('--model "gpt 5.5"')).toEqual(["--model", "gpt 5.5"]);
	});
	test("single quotes keep spaces literally", () => {
		expect(splitCliArgs("'a b' c")).toEqual(["a b", "c"]);
	});
	test("backslash escapes next char outside quotes", () => {
		expect(splitCliArgs("a\\ b")).toEqual(["a b"]);
	});
	test("empty / no tokens", () => {
		expect(splitCliArgs("")).toEqual([]);
		expect(splitCliArgs("   ")).toEqual([]);
	});
});

describe("buildCmduseArgs", () => {
	test("default dashboard", () => {
		expect(buildCmduseArgs("")).toEqual(["-1", "--plain"]);
	});
	test("subcommand passed through untouched", () => {
		expect(buildCmduseArgs("plans")).toEqual(["plans"]);
		expect(buildCmduseArgs("daily --days 14")).toEqual(["daily", "--days", "14"]);
	});
	test("bare flags prepend the one-shot dashboard", () => {
		expect(buildCmduseArgs("--local")).toEqual(["-1", "--plain", "--local"]);
		expect(buildCmduseArgs("--tz +05:30 hourly")).toEqual(["--tz", "+05:30", "hourly"]);
	});
});

describe("runCmduse", () => {
	// CI has no cmduse binary: the smoke test must not assume a host install.
	// Skip it there, run it on a machine with the CLI present.
	const hasCmduse = (() => {
		try {
			const { execFileSync } =
				require("node:child_process") as typeof import("node:child_process");
			execFileSync("cmduse", ["-V"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	})();

	test.skipIf(!hasCmduse)("real binary on PATH (smoke)", async () => {
		const out = await runCmduse("--version");
		expect(out.trim()).toMatch(/\d+\.\d+\.\d+/);
	});
	test("ENOENT across all candidates yields install hint", async () => {
		try {
			await runCmduse("", {
				candidates: ["definitely-not-cmduse-xyz", "/no/such/cmduse"],
			});
			throw new Error("expected runCmduse to reject");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("cmduse binary not found");
			expect(msg).toContain("brew install JeffreyJYZ/tap/cmduse");
		}
	});
	test("non-ENOENT errors surface immediately", async () => {
		try {
			// /dev/null exists but is not executable → EACCES, not ENOENT.
			await runCmduse("--version", { candidates: ["/dev/null"] });
			throw new Error("expected runCmduse to reject");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("cmduse binary not found");
		}
	});
});

describe("cmduseCandidates", () => {
	test("CMDUSE_BIN leads, the homebrew paths remain as fallbacks", () => {
		expect(cmduseCandidates({ CMDUSE_BIN: "/tmp/cmdusedev" })[0]).toBe("/tmp/cmdusedev");
		expect(cmduseCandidates({})).toEqual([...CMDUSE_BIN_CANDIDATES]);
		expect(cmduseCandidates({ CMDUSE_BIN: "" })).not.toContain("");
	});
});

describe("buildMpcArgs", () => {
	test("default is the fewest-columns view", () => {
		expect(buildMpcArgs("")).toEqual(["--minimal"]);
		expect(buildMpcArgs("   ")).toEqual(["--minimal"]);
	});
	test("flags pass straight through (mpc has no subcommands)", () => {
		expect(buildMpcArgs("--json")).toEqual(["--json"]);
		expect(buildMpcArgs("--model deepseek --detail")).toEqual([
			"--model",
			"deepseek",
			"--detail",
		]);
		expect(buildMpcArgs('--model "gpt 5.5" --json')).toEqual(["--model", "gpt 5.5", "--json"]);
	});
});

describe("runMpc", () => {
	test("ENOENT across all candidates yields install hint", async () => {
		try {
			await runMpc("", {
				candidates: ["definitely-not-mpc-xyz", "/no/such/mpc"],
			});
			throw new Error("expected runMpc to reject");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("mpc binary not found");
			expect(msg).toContain("bun add -g @jeffreyjyz/mpc");
		}
	});
	test("non-ENOENT errors surface immediately", async () => {
		try {
			// /dev/null exists but is not executable → EACCES, not ENOENT.
			await runMpc("--minimal", { candidates: ["/dev/null"] });
			throw new Error("expected runMpc to reject");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("mpc binary not found");
		}
	});
});

describe("mpcCandidates", () => {
	test("MPC_BIN leads, the bun/homebrew paths remain as fallbacks", () => {
		expect(mpcCandidates({ MPC_BIN: "/tmp/mpcdev" })[0]).toBe("/tmp/mpcdev");
		expect(mpcCandidates({})).toEqual([...MPC_BIN_CANDIDATES]);
		expect(mpcCandidates({ MPC_BIN: "" })).not.toContain("");
	});
});

describe("ocuseCandidates", () => {
	test("OCUSE_BIN leads, the homebrew paths remain as fallbacks", () => {
		expect(ocuseCandidates({ OCUSE_BIN: "/tmp/ocusdev" })[0]).toBe("/tmp/ocusdev");
		expect(ocuseCandidates({})).toEqual([...OCUSE_BIN_CANDIDATES]);
		expect(ocuseCandidates({ OCUSE_BIN: "" })).not.toContain("");
	});
});

describe("ocuseArgs", () => {
	test("empty input defaults to the one-shot dashboard", () => {
		// A bare ocuse is the live watch loop and would never return to the
		// agent or resolve the dialog, so empty never passes through.
		expect(ocuseArgs(undefined)).toBe("-1");
		expect(ocuseArgs("")).toBe("-1");
		expect(ocuseArgs("   ")).toBe("-1");
	});
	test("given args pass through untouched", () => {
		expect(ocuseArgs("daily")).toBe("daily");
		expect(ocuseArgs("--plan go-plus --json")).toBe("--plan go-plus --json");
	});
});

describe("runOcuse", () => {
	test("ENOENT across all candidates yields install hint", async () => {
		try {
			await runOcuse(["-1", "--json"], {
				candidates: ["definitely-not-ocuse-xyz", "/no/such/ocuse"],
			});
			throw new Error("expected runOcuse to reject");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("ocuse binary not found");
			expect(msg).toContain("brew install JeffreyJYZ/tap/cmduse");
		}
	});
	test("a pre-split token array is accepted (sidebar's call shape)", async () => {
		// runOcuse takes the sidebar's own argv: `-1 --json --plan <plan>`.
		await expect(
			runOcuse(["-1", "--json", "--plan", "go"], {
				candidates: ["definitely-not-ocuse-xyz"],
			}),
		).rejects.toThrow("ocuse binary not found");
	});
});
