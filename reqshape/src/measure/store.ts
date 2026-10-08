import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasV2, type RawMessage, readLegacy, readV2, text } from "./rows.ts";

/** Default location of opencode's store. */
export function defaultStorePath(): string {
	if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
	const base =
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(base, "opencode", "opencode.db");
}

export interface SessionRow {
	child: boolean;
	directory: string;
}

export interface Store {
	layout: "v2" | "legacy";
	sessions: Map<string, SessionRow>;
	messages: RawMessage[];
}

/**
 * opencode v2 appends to `session_message` and stopped writing the legacy
 * `message` table at the migration, so both layouts are read here. Read-only:
 * a running opencode is untouched.
 */
export function readStore(path: string): Store {
	let db: Database;
	try {
		db = new Database(path, { readonly: true });
	} catch {
		throw new Error(`no opencode store at ${path}`);
	}
	try {
		const v2 = hasV2(db);
		return {
			layout: v2 ? "v2" : "legacy",
			sessions: readSessions(db),
			messages: v2 ? readV2(db) : readLegacy(db),
		};
	} catch (error) {
		throw new Error(
			`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		db.close();
	}
}

/**
 * Session metadata moved to its own typed table in v2, while `session` still
 * holds rows from before the migration — only reading both attributes every
 * session, and this session's own directory lives in the v2 table alone. v2
 * wins on a collision. Directories and subagent flags are context rather than
 * the point: a store with neither table still profiles.
 */
function readSessions(db: Database): Map<string, SessionRow> {
	const sessions = new Map<string, SessionRow>();
	for (const table of ["session", "session_v2"] as const) {
		for (const row of readSessionTable(db, table)) {
			if (!row.id) continue;
			sessions.set(row.id, {
				child: Boolean(row.parent_id),
				directory: text(row.directory),
			});
		}
	}
	return sessions;
}

function readSessionTable(
	db: Database,
	table: "session" | "session_v2",
): Array<{
	id?: string;
	parent_id?: string | null;
	directory?: string | null;
}> {
	try {
		return db
			.query(`SELECT id, parent_id, directory FROM ${table}`)
			.all() as Array<{
			id?: string;
			parent_id?: string | null;
			directory?: string | null;
		}>;
	} catch {
		return [];
	}
}
