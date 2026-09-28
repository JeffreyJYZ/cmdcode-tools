// Crate release verifier: the Rust/tap counterpart of verify-release.ts.
//
// Two links have to hold after `cargo publish`:
//   1. registry  <- crate   the served .crate matches what this checkout packs
//   2. formula   <- registry the tap's url/sha256 point at exactly those bytes
//
// `cargo package` is byte-reproducible (same tree, same version, same sha256),
// so the first link is a plain hash comparison. It also catches the failure that
// bit us by hand: a *stale* local pack — one made before the last source edit —
// silently disagreeing with what actually shipped.
//
//   bun scripts/verify-crate.ts [version] [--crate <name>] [--formula <path>]
//                               [--expected <sha256>] [--tries N] [--no-pack]
//
// Without a version it uses cli/Cargo.toml, which is the release-in-progress.
// Checking an *older* release needs --no-pack (or --expected <published sha>):
// this checkout can only reproduce the crate its manifest is at, and a stale
// local pack is exactly the mismatch this script exists to report.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname;
const REGISTRY = "https://crates.io/api/v1/crates";
const PKG = "cmd-usage";

export interface CrateFacts {
	versionPresent: boolean;
	indexStatus: number;
	tarballUrl: string;
	/** url + sha256 as the tap formula currently pins them. */
	formula?: FormulaPin;
}

export interface FormulaPin {
	urlVersion?: string;
	sha256?: string;
	path: string;
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Version from a `version = "x.y.z"` line, as Cargo manifests write it. */
export function manifestVersion(text: string): string | undefined {
	return text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
}

/** The url version and sha256 a Homebrew formula pins. */
export function formulaPin(
	text: string,
	path = "Formula/cmduse.rb",
): FormulaPin {
	const url = text.match(/^\s*url\s+"([^"]+)"/m)?.[1];
	const sha = text.match(/^\s*sha256\s+"([0-9a-f]{64})"/m)?.[1];
	// The crate URL ends in `<name>-<version>.crate`, so the version is in the url.
	const urlVersion = url?.match(/-(\d+\.\d+\.\d+)\.crate$/)?.[1];
	return { urlVersion, sha256: sha, path };
}

export function verdict(
	version: string,
	facts: CrateFacts,
	tarballStatus: number,
	sha256?: string,
	expected?: string,
): string {
	if (!facts.versionPresent)
		return `version=${version} absent from the index (not published yet)`;
	if (tarballStatus !== 200)
		return `version=${version} in the index, tarball=${tarballStatus}`;
	const match = expected
		? sha256 === expected
			? "MATCH"
			: "MISMATCH"
		: "no-tip";
	return `version=${version} tarball=200 sha256=${sha256?.slice(0, 12)}… ${match}`;
}

/** `cargo package` writes the .crate to target/package; hash exactly that file. */
async function packLocalSha256(version: string): Promise<string | undefined> {
	const packaged = spawnSync(
		"cargo",
		["package", "-p", PKG, "--allow-dirty", "--quiet"],
		{ cwd: REPO, encoding: "utf8" },
	);
	if (packaged.status !== 0) {
		console.error(packaged.stderr?.trim() || "cargo package failed");
		return undefined;
	}
	const file = Bun.file(
		join(REPO, "target", "package", `${PKG}-${version}.crate`),
	);
	if (!(await file.exists())) {
		console.error(`no crate at ${file.name} — is the manifest at ${version}?`);
		return undefined;
	}
	return sha256Hex(new Uint8Array(await file.arrayBuffer()));
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const crate = value("--crate") ?? PKG;
	const manifest = (await Bun.file(
		join(REPO, "cli/Cargo.toml"),
	).text()) as string;
	const explicit = args.find((a) => !a.startsWith("--") && /^\d/.test(a));
	const version = explicit ?? manifestVersion(manifest);
	if (!version) {
		console.error(
			"usage: bun scripts/verify-crate.ts [version] [--expected <sha256>] [--tries N] [--no-pack]",
		);
		return 2;
	}
	const expected =
		value("--expected") ??
		(args.includes("--no-pack") ? undefined : await packLocalSha256(version));
	if (expected) console.log(`expected sha256: ${expected}`);
	const tries = Number(value("--tries") ?? 40);

	const formulaPath =
		value("--formula") ??
		join(
			process.env.HOMEBREW_PREFIX ?? "/opt/homebrew",
			"Library/Taps/jeffreyjyz/homebrew-tap/Formula/cmduse.rb",
		);
	const formulaFile = Bun.file(formulaPath);
	const formula = (await formulaFile.exists())
		? formulaPin(await formulaFile.text(), formulaPath)
		: undefined;

	for (let i = 1; i <= tries; i++) {
		const index = await fetch(`${REGISTRY}/${crate}/${version}`)
			.then((r) => ({ status: r.status, body: r.json() }))
			.catch(() => undefined);
		const facts: CrateFacts = {
			versionPresent: index?.status === 200,
			indexStatus: index?.status ?? 0,
			tarballUrl: `https://static.crates.io/crates/${crate}/${crate}-${version}.crate`,
			formula,
		};
		const response = await fetch(facts.tarballUrl).catch(() => undefined);
		const status = response?.status ?? 0;
		if (facts.versionPresent && status === 200 && response) {
			const sha256 = sha256Hex(new Uint8Array(await response.arrayBuffer()));
			console.log(verdict(version, facts, status, sha256, expected));
			if (expected && sha256 !== expected) {
				console.error(
					`served crate is not what this checkout packs — do not ship it`,
				);
				return 1;
			}
			if (!formula) {
				console.error(
					`no tap formula at ${formulaPath} — nothing to check it against`,
				);
				return 1;
			}
			if (formula.urlVersion !== version) {
				console.error(
					`formula pins ${formula.urlVersion ?? "no version"}, not ${version} (${formula.path})`,
				);
				return 1;
			}
			if (formula.sha256 !== sha256) {
				console.error(
					`formula sha256 ${formula.sha256?.slice(0, 12)}… does not match the served crate — brew would fail or install other bytes`,
				);
				return 1;
			}
			console.log(
				`formula pins ${version} and the served bytes (${formula.path})`,
			);
			console.log(`verified ${crate}@${version}`);
			return 0;
		}
		console.log(`try=${i} ${verdict(version, facts, status)}`);
		if (i < tries) await Bun.sleep(20_000);
	}
	console.error(
		`timeout: ${crate}@${version} not fully published after ${tries} tries`,
	);
	return 1;
}

if (import.meta.main) process.exit(await main());
