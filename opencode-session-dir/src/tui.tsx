/** @jsxImportSource @opentui/solid */
// TUI half: the /session-dir* slash commands. Bindings are read and written
// directly (same JSON file the server half reads), so nothing is spawned.

import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Plugin as Tui } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import {
	COMMAND_BIND,
	COMMAND_LIST,
	COMMAND_REMOVE,
	PLUGIN_ID,
	SLASH_BIND,
	SLASH_LIST,
	SLASH_REMOVE,
} from "./ids";
import {
	addBinding,
	bindingsFor,
	expandHome,
	isDirectory,
	removeBinding,
} from "./state";

type Variant = "info" | "success" | "warning" | "error";

function toast(ctx: Tui.Context, variant: Variant, message: string): void {
	ctx.ui.toast.show({ variant, message });
}

/** The session the command should act on, or undefined when not in one. */
function sessionOf(ctx: Tui.Context): string | undefined {
	const route = ctx.ui.router.current();
	return route.type === "session" ? route.sessionID : undefined;
}

function resolveInput(input: string): string {
	return resolve(expandHome(input.trim()));
}

/** Non-hidden subdirectories of `dir`, sorted by name. */
async function listSubdirs(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => join(dir, entry.name))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

const TYPE_PATH = "__type_path__";

interface SelectOption {
	title: string;
	value: string;
	description?: string;
	footer?: string;
}

/**
 * Interactive directory browser: start at `start`, descend into
 * subdirectories, go up with `..`, confirm the current directory, or fall back
 * to typing a path.
 */
async function browse(
	ctx: Tui.Context,
	start: string,
): Promise<string | undefined> {
	let current = start;
	for (;;) {
		const options: SelectOption[] = [
			{
				title: `✓ Bind this directory — ${current}`,
				value: current,
				footer: "Bind",
			},
			...(await listSubdirs(current)).map((dir) => ({
				title: `${basename(dir)}/`,
				value: dir,
				description: dir,
			})),
		];

		const parent = dirname(current);
		if (parent !== current) {
			options.push({ title: "..", value: parent, description: parent });
		}
		options.push({ title: "Type a path instead…", value: TYPE_PATH });

		const next = await ctx.ui.dialog.select<string>({
			title: "Bind directory to this session",
			placeholder: "Browse or confirm",
			current,
			options,
		});

		if (next === undefined) return undefined;
		if (next === current) return current;
		if (next === TYPE_PATH) {
			return ctx.ui.dialog.prompt({
				title: "Bind directory to this session",
				placeholder: "/path/to/directory",
				description: "Paste the absolute path of the directory to bind.",
			});
		}
		current = next;
	}
}

async function bind(ctx: Tui.Context): Promise<void> {
	const sessionID = sessionOf(ctx);
	if (!sessionID) return toast(ctx, "warning", "Open a session first.");

	const start = dirname(ctx.location?.directory ?? process.cwd());
	const selected = await browse(ctx, start);
	if (selected === undefined) return;
	if (!selected.trim()) return toast(ctx, "error", "Path is required.");

	const abs = resolveInput(selected);
	if (!isDirectory(abs)) return toast(ctx, "error", `Not a directory: ${abs}`);

	const added = addBinding(sessionID, abs);
	toast(
		ctx,
		added ? "success" : "info",
		added ? `Bound ${abs} to this session.` : `Already bound: ${abs}`,
	);
}

async function list(ctx: Tui.Context): Promise<void> {
	const sessionID = sessionOf(ctx);
	if (!sessionID) return toast(ctx, "warning", "Open a session first.");

	const dirs = bindingsFor(sessionID);
	if (dirs.length === 0) {
		return toast(ctx, "info", "No directories bound to this session.");
	}
	await ctx.ui.dialog.alert({
		title: `Bound directories (${dirs.length})`,
		message: dirs.join("\n"),
	});
}

async function remove(ctx: Tui.Context): Promise<void> {
	const sessionID = sessionOf(ctx);
	if (!sessionID) return toast(ctx, "warning", "Open a session first.");

	const dirs = bindingsFor(sessionID);
	if (dirs.length === 0) {
		return toast(ctx, "info", "No directories bound to this session.");
	}

	const selected = await ctx.ui.dialog.select<string>({
		title: "Unbind a directory",
		options: dirs.map((dir) => ({ title: dir, value: dir })),
	});
	if (selected === undefined) return;

	const confirmed = await ctx.ui.dialog.confirm({
		title: "Unbind directory",
		message: `Unbind ${selected} from this session?`,
	});
	if (!confirmed) return;

	removeBinding(sessionID, selected);
	toast(ctx, "success", `Unbound ${selected}.`);
}

async function run(
	ctx: Tui.Context,
	command: () => Promise<void>,
): Promise<void> {
	try {
		await command();
	} catch (error) {
		toast(ctx, "error", error instanceof Error ? error.message : String(error));
	}
}

export const sessionDirTui: Tui.Definition = {
	id: PLUGIN_ID,
	setup(ctx) {
		// keymap.layer() must run inside a render, so mount a no-op in the app
		// slot and register the commands from there.
		return ctx.ui.slot({
			append: "app",
			render: (() => {
				ctx.keymap.layer(() => ({
					mode: "global",
					priority: 10,
					commands: [
						{
							id: COMMAND_BIND,
							title: "Bind directory to session",
							description: "Grant this session access to another directory",
							group: "Session directories",
							palette: true,
							slash: { name: SLASH_BIND },
							run: () => run(ctx, () => bind(ctx)),
						},
						{
							id: COMMAND_LIST,
							title: "List session directories",
							description: "Show directories bound to this session",
							group: "Session directories",
							palette: true,
							slash: { name: SLASH_LIST },
							run: () => run(ctx, () => list(ctx)),
						},
						{
							id: COMMAND_REMOVE,
							title: "Unbind session directory",
							description: "Remove a directory bound to this session",
							group: "Session directories",
							palette: true,
							slash: { name: SLASH_REMOVE },
							run: () => run(ctx, () => remove(ctx)),
						},
					],
					bindings: [COMMAND_BIND, COMMAND_LIST, COMMAND_REMOVE],
				}));
			}) as unknown as () => JSX.Element,
		});
	},
};

export default sessionDirTui;
