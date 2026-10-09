// Crate release verifier: the Rust/tap counterpart of verify-release.ts.
//
// Two links have to hold after `cargo publish`:
//   1. registry  <- crate    the served .crate matches what this checkout packs
//   2. formula   <- its source the tap's url/sha256 point at exactly those bytes
//
// Link 2 has two shapes and both are checked:
//   - crate formula:   url ends `.crate`; the pin's sha256 must equal the served
//                      crate's bytes (what a from-source tap does).
//   - release-asset:   urls point at `.../releases/download/<tag>/<asset>.tar.gz`
//                      (what the real cmduse tap does); each pinned sha256 must
//                      equal that asset's line in the release `SHA256SUMS`.
// A pin that disagrees with what actually ships means brew installs other bytes
// than the release published — exactly the failure this exists to catch.
//
// `cargo package` is byte-reproducible (same tree, same version, same sha256),
// so link 1 is a plain hash comparison. It also catches the failure that bit us
// by hand: a *stale* local pack — one made before the last source edit —
// silently disagreeing with what actually shipped.
//
//   bun scripts/verify-crate.ts [version] [--crate <name>] [--formula <path>]
//                               [--expected <sha256>] [--tries N] [--no-pack]
//
// Without a version it uses cmduse/Cargo.toml, which is the release-in-progress.
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

/** A single url+sha256 the formula pins (release shape has several). */
export interface ReleaseAsset {
	url: string;
	file: string;
	version?: string;
	sha256?: string;
}

export type FormulaShape = "release" | "crate" | "unknown";

export interface FormulaPin {
	shape: FormulaShape;
	path: string;
	/** Crate shape's url version + first pin (kept for single-pin formulas). */
	urlVersion?: string;
	sha256?: string;
	/** Every url+sha256 in the formula, in source order. */
	assets: ReleaseAsset[];
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Version from a `version = "x.y.z"` line, as Cargo manifests write it. */
export function manifestVersion(text: string): string | undefined {
	return text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
}

/** Which of the two formula shapes the url set is (first match wins). */
export function formulaShape(urls: string[]): FormulaShape {
	if (
		urls.some(
			(u) => u.includes("/releases/download/") && u.endsWith(".tar.gz"),
		)
	)
		return "release";
	if (urls.some((u) => u.endsWith(".crate"))) return "crate";
	return "unknown";
}

/** One pinned asset: file name from the url, version from the tag or the name. */
export function assetFrom(url: string, sha256?: string): ReleaseAsset {
	const file = url.split("/").pop()?.split("?")[0] ?? "";
	const tag = url.match(/-v?(\d+\.\d+\.\d+)\//)?.[1];
	const version = tag ?? file.match(/-(\d+\.\d+\.\d+)-/)?.[1];
	return { url, file, version, sha256 };
}

/** Parse every url + its following sha256 out of a Homebrew formula. */
export function formulaPin(
	text: string,
	path = "Formula/cmduse.rb",
): FormulaPin {
	const urls = [...text.matchAll(/^\s*url\s+"([^"]+)"/gm)].map(
		(m) => m[1] ?? "",
	);
	const shas = [...text.matchAll(/^\s*sha256\s+"([0-9a-f]{64})"/gm)].map(
		(m) => m[1] ?? "",
	);
	return {
		shape: formulaShape(urls),
		path,
		urlVersion: urls[0]?.match(/-(\d+\.\d+\.\d+)\.crate$/)?.[1],
		sha256: shas[0],
		assets: urls.map((url, i) => assetFrom(url, shas[i])),
	};
}

/** `SHA256SUMS` line format: `<sha256>  <file>` (an optional `*`/`./` tolerated). */
export function parseSums(text: string): Record<string, string> {
	const sums: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/);
		const [, sha, file] = m ?? [];
		if (sha && file) sums[file.replace(/^\.\//, "")] = sha;
	}
	return sums;
}

/** The release `SHA256SUMS` url for a github release download url. */
export function sumsUrl(url: string): string | undefined {
	const m = url.match(
		/^(https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+)\//,
	);
	return m ? `${m[1]}/SHA256SUMS` : undefined;
}

export interface AssetVerdict {
	file: string;
	status: "MATCH" | "MISMATCH" | "no-sums" | "no-pin";
	pinned?: string;
	sums?: string;
}

/** Compare every pinned asset against its `SHA256SUMS` entry. */
export function compareAssets(
	assets: ReleaseAsset[],
	sums: Record<string, string>,
): AssetVerdict[] {
	return assets.map((a) => {
		const sum = sums[a.file];
		if (!a.sha256) return { file: a.file, status: "no-pin" as const };
		if (!sum)
			return {
				file: a.file,
				pinned: a.sha256,
				status: "no-sums" as const,
			};
		return {
			file: a.file,
			pinned: a.sha256,
			sums: sum,
			status:
				sum === a.sha256 ? ("MATCH" as const) : ("MISMATCH" as const),
		};
	});
}

/** One line per asset verdict, matching the script's one-line style. */
export function assetLine(v: AssetVerdict): string {
	const sha = v.pinned ? ` sha256=${v.pinned.slice(0, 12)}…` : "";
	return `asset ${v.file} ${v.status}${sha}`;
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
		console.error(
			`no crate at ${file.name} — is the manifest at ${version}?`,
		);
		return undefined;
	}
	return sha256Hex(new Uint8Array(await file.arrayBuffer()));
}

