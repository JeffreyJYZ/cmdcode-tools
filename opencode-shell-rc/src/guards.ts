/**
 * The guard layer: shadow the binaries an agent keeps reaching for by habit
 * (`find`, `grep`) with a function that fails and names the right tool.
 *
 * Only the agent shell is affected. zsh functions are not exported, so a real
 * script or a binary that shells out (`git`, `brew`, a Makefile) still runs the
 * real `grep`; what changes is what the model types into the shell tool.
 *
 * Generated into `guards.zsh` in the state dir and sourced after the alias
 * state, before the user's escape hatch — so `~/.config/opencode/shell.zsh`
 * can still undo a guard for one machine.
 */
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BLOCKED, GUARDS_FILE, SHELL_RC_CONFIG } from "./constants/shell-rc";

/** Read `HOME` per call so tests can point it at a temporary directory. */
const home = (): string => process.env.HOME ?? homedir();

/** One guard entry: the command to shadow, and what to say instead. */
export interface BlockedEntry {
	name: string;
	alternative?: string;
	reason?: string;
}

/** The legacy shape, still accepted by the config file and by {@link renderGuards}. */
export type LegacyBlocked = Record<string, string>;

/** Both accepted shapes of `blocked` — the new array and the legacy string map. */
export type Blocked = BlockedEntry[] | LegacyBlocked;

export interface Config {
	blocked: BlockedEntry[];
}

/** `$XDG_CONFIG_HOME/opencode/shell-rc.json` — absent means the defaults. */
export function configFile(): string {
	const config = process.env.XDG_CONFIG_HOME ?? join(home(), ".config");
	return join(config, "opencode", SHELL_RC_CONFIG);
}

/**
 * Normalise either accepted shape into a flat, ordered list of entries.
 *
 * The new array carries `{ name, alternative?, reason? }`; the legacy map's
 * values become `alternative`. Anything else is a fault, not an instruction:
 * it becomes the empty list (today's defaults), never a guessed guard list.
 * A repeated `name` is resolved here too — the later entry wins.
 */
export function normalizeBlocked(value: unknown): BlockedEntry[] {
	const entries: BlockedEntry[] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const raw = item as Record<string, unknown>;
			if (typeof raw.name !== "string" || !raw.name.trim()) continue;
			const entry: BlockedEntry = { name: raw.name.trim() };
			if (typeof raw.alternative === "string" && raw.alternative.trim()) {
				entry.alternative = raw.alternative.trim();
			}
			if (typeof raw.reason === "string" && raw.reason.trim()) {
				entry.reason = raw.reason.trim();
			}
			// Nothing to say means no guard at all — not a function whose refusal
			// is only the command name.
			if (entry.alternative || entry.reason) entries.push(entry);
		}
	} else if (value && typeof value === "object") {
		for (const [name, replacement] of Object.entries(value as Record<string, unknown>)) {
			if (typeof replacement !== "string" || !replacement.trim()) continue;
			entries.push({ name: name.trim(), alternative: replacement.trim() });
		}
	}
	const byName = new Map<string, BlockedEntry>();
	for (const entry of entries) {
		byName.delete(entry.name);
		byName.set(entry.name, entry);
	}
	return [...byName.values()];
}

/**
 * The configured guard list, or the defaults when there is no config file.
 *
 * A malformed file is a fault, not an instruction: it falls back to the defaults
 * rather than silently disabling the guards, because "the agents started using
 * grep again" is a much quieter failure than a broken shell.
 */
export function loadConfig(): Config {
	try {
		const parsed = JSON.parse(readFileSync(configFile(), "utf8")) as {
			blocked?: unknown;
		};
		return { blocked: normalizeBlocked(parsed.blocked) };
	} catch {
		return { blocked: normalizeBlocked(DEFAULT_BLOCKED) };
	}
}

/** Whether a command resolves on this machine's PATH. */
function resolves(command: string): boolean {
	const path = process.env.PATH ?? "";
	for (const dir of path.split(":")) {
		if (!dir) continue;
		try {
			accessSync(join(dir, command), constants.X_OK);
			return true;
		} catch {
			// not executable here; keep looking
		}
	}
	return false;
}

