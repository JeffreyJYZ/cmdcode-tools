/**
 * Session bindings — the one piece of shared state. Both halves run in
 * different processes, so they meet on the filesystem: the TUI writes, the
 * server reads (through a short mtime cache). The file is a plain map from
 * session id to an array of absolute directory paths:
 *
 *   { "ses_abc": ["/Users/me/other-project", "/Users/me/shared"] }
 *
 * Bindings are durable — they survive restarts and are never cleared at
 * startup — and they are strictly per session: the server only ever consults
 * the entry for the session the request belongs to.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Read `HOME` per call so tests can point it at a temp directory. */
const home = (): string => process.env.HOME ?? homedir();

export function stateDir(): string {
	const base = process.env.XDG_DATA_HOME ?? join(home(), ".local", "share");
	return join(base, "opencode", "session-dir");
}

export function bindingsFile(): string {
	return join(stateDir(), "bindings.json");
}

export type Bindings = Record<string, string[]>;

function isBindings(value: unknown): value is Bindings {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	return Object.entries(value).every(
		([key, list]) =>
			typeof key === "string" &&
			Array.isArray(list) &&
			list.every((entry) => typeof entry === "string"),
	);
}

export function readBindings(): Bindings {
	try {
		const parsed: unknown = JSON.parse(readFileSync(bindingsFile(), "utf8"));
		return isBindings(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function writeBindings(bindings: Bindings): void {
	mkdirSync(stateDir(), { recursive: true });
	writeFileSync(bindingsFile(), `${JSON.stringify(bindings, null, "\t")}\n`);
	invalidateCache();
}

// The TUI writes; the server reads. A short TTL plus an mtime check keeps the
// server's view fresh without stat-ing on every single permission check.
let cached: Bindings | undefined;
let cachedMtime = 0;
let lastCheck = 0;
const CACHE_TTL_MS = 500;

export function freshBindings(): Bindings {
	const now = Date.now();
	if (cached && now - lastCheck < CACHE_TTL_MS) return cached;
	lastCheck = now;

	let mtime = 0;
	try {
		mtime = statSync(bindingsFile()).mtimeMs;
	} catch {
		// missing file: treat as empty
	}
	if (cached && mtime === cachedMtime) return cached;

	cachedMtime = mtime;
	cached = readBindings();
	return cached;
}

export function invalidateCache(): void {
	cached = undefined;
	cachedMtime = 0;
	lastCheck = 0;
}

/** Directories bound to one session; empty when none. */
export function bindingsFor(sessionID: string): string[] {
	return freshBindings()[sessionID] ?? [];
}

/** Binds a directory to a session. Returns false when it was already bound. */
export function addBinding(sessionID: string, dir: string): boolean {
	const bindings = readBindings();
	const list = bindings[sessionID] ?? [];
	if (list.includes(dir)) return false;
	bindings[sessionID] = [...list, dir].sort();
	writeBindings(bindings);
	return true;
}

/** Removes a binding. Returns false when the pair was not present. */
export function removeBinding(sessionID: string, dir: string): boolean {
	const bindings = readBindings();
	const list = bindings[sessionID] ?? [];
	if (!list.includes(dir)) return false;
	const next = list.filter((entry) => entry !== dir);
	if (next.length > 0) bindings[sessionID] = next;
	else delete bindings[sessionID];
	writeBindings(bindings);
	return true;
}

export function expandHome(path: string): string {
	if (path === "~") return home();
	if (path.startsWith("~/")) return join(home(), path.slice(2));
	return path;
}

/** True when `child` is `parent` itself or lives beneath it. */
export function isChildOf(parent: string, child: string): boolean {
	if (child === parent) return true;
	const prefix = parent.endsWith("/") ? parent : `${parent}/`;
	return child.startsWith(prefix);
}

/** True when `path` is under any of `dirs`. */
export function isUnderAny(dirs: string[], path: string): boolean {
	return dirs.some((dir) => isChildOf(dir, path));
}

/** Whether a filesystem path exists and is a directory. */
export function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export { existsSync };
