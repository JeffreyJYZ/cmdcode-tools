#!/usr/bin/env bun
/**
 * Link integrity check for the built static export (`out/`).
 *
 * Internal links (root-relative, `href="/…"`) MUST resolve to a real file in
 * `out/` — clean URLs included (`/docs/mpc` → `out/docs/mpc.html` or
 * `out/docs/mpc/index.html`). A broken internal link fails the run.
 *
 * External links (`http(s)://…`) are HEAD-checked and reported, but NEVER fail
 * the run: CI has network variance and a flaky remote must not redden a build.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const OUT = join(import.meta.dir, "..", "out");
const EXTERNAL_CONCURRENCY = 8;
const EXTERNAL_TIMEOUT_MS = 10_000;

type Found = { href: string; source: string };

/** Recursively collect every `.html` file under `dir`. */
async function htmlFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await htmlFiles(path)));
		} else if (entry.name.endsWith(".html")) {
			files.push(path);
		}
	}
	return files;
}

/** Extract raw `href="…"` / `href='…'` values from an HTML document. */
function hrefs(html: string): string[] {
	const found: string[] = [];
	const re = /href\s*=\s*("([^"]*)"|'([^']*)')/gi;
	for (const match of html.matchAll(re)) {
		const value = match[2] ?? match[3] ?? "";
		if (value) found.push(value);
	}
	return found;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve a root-relative path against the export, accounting for clean URLs.
 * Returns the file that satisfies it, or `null` when nothing matches.
 */
async function resolveInternal(pathname: string): Promise<string | null> {
	let path: string;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		path = pathname;
	}
	path = path.split("?")[0].split("#")[0];
	if (path === "" || path === "/") path = "/index.html";
	const rel = path.replace(/^\/+/, "");
	const candidates = path.endsWith("/")
		? [join(OUT, rel, "index.html")]
		: [
				join(OUT, rel), // static asset, or explicit .html/.xml
				join(OUT, `${rel}.html`), // clean URL → file
				join(OUT, rel, "index.html"), // clean URL → directory index
			];
	for (const candidate of candidates) {
		if (await isFile(candidate)) return candidate;
	}
	return null;
}

async function headCheck(url: string): Promise<number | "error"> {
	const attempt = async (method: "HEAD" | "GET") => {
		const res = await fetch(url, {
			method,
			redirect: "follow",
			signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
		});
		return res.status;
	};
	try {
		const status = await attempt("HEAD");
		if (status === 405 || status === 501) return await attempt("GET");
		return status;
	} catch {
		return "error";
	}
}

async function main() {
	const files = (await htmlFiles(OUT)).sort();
	const internal = new Map<string, string>(); // href -> first source file
	const external = new Map<string, string>();
	for (const file of files) {
		const source = relative(process.cwd(), file);
		for (const raw of hrefs(await readFile(file, "utf8"))) {
			if (raw.startsWith("#")) continue; // same-page anchor
			if (raw.startsWith("/")) {
				if (!internal.has(raw)) internal.set(raw, source);
				continue;
			}
			if (/^https?:\/\//i.test(raw)) {
				if (!external.has(raw)) external.set(raw, source);
			}
			// other schemes (mailto:, tel:, …) and relative links: ignored
		}
	}

	// Internal: must resolve inside out/.
	const broken: Found[] = [];
	for (const [href, source] of internal) {
		if (!(await resolveInternal(href))) broken.push({ href, source });
	}

	// External: HEAD-check and report only.
	const urls = [...external.keys()];
	const results = new Map<string, number | "error">();
	let cursor = 0;
	await Promise.all(
		Array.from(
			{ length: Math.min(EXTERNAL_CONCURRENCY, urls.length) },
			async () => {
				while (cursor < urls.length) {
					const url = urls[cursor++];
					results.set(url, await headCheck(url));
				}
			},
		),
	);
	const externalOk = urls.filter((url) => {
		const status = results.get(url);
		return typeof status === "number" && status >= 200 && status < 400;
	});
	const externalBad = urls.filter((url) => !externalOk.includes(url));

	console.log(`check-links: scanned ${files.length} html files under out/`);
	console.log(
		`\ninternal (must resolve — failures fail the run): ${internal.size} unique, ${internal.size - broken.length} ok, ${broken.length} broken`,
	);
	for (const { href, source } of broken) {
		console.log(`  ✗ ${href}  (from ${source})`);
	}
	console.log(
		`\nexternal (reported only — never fails the run): ${urls.length} unique, ${externalOk.length} ok, ${externalBad.length} unreachable`,
	);
	for (const url of externalBad) {
		const status = results.get(url);
		console.log(
			`  ✗ ${url}  (${status === "error" ? "network error" : status})`,
		);
	}

	if (broken.length > 0) {
		console.error(
			`\ncheck-links: ${broken.length} broken internal link(s)`,
		);
		process.exit(1);
	}
	console.log("\ncheck-links: all internal links resolve ✓");
}

await main();
