import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Key resolution order, most likely current first:
// 1. CMD_API_KEY env override (multi-account/testing, mirrors cmduse)
// 2. opencode's credential store — where /connect writes, active row first
// 3. opencode's legacy v1 auth.json
// 4. Command Code CLI's auth.json (user logged in via `cmd login`)
// 5. the host's auth hook, when one is supplied
//
// The store outranks both files because a re-connect leaves them on the key it
// replaced: reading the files alone is what surfaced
// "Invalid 'Authorization' header or token" on an account whose inference was
// fine. `candidateKeys` returns every key it can find so a refused one costs a
// single request, not a broken provider.

/** Providers opencode may hold the Command Code key under: v2's integration
 * id and the v1 provider id. */
const STORE_PROVIDERS = ["commandcode", "command-code"];

type StoredRow = { key: string; provider: string; active: number; updated: number };

/** `$HOME` per call, so a test (or a shell) can point the lookup elsewhere;
 * `os.homedir()` alone answers from the passwd entry. */
function home(): string {
	return process.env.HOME ?? homedir();
}

/** `$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`. */
function opencodeHome(): string {
	const base = process.env.XDG_DATA_HOME ?? join(home(), ".local", "share");
	return join(base, "opencode");
}

/** Rows of opencode's `credential` table, best first. An absent store, a v1
 * store without the table, or a runtime without `node:sqlite` all read as
 * "no key here" rather than an error: the files below are the fallback. */
async function storeRows(): Promise<StoredRow[]> {
	const path = process.env.OPENCODE_DB ?? join(opencodeHome(), "opencode.db");
	let db: { prepare(sql: string): { all(): unknown[] }; close(): void } | undefined;
	try {
		const sqlite = (await import("node:sqlite")) as unknown as {
			DatabaseSync: new (
				path: string,
				options?: { readOnly?: boolean },
			) => {
				prepare(sql: string): { all(): unknown[] };
				close(): void;
			};
		};
		db = new sqlite.DatabaseSync(path, { readOnly: true });
	} catch {
		return [];
	}
	try {
		const providers = STORE_PROVIDERS.map((p) => `'${p}'`).join(", ");
		const rows = db
			.prepare(
				`SELECT value, integration_id, active, time_updated FROM credential \
                 WHERE integration_id IN (${providers})`,
			)
			.all() as unknown[];
		const out: StoredRow[] = [];
		for (const row of rows) {
			const { value, integration_id, active, time_updated } = row as Record<string, unknown>;
			if (typeof value !== "string" || typeof integration_id !== "string") continue;
			let key: unknown;
			try {
				key = (JSON.parse(value) as { key?: unknown }).key;
			} catch {
				continue;
			}
			if (typeof key !== "string" || key === "") continue;
			out.push({
				key,
				provider: integration_id,
				active: typeof active === "number" ? active : 0,
				updated: typeof time_updated === "number" ? time_updated : 0,
			});
		}
		const rank = (provider: string) => {
			const index = STORE_PROVIDERS.indexOf(provider);
			return index === -1 ? STORE_PROVIDERS.length : index;
		};
		return out.sort(
			(a, b) =>
				b.active - a.active || rank(a.provider) - rank(b.provider) || b.updated - a.updated,
		);
	} catch {
		return [];
	} finally {
		try {
			db?.close();
		} catch {}
	}
}

/** A key out of a JSON file: `${provider}.key` for opencode's file, `apiKey`
 * for the CLI's. */
async function fileKey(path: string): Promise<string[]> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
		const keys: string[] = [];
		for (const provider of STORE_PROVIDERS) {
			const entry = value[provider] as { key?: unknown } | undefined;
			if (typeof entry?.key === "string" && entry.key) keys.push(entry.key);
		}
		if (typeof value.apiKey === "string" && value.apiKey) keys.push(value.apiKey);
		return keys;
	} catch {
		return [];
	}
}

/** Every key this machine can offer, best first, no duplicates. */
export async function candidateKeys(
	getAuth?: () => Promise<{ key: string } | undefined>,
): Promise<string[]> {
	const keys: string[] = [];
	const env = process.env.CMD_API_KEY;
	if (env) keys.push(env);
	for (const row of await storeRows()) keys.push(row.key);
	keys.push(...(await fileKey(join(opencodeHome(), "auth.json"))));
	keys.push(...(await fileKey(join(home(), ".commandcode", "auth.json"))));
	try {
		const auth = await getAuth?.();
		if (auth?.key) keys.push(auth.key);
	} catch {}
	return [...new Set(keys)];
}

export async function resolveKey(
	getAuth?: () => Promise<{ key: string } | undefined>,
): Promise<string> {
	const [first] = await candidateKeys(getAuth);
	if (first) return first;
	throw new Error(
		"No Command Code API key found. Run /connect, choose Command Code, and paste your key (or `cmd login` in a terminal, or set CMD_API_KEY).",
	);
}
