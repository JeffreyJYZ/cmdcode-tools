// Extracts Command Code's model-category + plan-gating tables from the installed
// CLI bundle (cli.mjs) and writes core/gating.json (consumed by cmduse-core's
// build.rs and the opencode plugin). Run from the repo root via
// `bun run extract` after every Command Code release that changes the catalog.
//
// ponytail: regex-scrapes a minified bundle — breaks if Command Code renames the
// Fr/Ur/Sr/wr minified vars; upgrade path is pinning a documented endpoint when
// one ships, or re-locating the literals by their stable string anchors below.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Version of the Command Code CLI the tables were scraped from. */
function cliVersion(cliPath: string): string {
	try {
		const pkg = JSON.parse(readFileSync(join(dirname(cliPath), "..", "package.json"), "utf8"));
		return typeof pkg.version === "string" ? pkg.version : "unknown";
	} catch {
		return "unknown";
	}
}

function findCliMjs(): string {
	const roots = [
		join(homedir(), "Library/pnpm"),
		"/usr/lib/node_modules",
		"/usr/local/lib/node_modules",
		join(homedir(), ".npm-global"),
		join(homedir(), ".bun/install/global/node_modules"),
	];
	for (const root of roots) {
		let p = join(root, "command-code/dist/cli.mjs");
		try {
			readFileSync(p);
			return p;
		} catch {}
		// pnpm store layout
		try {
			const links = join(root, "store/v11/links/@/command-code");
			for (const ver of readdirSync(links)) {
				for (const hash of readdirSync(join(links, ver))) {
					p = join(links, ver, hash, "node_modules/command-code/dist/cli.mjs");
					try {
						readFileSync(p);
						return p;
					} catch {}
				}
			}
		} catch {}
	}
	throw new Error("cli.mjs not found — install Command Code CLI (npm i -g command-code)");
}

/**
 * The CLI bundle to scrape. Published wins over a local install: a machine can
 * easily have an old global CLI (this one had 1.38.2 while 1.65.0 was
 * published), and the snapshot is consumed by both the plugin and cmduse-core,
 * so it must reflect the newest catalog Command Code ships. A local install is
 * the fallback for offline regeneration.
 */
async function loadCliMjs(): Promise<{ src: string; version: string }> {
	try {
		return await fetchPublished();
	} catch (error) {
		console.warn(`[extract-gating] published bundle unavailable (${(error as Error).message}); falling back to a local install`);
	}
	const local = findCliMjs();
	console.log(`[extract-gating] using local ${local}`);
	return { src: readFileSync(local, "utf8"), version: cliVersion(local) };
}

/**
 * Sources for the published bundle, in preference order:
 *
 *  1. the registry tarball — the exact bytes `npm install` gets, and the only
 *     source that has never lied (CDNs have: unpkg 500'd on 1.65.2, and
 *     jsdelivr served a *truncated* cli.mjs that still passed the cheap
 *     sanity check, so the scrape failed on anchors that upstream has);
 *  2. unpkg, then jsdelivr, for when the registry is unreachable.
 */
const CDNS = [
	(version: string) => `https://unpkg.com/command-code@${version}/dist/cli.mjs`,
	(version: string) => `https://cdn.jsdelivr.net/npm/command-code@${version}/dist/cli.mjs`,
];

/** One member of the published package, from the tarball first then the CDNs. */
async function publishedMember(version: string, member: string, cdn?: (base: string, v: string) => string): Promise<string> {
	try {
		const dir = mkdtempSync(join(tmpdir(), "cc-pkg-"));
		const file = join(dir, "p.tgz");
		const response = await fetch(`https://registry.npmjs.org/command-code/-/command-code-${version}.tgz`);
		if (!response.ok) throw new Error(`tarball ${response.status}`);
		writeFileSync(file, Buffer.from(await response.arrayBuffer()));
		const tar = Bun.spawnSync(["tar", "-xzOf", file, `package/${member}`]);
		if (tar.exitCode === 0) {
			const body = tar.stdout.toString();
			if (body.length > 0) {
				console.log(`[extract] ${member} from the registry tarball (${body.length} bytes)`);
				return body;
			}
		}
		throw new Error(`tar failed for ${member}`);
	} catch (error) {
		console.warn(`[extract] tarball unavailable (${(error as Error).message}); trying CDNs`);
	}
	let last = "";
	for (const cdnBase of CDNS) {
		const url = cdn ? cdn(cdnBase, version) : `${cdnBase}/command-code@${version}/${member}`;
		const response = await fetch(url).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }));
		const body = response.ok ? await response.text() : "";
		if (body.length > 0) {
			console.warn(`[extract] ${member} from ${new URL(url).host} (${body.length} bytes)`);
			return body;
		}
		last = `${new URL(url).host} -> ${response.status}`;
	}
	throw new Error(`no source served ${member} (${last})`);
}

