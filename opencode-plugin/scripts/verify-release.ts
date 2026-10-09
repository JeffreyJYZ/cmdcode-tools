// Verify a published plugin release before trusting it.
//
//   bun scripts/verify-release.ts 0.3.3                       # latest check
//   bun scripts/verify-release.ts 0.3.3 --expected <sha1>    # compare to a local npm pack
//   bun scripts/verify-release.ts 0.3.3 --tries 3            # short poll (default 40 x 20s)
//   bun scripts/verify-release.ts 0.1.2 --dir oc-cmd-compare # any npm package in the repo
//
// A successful `npm publish` is asynchronous in two stages: the packument
// (dist-tags.latest + versions[<v>]) updates about a minute in, and the tarball
// URL starts serving several minutes later. During the gap `latest` can point at
// a version whose tarball still 404s — installing then yields nothing (that is
// what burned 0.2.4). This script polls until both are true, then checks the
// served bytes.
//
// Without --dir the target is this script's own package
// (@jeffreyjyz/opencode-command-code). --dir <path> is absolute or relative to
// the repo root; name + local version come from that dir's package.json and
// `npm pack` runs there — so the tool covers every npm package in the monorepo
// (oc-cmd-compare, reqshape), not just the plugin.
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";

const PKG = "@jeffreyjyz/opencode-command-code";
const REGISTRY = "https://registry.npmjs.org";
/** This package's own dir — the default target when no --dir is given. */
const PACKAGE_DIR = new URL("..", import.meta.url).pathname;
/** Monorepo root, the base for a relative --dir. */
const REPO = new URL("../../", import.meta.url).pathname;

export interface ReleaseFacts {
	latest: string;
	versionPresent: boolean;
	tarballUrl: string;
}

/** The conventional scoped tarball path, when the packument omits dist.tarball. */
export function conventionalTarball(name: string, version: string): string {
	return `${REGISTRY}/${name.replace("/", "%2F")}/-/${name.split("/")[1]}-${version}.tgz`;
}

export function factsFrom(
	packument: unknown,
	version: string,
	name = PKG,
): ReleaseFacts {
	const body = (packument ?? {}) as {
		"dist-tags"?: Record<string, string>;
		versions?: Record<string, { dist?: { tarball?: string } }>;
	};
	return {
		latest: body["dist-tags"]?.latest ?? "(none)",
		versionPresent: Boolean(body.versions?.[version]),
		tarballUrl:
			body.versions?.[version]?.dist?.tarball ??
			conventionalTarball(name, version),
	};
}

/** One verdict line, so CI logs and shells read the same thing. */
export function verdict(
	version: string,
	facts: ReleaseFacts,
	tarballStatus: number,
	sha1?: string,
	expected?: string,
): string {
	const parts = [
		`latest=${facts.latest}`,
		`version=${facts.versionPresent ? "yes" : "no"}`,
		`tarball=${tarballStatus}`,
	];
	if (sha1) parts.push(`sha1=${sha1}`);
	if (expected) parts.push(sha1 === expected ? "MATCH" : "MISMATCH");
	if (facts.latest !== version)
		parts.push(`(latest not yet moved to ${version})`);
	return parts.join(" ");
}

export function sha1Hex(bytes: ArrayBuffer | Uint8Array): string {
	return createHash("sha1")
		.update(new Uint8Array(bytes as ArrayBuffer))
		.digest("hex");
}

/** The version in a package manifest — the one you just published. */
export function localVersion(manifest: {
	version?: string;
}): string | undefined {
	return typeof manifest.version === "string" ? manifest.version : undefined;
}

/** Resolve `--dir` (absolute, or relative to the repo root); default = own dir. */
export function resolveTargetDir(dirArg?: string): string {
	if (!dirArg) return PACKAGE_DIR;
	return isAbsolute(dirArg) ? dirArg : join(REPO, dirArg);
}

/** Name + version of the package in `dir`, read from its package.json. */
export async function readManifest(dir: string): Promise<{
	name?: string;
	version?: string;
}> {
	return (await Bun.file(join(dir, "package.json")).json()) as {
		name?: string;
		version?: string;
	};
}

