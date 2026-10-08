/**
 * Cross-process request capture.
 *
 * The system prompt and tool definitions are assembled at request time by the
 * server process and never reach the message store, so the TUI cannot see them.
 * The server half measures them in the `session.context` hook and writes only
 * their sizes here (no prompt text — just two numbers); the TUI dialog reads
 * them to complete the breakdown. One small JSON per session.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RequestCapture {
	/** UTF-8 bytes of the assembled system prompt. */
	readonly systemBytes: number;
	/** UTF-8 bytes of the tool definitions (name + description + input schema). */
	readonly toolDefsBytes: number;
	readonly at: number;
}

const directory = (): string =>
	join(
		process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
		"opencode-context",
	);

/** Session ids are filename-safe already; belt and braces for anything else. */
const safeName = (sessionID: string): string =>
	sessionID.replace(/[^A-Za-z0-9._-]/g, "_");

export async function writeCapture(
	sessionID: string,
	capture: RequestCapture,
): Promise<void> {
	try {
		await mkdir(directory(), { recursive: true });
		await writeFile(
			join(directory(), `${safeName(sessionID)}.json`),
			JSON.stringify(capture),
		);
	} catch {
		// A cache miss only costs two rows in the dialog; never fail a request.
	}
}

export async function readCapture(
	sessionID: string,
): Promise<RequestCapture | undefined> {
	try {
		const raw = await readFile(
			join(directory(), `${safeName(sessionID)}.json`),
			"utf8",
		);
		const parsed = JSON.parse(raw) as Partial<RequestCapture>;
		if (
			typeof parsed.systemBytes !== "number" ||
			typeof parsed.toolDefsBytes !== "number"
		)
			return undefined;
		return {
			systemBytes: parsed.systemBytes,
			toolDefsBytes: parsed.toolDefsBytes,
			at: typeof parsed.at === "number" ? parsed.at : 0,
		};
	} catch {
		return undefined;
	}
}
