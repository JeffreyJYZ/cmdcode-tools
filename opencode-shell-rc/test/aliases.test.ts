import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agentsFile,
	aliasCommands,
	hasBlock,
	parseAliasListing,
	renderBlock,
	syncAliases,
	upsertBlock,
} from "../src/aliases";
import { ALIAS_BLOCK_BEGIN, ALIAS_BLOCK_END } from "../src/constants/shell-rc";
import { restoreEnv } from "./helpers";

const saved = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "shell-rc-aliases-"));
	process.env.HOME = dir;
	process.env.XDG_STATE_HOME = join(dir, "state");
	process.env.XDG_CONFIG_HOME = join(dir, "config");
});

afterEach(() => {
	restoreEnv("HOME", saved.HOME);
	restoreEnv("XDG_STATE_HOME", saved.XDG_STATE_HOME);
	restoreEnv("XDG_CONFIG_HOME", saved.XDG_CONFIG_HOME);
	rmSync(dir, { recursive: true, force: true });
});

const rc = (text: string): void => writeFileSync(join(dir, ".zshrc"), text);
const agentsText = (): string => readFileSync(agentsFile(), "utf8");

describe("aliasCommands", () => {
	test("keeps the rc's own alias statements and nothing else", () => {
		const text = [
			'export ZSH="$HOME/.oh-my-zsh"',
			'source "$ZSH/oh-my-zsh.sh"',
			"# alias commented=out",
			'  alias ls="eza --icons=always"',
			"alias b=bun",
			"\talias ga='git add'",
			"alias",
			"m4a2mp3() { echo hi; }",
		].join("\n");
		expect(aliasCommands(text)).toEqual([
			'alias ls="eza --icons=always"',
			"alias b=bun",
			"alias ga='git add'",
		]);
	});

	test("an rc without aliases yields nothing", () => {
		expect(aliasCommands("export PATH=/x:$PATH\n")).toEqual([]);
	});
});

describe("parseAliasListing", () => {
	test("reads plain, quoted and option-form definitions", () => {
		const listing = [
			"alias -- -='cd -'",
			"alias -g ...=../..",
			"alias b=bun",
			"alias ba='bun add'",
			"alias quote='echo '\\''x'\\'''",
		].join("\n");
		expect(parseAliasListing(listing)).toEqual([
			{ name: "-", value: "cd -" },
			{ name: "...", value: "../.." },
			{ name: "b", value: "bun" },
			{ name: "ba", value: "bun add" },
			{ name: "quote", value: "echo 'x'" },
		]);
	});

	test("ignores anything zsh did not print as a definition", () => {
		expect(parseAliasListing("no aliases here\n")).toEqual([]);
	});
});

describe("the managed block", () => {
	const block = renderBlock([{ name: "b", value: "bun" }]);

	test("states the aliases between the markers", () => {
		expect(block.startsWith(ALIAS_BLOCK_BEGIN)).toBe(true);
		expect(block.endsWith(ALIAS_BLOCK_END)).toBe(true);
		expect(block).toContain("- `b` = `bun`");
	});

	test("is appended when the file has no block yet", () => {
		const next = upsertBlock("# Rules\n\n- keep me\n", block);
		expect(next.startsWith("# Rules\n\n- keep me\n\n")).toBe(true);
		expect(next.trimEnd().endsWith(ALIAS_BLOCK_END)).toBe(true);
	});

	test("replaces only the block, leaving hand-written text alone", () => {
		const before = `# Rules\n\n${block}\n\n## After\n\n- untouched\n`;
		const next = upsertBlock(
			before,
			renderBlock([
				{ name: "b", value: "bun" },
				{ name: "gs", value: "git status" },
			]),
		);
		expect(next).toContain("- `gs` = `git status`");
		expect(next).not.toContain("- `b` = `bun`\n- `b` = `bun`");
		expect(next.startsWith("# Rules\n\n")).toBe(true);
		expect(next.endsWith("## After\n\n- untouched\n")).toBe(true);
	});

	test("is stable: upserting the same block twice changes nothing", () => {
		const once = upsertBlock("# Rules\n", block);
		expect(upsertBlock(once, block)).toBe(once);
	});

	test("writes a file that has no block at all", () => {
		expect(upsertBlock("", block)).toBe(`${block}\n`);
	});
});

describe("syncAliases", () => {
	const hasZsh = Bun.which("zsh") !== null;

	test.skipIf(!hasZsh)("indexes the rc's aliases in the global AGENTS.md", () => {
		rc("alias b=bun\nalias ls='eza --icons=always'\nexport PATH=/x:$PATH\n");
		expect(syncAliases()).toBe(true);
		const text = agentsText();
		expect(hasBlock(agentsFile())).toBe(true);
		expect(text).toContain("- `b` = `bun`");
		expect(text).toContain("- `ls` = `eza --icons=always`");
		expect(text).not.toContain("PATH");
		// zsh's own default aliases are not the user's rc.
		expect(text).not.toContain("run-help");
		expect(text).not.toContain("which-command");
	});

	test.skipIf(!hasZsh)("does not rewrite an unchanged index", () => {
		rc("alias b=bun\n");
		expect(syncAliases()).toBe(true);
		expect(syncAliases()).toBe(false);
	});

	test.skipIf(!hasZsh)("follows an rc edit in place", () => {
		rc("alias b=bun\n");
		syncAliases();
		rc("alias b=bun\nalias gs='git status'\n");
		expect(syncAliases()).toBe(true);
		const text = agentsText();
		expect(text).toContain("- `gs` = `git status`");
		// Still one block, not two.
		expect(text.split(ALIAS_BLOCK_BEGIN)).toHaveLength(2);
	});

	test.skipIf(!hasZsh)("keeps hand-written rules around the block", () => {
		rc("alias b=bun\n");
		const path = agentsFile();
		const { mkdirSync } = require("node:fs") as typeof import("node:fs");
		mkdirSync(join(dir, "config", "opencode"), { recursive: true });
		writeFileSync(path, "# My rules\n\n- be brief\n");
		syncAliases();
		const text = agentsText();
		expect(text.startsWith("# My rules\n\n- be brief\n")).toBe(true);
		expect(text).toContain("- `b` = `bun`");
	});

	test("an rc-less machine is left alone", () => {
		expect(syncAliases()).toBe(false);
	});
});
