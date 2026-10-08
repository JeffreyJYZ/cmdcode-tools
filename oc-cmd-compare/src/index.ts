#!/usr/bin/env bun
import { run } from "./cli/run.ts";

try {
	process.exitCode = await run(process.argv.slice(2));
} catch (error) {
	console.error(
		`mpc: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
}