async function fetchPublished(): Promise<{ src: string; version: string }> {
	const meta = (await (await fetch("https://registry.npmjs.org/command-code/latest")).json()) as {
		version?: string;
	};
	const version = meta.version;
	if (!version) throw new Error("no command-code version at registry.npmjs.org");
	const src = await publishedMember(version, "dist/cli.mjs");
	return { src, version };
}

const { src, version: cliVersionUsed } = await loadCliMjs();

/** The `{...}` literal that follows `anchor`, brace-matched so nested objects
 * (and braces inside strings) can't cut it short. */
function objectLiteralAfter(anchor: string): string {
	const at = src.indexOf(anchor);
	if (at < 0) throw new Error(`anchor not found: ${anchor}`);
	const open = at + anchor.length - 1;
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'") {
			const quote = ch;
			for (i++; i < src.length && src[i] !== quote; i++) if (src[i] === "\\") i++;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) return src.slice(open, i + 1);
	}
	throw new Error(`unterminated literal after ${anchor}`);
}

/** A `new Set(["...", ...])` literal, given its prefix and terminator. */
function setLiteralAfter(prefix: string, suffix: string): string {
	const at = src.indexOf(prefix);
	if (at < 0) throw new Error(`anchor not found: ${prefix}`);
	const end = src.indexOf(suffix, at);
	if (end < 0) throw new Error(`end anchor not found: ${suffix}`);
	return src.slice(at + prefix.length, end);
}

// --- resolve minified identifier values (aliases can shift between releases) ---
const varRe =
	/\b([A-Za-z_$][\w$]*)="(premium|opensource|anthropic|vercel-ai-gateway|openrouter|openai)"/g;
const vars = new Map<string, string>();
for (const m of src.matchAll(varRe)) vars.set(m[1]!, m[2]!);

const lit = (id: string | undefined, fallback: string): string => (id && vars.get(id)) || fallback;

/**
 * Bundled releases rename their minified helpers (1.66 moved every anchor the
 * old scrape used: Fr/Ur/Sr/wr -> qr/Yr/Cr/Er and the record factories
 * $r/_r -> zr/Kr; 1.74 moved them again: qr/Yr/Er/$r/_r -> vr/Cr/Yo/Sr/wr,
 * while the known set moved to `qo`). Each generation lists its own anchors;
 * the first that matches wins, so a refresh keeps working across a rename
 * instead of silently writing a stale file. A bundle matching none fails loud.
 */
const GENERATIONS = [
	{
		label: "1.74+",
		categories: "vr={",
		plans: "Cr={",
		known: ['qo=new Set(["', "])"] as const,
		aliases: "Yo={",
		premium: /\bSr\(([A-Za-z_$][\w$]*)\)/g,
		oss: /\bwr\(\)/g,
	},
	{
		label: "1.66-1.73",
		categories: "qr={",
		plans: "Yr={",
		known: ['Cr=new Set(["', "])"] as const,
		aliases: "Er={",
		premium: /\bzr\(([A-Za-z_$][\w$]*)\)/g,
		oss: /\bKr\(\)/g,
	},
	{
		label: "<=1.65",
		categories: "Fr={",
		plans: "Ur={",
		known: ['Sr=new Set(["', "])"] as const,
		aliases: "wr={",
		premium: /\$r\(([A-Za-z_$][\w$]*)\)/g,
		oss: /_r\(\)/g,
	},
];
const generation = GENERATIONS.find((g) => src.includes(g.categories));
if (!generation) throw new Error("unrecognized bundle generation — the scrape needs re-anchoring");
console.log(`[extract-gating] bundle generation: ${generation.label}`);

function expand(expr: string): string {
	// The record factories always mean the same two shapes; only their minified
	// names move between releases.
	return expr
		.replace(
			generation.premium,
			(_, id: string) => `{provider:"${lit(id, "anthropic")}",category:"premium"}`,
		)
		.replace(generation.oss, `{provider:"cai",category:"opensource"}`)
		.replace(/category:([A-Za-z_$][\w$]*)/g, (_, id) => `category:"${lit(id, "opensource")}"`)
		.replace(/provider:([A-Za-z_$][\w$]*)/g, (_, id) => `provider:"${lit(id, "openai")}"`)
		.replace(
			/allowedCategories:\[([^\]]*)\]/g,
			(_, inner: string) =>
				`allowedCategories:[${[...inner.matchAll(/([A-Za-z_$][\w$]*)/g)].map((v) => `"${lit(v[1], "opensource")}"`).join(",")}]`,
		);
}

