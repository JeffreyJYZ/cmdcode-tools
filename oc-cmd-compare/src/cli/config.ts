import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadPlugins } from "./parse/plugins.ts";
import type { Bag } from "./parse/validate.ts";

/** Default config location, XDG-aware. */
export function configPath(): string {
	const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(base, "mpc", "config.json");
}

export function readConfig(path: string): Bag {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	try {
		const parsed = JSON.parse(text) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("config must be a JSON object");
		}
		return parsed as Bag;
	} catch (error) {
		throw new Error(
			`invalid config ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function pluginList(bag: Bag): string[] {
	const value = bag.plugin ?? bag.plugins;
	if (value === undefined) return [];
	const items = Array.isArray(value) ? value : String(value).split(",");
	return items.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Precedence: defaults < plugins (listed order) < user config < CLI flags.
 * `--no-config` skips both the file and its plugins.
 */
export async function resolveBag(argv: string[]): Promise<Bag> {
	const { parseFlags } = await import("./parse/cac.ts");
	const cli = parseFlags(argv);
	if (cli.config === false) return cli;

	const path = typeof cli.config === "string" ? cli.config : configPath();
	const file = readConfig(path);
	const relativeTo = dirname(path);
	const fromCli = pluginList(cli);

	// Plugins (from the config file and from `--plugin` alike) are the lowest
	// layer, so the user config overrides them. Loading `--plugin` last made a
	// CLI plugin beat the config file, contradicting the documented order.
	const merged: Bag = {};
	Object.assign(merged, await loadPlugins(pluginList(file), relativeTo));
	if (fromCli.length > 0) {
		Object.assign(merged, await loadPlugins(fromCli, process.cwd()));
	}
	for (const [key, value] of Object.entries(file)) {
		if (value !== undefined) merged[key] = value;
	}
	for (const [key, value] of Object.entries(cli)) {
		if (value !== undefined && key !== "config" && key !== "plugin") {
			merged[key] = value;
		}
	}
	merged.config = path;
	return merged;
}

/** Effective settings, for --print-config. */
export function describeConfig(bag: Bag): string {
	const { printConfig, ...rest } = bag;
	void printConfig;
	return `${JSON.stringify(rest, null, 2)}\n`;
}
