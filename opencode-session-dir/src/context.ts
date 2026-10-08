/**
 * System-prompt injection: tell the model which extra directories belong to the
 * session it is answering in, so it knows they are fair game. Set
 * `OPENCODE_SESSION_DIR_INJECT_CONTEXT=1` to also fold in those directories'
 * own `AGENTS.md` / `CLAUDE.md` / `.agents/AGENTS.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", ".agents/AGENTS.md"] as const;

const shouldInjectContext = (): boolean =>
	process.env.OPENCODE_SESSION_DIR_INJECT_CONTEXT === "1";

export function contextSection(dirs: string[]): string[] {
	if (dirs.length === 0) return [];

	const listed = dirs.map((dir) => `- ${dir}`).join("\n");
	const sections = [
		`Directories bound to this session (use them at their paths):\n${listed}`,
	];

	if (!shouldInjectContext()) return sections;

	for (const dir of dirs) {
		for (const name of CONTEXT_FILES) {
			const file = join(dir, name);
			if (!existsSync(file)) continue;
			const content = readFileSync(file, "utf8").trim();
			if (content) sections.push(`# Context from ${file}\n\n${content}`);
		}
	}

	return sections;
}