// --- category table ---
// getModelCategory looks the table up DIRECTLY (no canonicalization), so keys
// are raw model ids.
const categories: Record<string, string> = {};
for (const m of expand(objectLiteralAfter(generation.categories)).matchAll(
	/"([^"]+)":\{provider:"[^"]*",category:"([^"]+)"\}/g,
)) {
	categories[m[1]!] = m[2]!;
}

// --- plan table: { "<planId>": {allowedCategories, blockedModels?} } ---
// Newer bundles hoist a shared `blockedModels` array into a variable and
// reference it (`blockedModels:kr=[...]` on one plan, `blockedModels:kr` on
// another); inline both forms or those plans drop out of the match entirely.
const arrayVars = new Map<string, string>();
for (const m of src.matchAll(/([A-Za-z_$][\w$]*)=(\["[^[\]]*"\])/g)) {
	arrayVars.set(m[1]!, m[2]!);
}
const plansLiteral = objectLiteralAfter(generation.plans)
	.replace(/blockedModels:([A-Za-z_$][\w$]*)=\[/g, "blockedModels:[")
	.replace(
		/blockedModels:([A-Za-z_$][\w$]*)(?![\w$])/g,
		(all, id: string) =>
			arrayVars.has(id) ? `blockedModels:${arrayVars.get(id)}` : all,
	);
const plans: Record<string, { allowedCategories: string[]; blockedModels: string[] }> = {};
for (const m of expand(plansLiteral).matchAll(
	/"(individual-[a-z0-9-]+|teams-[a-z0-9-]+)":\{allowedCategories:\[([^\]]*)\](,blockedModels:\[([^\]]*)\])?\}/g,
)) {
	const cats = [...m[2]!.matchAll(/"([a-z]+)"/g)].map((c) => c[1]!);
	const blocked = m[4] ? [...m[4]!.matchAll(/"([^"]+)"/g)].map((b) => b[1]!) : [];
	plans[m[1]!] = { allowedCategories: cats, blockedModels: blocked };
}

// --- known model ids: the Set literal, unioned with the category table keys ---
// ponytail: the Set alone misses models whose spec entries come from spread
// arrays; the union is cheap and order-independent.
const knownFromSet = [...setLiteralAfter(...generation.known).matchAll(/"([a-z][^"]*)"/g)]
	.filter((m) => m[1]!.length > 2)
	.map((m) => m[1]!);
const known = [...new Set([...knownFromSet, ...Object.keys(categories)])];

// --- deprecated aliases: { old: new } ---
const aliases: Record<string, string> = {};
for (const m of objectLiteralAfter(generation.aliases).matchAll(/"([^"]+)":"([^"]+)"/g)) {
	aliases[m[1]!] = m[2]!;
}

// Models the API hard-blocks (403 MODEL_NOT_IN_PLAN) per plan, beyond the
// category rules. NOT in the bundle (the CLI tracks category via serving lane,
// not per-model entitlements) — probed empirically, maintain by hand here.
const hardBlocked: Record<string, string[]> = {
	"individual-goat": [
		"meta/muse-spark-1.1",
		"google/gemini-3.5-flash",
		"google/gemini-3.6-flash",
		"google/gemini-3.5-flash-lite",
		"google/gemini-3.1-flash-lite",
	],
	"individual-go": [
		"meta/muse-spark-1.1",
		"google/gemini-3.5-flash",
		"google/gemini-3.6-flash",
		"google/gemini-3.5-flash-lite",
		"google/gemini-3.1-flash-lite",
		"meta/muse-spark-1.2",
		"meta/muse-spark-1.2-contributor",
		"meta/muse-spark-1.3",
		"meta/muse-spark-1.3-contributor",
	],
};

// Single source for the gating data, consumed by the opencode plugin (import)
// and cmduse-core's build.rs (Rust CLI). src/gating.ts is a thin typed loader.
// extractedAt/cliVersion let consumers warn when the snapshot goes stale.
const out = {
	extractedAt: new Date().toISOString(),
	cliVersion: cliVersionUsed,
	categories,
	plans,
	knownModels: known,
	aliases,
	hardBlocked,
};
writeFileSync(
	new URL("../core/gating.json", import.meta.url),
	JSON.stringify(out, null, "\t") + "\n",
);
console.log(
	`wrote core/gating.json: ${Object.keys(categories).length} categories, ${Object.keys(plans).length} plans, ${known.length} known models, ${Object.keys(aliases).length} aliases`,
);