/** A command name that is safe to use as a zsh function name. */
function validName(name: string): boolean {
	return /^[A-Za-z0-9._+-]+$/.test(name);
}

/**
 * Escape the four characters that are special inside the double-quoted zsh
 * string the message is written into. A reason containing `"`, `$` or a
 * backtick must be inert data, never syntax the generated script interprets.
 */
function escapeZshDoubleQuoted(text: string): string {
	return text.replace(/[\\"$`]/g, (character) => `\\${character}`);
}

/**
 * The guard script, from either the new array or the legacy map.
 *
 * Composition (per `docs/plan/skills-and-guards/schema.md`): an `alternative`
 * whose first word resolves on PATH gives `use <alternative>`, with a `reason`
 * appended in parentheses when present; otherwise a `reason` alone gives the
 * reason; otherwise a bare `alternative` is printed verbatim (the 0.4.3 sentence
 * case); with neither, the entry is skipped. Invalid names, blank entries and
 * `cat` are skipped as before.
 */
export function renderGuards(
	blocked: Blocked,
	installed: (command: string) => boolean = resolves,
): string {
	const lines = ["# Generated by opencode-shell-rc. Sourced by agent shells only."];
	for (const entry of normalizeBlocked(blocked)) {
		const { name } = entry;
		if (!validName(name)) continue;
		// `cat` stays out of every config: it emits raw bytes, while `bat` (the
		// usual replacement) reformats with headers, numbers and decoration, so a
		// blocked `cat` would hand back something that is not the file.
		if (name === "cat") continue;
		const alternative = entry.alternative ?? "";
		const reason = entry.reason ?? "";
		let instruction = "";
		if (alternative) {
			const binary = alternative.split(/\s+/)[0] ?? "";
			if (installed(binary)) {
				instruction = `use ${alternative}${reason ? ` (${reason})` : ""}`;
			} else {
				instruction = reason || alternative;
			}
		} else if (reason) {
			instruction = reason;
		}
		if (!instruction) continue;
		const message = escapeZshDoubleQuoted(
			`${name} is blocked in agent shells — ${instruction}`,
		);
		lines.push(
			// A loaded interactive shell often already has an alias of the same
			// name (`grep='grep --color=auto'` ships with oh-my-zsh), and zsh
			// refuses to define a function whose name is an alias. Both forms are
			// needed: the unalias clears the alias, `function name {` is the one
			// definition syntax zsh parses without alias expansion.
			`unalias ${name} 2>/dev/null`,
			`function ${name} {`,
			// `print -r` keeps a literal backslash in a reason from being turned
			// into an escape by zsh's print builtin (`\t` would become a tab).
			`  print -r -u2 -- "${message}"`,
			"  return 127",
			"}",
		);
	}
	return `${lines.join("\n")}\n`;
}

/** Regenerate `guards.zsh` when the config (or this code) changed. */
export function syncGuards(installed: (command: string) => boolean = resolves): boolean {
	const script = renderGuards(loadConfig().blocked, installed);
	const path = join(stateDirPath(), GUARDS_FILE);
	// Nothing blocked (the default) means no file at all: the shim's `-f` test
	// then skips the source entirely instead of reading a no-op script on every
	// command.
	const wanted = script.includes("function ") ? script : undefined;
	if (!wanted) {
		if (!existsSync(path)) return false;
		try {
			rmSync(path, { force: true });
			return true;
		} catch {
			return false;
		}
	}
	let current = "";
	try {
		current = readFileSync(path, "utf8");
	} catch {
		// first run
	}
	if (current === wanted) return false;
	try {
		mkdirSync(stateDirPath(), { recursive: true });
		const temporary = `${path}.tmp`;
		writeFileSync(temporary, wanted);
		renameSync(temporary, path);
	} catch {
		return false;
	}
	return true;
}

/** Kept local to avoid a cycle with `shim.ts` (which imports this module). */
function stateDirPath(): string {
	const base = process.env.XDG_STATE_HOME ?? join(home(), ".local", "state");
	return join(base, "opencode", "shell-rc");
}

/** Whether a guard file exists — the shim only sources it when it does. */
export function guardsExist(): boolean {
	return existsSync(join(stateDirPath(), GUARDS_FILE));
}
