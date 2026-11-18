import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	arkuseArgs,
	buildCmduseArgs,
	buildMpcArgs,
	cmduseCandidates,
	mpcCandidates,
	ocuseArgs,
	ocuseCandidates,
	oduseArgs,
	runCmduse,
	runMpc,
	runOcuse,
	runOduse,
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

	test("hermetic: a fake cmduse shim on PATH runs through candidate resolution", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cmduse-shim-"));
		const shim = join(dir, "cmduse");
		writeFileSync(shim, "#!/bin/sh\necho '{\"ok\":true}'\n");
		chmodSync(shim, 0o755);
		try {
			const out = await runCmduse("", { candidates: [shim] });
			expect(out.trim()).toBe('{"ok":true}');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a child ignoring SIGTERM is ultimately killed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cmduse-hang-"));
		const shim = join(dir, "cmduse");
		writeFileSync(shim, '#!/bin/sh\ntrap "" TERM\nwhile :; do sleep 1; done\n');
		chmodSync(shim, 0o755);
		const start = Date.now();
		try {
			await runCmduse("", { candidates: [shim], timeoutMs: 100 });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("timed out after 100ms");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(4500);
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

/** All four usage-tool builders must carry the same anti-hang rule. A string
 * assertion alone missed the shipped bug, so the real-spawn tests below are the
 * ones that actually prove a tool call returns. */
const USAGE_BUILDERS = [
	["buildCmduseArgs", (arg: string | undefined) => buildCmduseArgs(arg ?? "")],
	["ocuseArgs", ocuseArgs],
	["arkuseArgs", arkuseArgs],
	["oduseArgs", oduseArgs],
] as const;

describe("one-shot guard on every usage-tool builder", () => {
	for (const [name, build] of USAGE_BUILDERS) {
		test(`${name}: flag-only args get a one-shot`, () => {
			// The old ocuse/arkuse/oduse builders passed "--rows 5" through
			// verbatim — the binary read that as the watch loop and hung.
			expect(build("--rows 5")).toContain("-1");
		});
		test(`${name}: empty is exactly one one-shot`, () => {
			const args = build("");
			expect(args.filter((t) => t === "-1" || t === "--once")).toHaveLength(1);
		});
		test(`${name}: a subcommand passes through untouched`, () => {
			expect(build("daily")).toEqual(["daily"]);
			expect(build("daily --days 14")).toEqual(["daily", "--days", "14"]);
		});
		test(`${name}: an explicit -1 is not doubled`, () => {
			const args = build("-1 --json");
			expect(args.filter((t) => t === "-1" || t === "--once")).toHaveLength(1);
		});
	}
});

describe("one-shot default shape", () => {
	test("cmduse keeps its --plain (no colors / no redraw)", () => {
		expect(buildCmduseArgs("")).toEqual(["-1", "--plain"]);
	});
	test("the three sibling tools are exactly -1", () => {
		for (const build of [ocuseArgs, arkuseArgs, oduseArgs]) {
			expect(build(undefined)).toEqual(["-1"]);
			expect(build("")).toEqual(["-1"]);
			expect(build("   ")).toEqual(["-1"]);
		}
		expect(oduseArgs("--no-wallet")).toEqual(["-1", "--no-wallet"]);
		expect(ocuseArgs("--plan go-plus")).toEqual(["-1", "--plan", "go-plus"]);
		expect(arkuseArgs("--json")).toEqual(["-1", "--json"]);
		expect(ocuseArgs("--once --json")).toEqual(["--once", "--json"]);
	});
});

describe("real spawn: produced argv cannot start the watch loop", () => {
	test("a shim that hangs on a bare flag exits on the produced argv", async () => {
		const dir = mkdtempSync(join(tmpdir(), "oduse-argv-"));
		const shim = join(dir, "oduse");
		// Any argv containing -1/--once exits; anything else is the watch loop.
		writeFileSync(
			shim,
			'#!/bin/sh\ncase " $* " in *" -1 "*|*" --once "*) exit 0;; esac\nwhile :; do sleep 1; done\n',
		);
		chmodSync(shim, 0o755);
		try {
			// Pre-fix argv ("--no-wallet" verbatim) proves the shim can detect a hang.
			await expect(
				runOduse("--no-wallet", { candidates: [shim], timeoutMs: 200 }),
			).rejects.toThrow("timed out after 200ms");
			// The builder's argv is what keeps the tool call finite.
			await expect(
				runOduse(oduseArgs("--no-wallet"), { candidates: [shim], timeoutMs: 2000 }),
			).resolves.toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 5000);

	const oduseBin = (() => {
		const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
		// Same resolution order as scripts/check-parity.ts: $ODUSE_BIN, the dev
		// build in this repo, then a bare dev/installed name.
		const candidates = [
			process.env.ODUSE_BIN,
			join(import.meta.dir, "..", "..", "target", "debug", "odusedev"),
			"odusedev",
			"oduse",
		].filter((bin): bin is string => Boolean(bin));
		for (const bin of candidates) {
			try {
				if (spawnSync(bin, ["-V"], { stdio: "ignore", timeout: 3000 }).status === 0)
					return bin;
			} catch {
				// try the next candidate
			}
		}
		return undefined;
	})();

	test.skipIf(!oduseBin)(
		"real oduse --no-wallet exits (not the watch loop)",
		async () => {
			const bin = oduseBin;
			if (!bin) return;
			const args = oduseArgs("--no-wallet");
			expect(args[0]).toBe("-1");
			const { code, signal } = await new Promise<{
				code: number | null;
				signal: string | null;
			}>((resolve, reject) => {
				const child = spawn(bin, args, { stdio: "ignore", detached: true });
				// The one-shot reads the local store and takes ~10 s here; 30 s is
				// generous enough for CI load but still bounds a real hang.
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error(`hang: oduse ${args.join(" ")} did not exit within 30000ms`));
				}, 30000);
				child.on("error", (err) => {
					clearTimeout(timer);
					reject(err);
				});
				child.on("close", (c, s) => {
					clearTimeout(timer);
					resolve({ code: c, signal: s });
				});
			});
			// A bounded exit is the whole point: any code is fine, a timeout is not.
			expect(signal).toBeNull();
			expect(code).not.toBeNull();
		},
		40000,
	);
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
