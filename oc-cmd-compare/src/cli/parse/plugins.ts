import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Bag } from "./validate.ts";

/** A plugin's default export may be an object or a (possibly async) factory. */
type PluginFactory = (ctx: PluginContext) => Bag | Promise<Bag>;

export interface PluginContext {
	env: Record<string, string | undefined>;
	cwd: string;
	configDir: string;
}

function qualify(spec: string, relativeTo: string): string {
	if (spec.startsWith(".") || isAbsolute(spec)) {
		return isAbsolute(spec) ? spec : join(relativeTo, spec);
	}
	return spec; // bare specifier: resolve as a package
}

function asBag(value: unknown, spec: string): Bag {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`plugin ${spec} must export a config object`);
	}
	return value as Bag;
}

async function loadOne(spec: string, relativeTo: string): Promise<Bag> {
	const target = qualify(spec, relativeTo);
	const ctx: PluginContext = {
		env: process.env,
		cwd: process.cwd(),
		configDir: relativeTo,
	};

	if (
		target.endsWith(".json") ||
		(existsSync(target) && target.endsWith(".json"))
	) {
		return asBag(JSON.parse(readFileSync(target, "utf8")), spec);
	}
	try {
		const mod = (await import(target)) as { default?: unknown };
		const exported = mod.default ?? mod;
		const value =
			typeof exported === "function"
				? await (exported as PluginFactory)(ctx)
				: exported;
		return asBag(value, spec);
	} catch (error) {
		throw new Error(
			`plugin ${spec} failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Load plugins in order and layer them: later plugins win over earlier ones. */
export async function loadPlugins(
	specs: string[],
	relativeTo: string,
): Promise<Bag> {
	const merged: Bag = {};
	for (const spec of specs) {
		Object.assign(merged, await loadOne(spec, relativeTo));
	}
	return merged;
}