/** Link 2. Release shape checks against SHA256SUMS; crate shape against the crate. */
async function verifyFormula(
	version: string,
	formula: FormulaPin,
	crateSha256: string,
): Promise<number> {
	if (formula.shape === "release") {
		const wrong = formula.assets.filter(
			(a) => a.version !== undefined && a.version !== version,
		);
		for (const a of wrong)
			console.error(
				`asset ${a.file} pins version ${a.version}, not ${version}`,
			);
		const url = sumsUrl(formula.assets[0]?.url ?? "");
		if (!url) {
			console.error(
				`formula urls are not github release downloads (${formula.path})`,
			);
			return 1;
		}
		const response = await fetch(url).catch(() => undefined);
		if (response?.status !== 200) {
			console.error(
				`SHA256SUMS ${url} -> ${response?.status ?? 0} (release not published?)`,
			);
			return 1;
		}
		const verdicts = compareAssets(
			formula.assets,
			parseSums(await response.text()),
		);
		for (const v of verdicts) console.log(assetLine(v));
		const bad = verdicts.filter((v) => v.status !== "MATCH");
		if (wrong.length || bad.length) {
			console.error(
				`formula pins disagree with ${url} — brew would install other bytes`,
			);
			return 1;
		}
		console.log(
			`formula pins ${formula.assets.length} release assets matching ${version} (${formula.path})`,
		);
		return 0;
	}
	// crate / unknown: the original behaviour, kept intact.
	if (formula.urlVersion !== version) {
		console.error(
			`formula pins ${formula.urlVersion ?? "no version"}, not ${version} (${formula.path})`,
		);
		return 1;
	}
	if (formula.sha256 !== crateSha256) {
		console.error(
			`formula sha256 ${formula.sha256?.slice(0, 12)}… does not match the served crate — brew would fail or install other bytes`,
		);
		return 1;
	}
	console.log(
		`formula pins ${version} and the served bytes (${formula.path})`,
	);
	return 0;
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const crate = value("--crate") ?? PKG;
	const manifest = (await Bun.file(
		join(REPO, "cmduse/Cargo.toml"),
	).text()) as string;
	const explicit = args.find((a) => !a.startsWith("--") && /^\d/.test(a));
	const version = explicit ?? manifestVersion(manifest);
	if (!version) {
		console.error(
			"usage: bun scripts/verify-crate.ts [version] [--crate <name>] [--formula <path>] [--expected <sha256>] [--tries N] [--no-pack]",
		);
		return 2;
	}
	const expected =
		value("--expected") ??
		(args.includes("--no-pack")
			? undefined
			: await packLocalSha256(version));
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
			const sha256 = sha256Hex(
				new Uint8Array(await response.arrayBuffer()),
			);
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
			const code = await verifyFormula(version, formula, sha256);
			if (code !== 0) return code;
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