/** `npm pack` the package in `dir` and return the tarball's sha1. */
async function packLocalShasum(dir: string): Promise<string | undefined> {
	const { mkdtemp } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const dest = await mkdtemp(join(tmpdir(), "verify-pack-"));
	const proc = Bun.spawnSync(["npm", "pack", "--pack-destination", dest], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		console.error(
			`npm pack failed: ${proc.stderr.toString().trim().split("\n").pop() ?? ""}`,
		);
		return undefined;
	}
	const packed = proc.stdout.toString().trim().split("\n").pop() ?? "";
	return sha1Hex(await Bun.file(join(dest, packed)).arrayBuffer());
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const dir = resolveTargetDir(value("--dir"));
	const manifest = await readManifest(dir);
	const name = manifest.name ?? PKG;
	const encoded = name.replace("/", "%2F");
	// Flags that take a value must not have it mistaken for the version.
	const valueFlags = new Set(["--expected", "--tries", "--dir"]);
	let explicitVersion: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (valueFlags.has(arg)) {
			i++;
			continue;
		}
		if (!arg.startsWith("--")) explicitVersion = arg;
	}
	const version = explicitVersion ?? localVersion(manifest);
	if (!version) {
		console.error(
			"usage: bun scripts/verify-release.ts [version] [--dir <path>] [--expected <sha1>] [--tries N] [--no-pack]",
		);
		return 2;
	}
	if (!explicitVersion)
		console.log(`no version given; using package.json (${version})`);
	// Default: pack the target dir and compare — the publish-time shasum, no copy-paste.
	const expected =
		value("--expected") ??
		(args.includes("--no-pack") ? undefined : await packLocalShasum(dir));
	if (expected)
		console.log(
			`expected sha1: ${expected}${value("--expected") ? " (supplied)" : " (local npm pack)"}`,
		);
	const tries = Number(value("--tries") ?? 40);

	for (let i = 1; i <= tries; i++) {
		const packument = await fetch(`${REGISTRY}/${encoded}`)
			.then((r) => r.json())
			.catch(() => undefined);
		const facts = factsFrom(packument, version, name);
		const response = await fetch(facts.tarballUrl).catch(() => undefined);
		const status = response?.status ?? 0;
		if (facts.versionPresent && status === 200 && response) {
			const sha1 = sha1Hex(await response.arrayBuffer());
			const tarballVersion = await versionFromTarball(
				await (await fetch(facts.tarballUrl)).arrayBuffer(),
			);
			console.log(verdict(version, facts, status, sha1, expected));
			if (tarballVersion && tarballVersion !== version) {
				console.error(
					`tarball package.json says ${tarballVersion}, not ${version}`,
				);
				return 1;
			}
			if (expected && sha1 !== expected) {
				console.error(
					"served bytes do not match the local pack — do not install",
				);
				return 1;
			}
			console.log(`verified ${name}@${version}`);
			return 0;
		}
		console.log(`try=${i} ${verdict(version, facts, status)}`);
		if (i < tries) await Bun.sleep(20_000);
	}
	console.error(
		`timeout: ${name}@${version} not fully published after ${tries} tries`,
	);
	return 1;
}

/** `package/package.json` inside the tarball, without unpacking the whole thing. */
async function versionFromTarball(
	bytes: ArrayBuffer,
): Promise<string | undefined> {
	try {
		const { mkdtemp, writeFile, readFile } = await import(
			"node:fs/promises"
		);
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "verify-release-"));
		const file = join(dir, "p.tgz");
		await writeFile(file, Buffer.from(bytes));
		const tar = Bun.spawnSync([
			"tar",
			"xzf",
			file,
			"-C",
			dir,
			"package/package.json",
		]);
		if (tar.exitCode !== 0) return undefined;
		const pkg = JSON.parse(
			await readFile(join(dir, "package", "package.json"), "utf8"),
		) as { version?: string };
		return pkg.version;
	} catch {
		return undefined;
	}
}

if (import.meta.main) process.exit(await main());
