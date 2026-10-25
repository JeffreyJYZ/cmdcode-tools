export interface ShellCreateBefore {
	command: string;
	cwd: string;
	timeout: number;
	shell: string;
	env: Record<string, string | undefined>;
}

/**
 * Put an environment variable back, including "it was not set".
 *
 * `process.env.KEY = undefined` stores the *string* `"undefined"` in Bun and
 * Node alike, so a test that restores an originally-absent key poisons every
 * later test in the same process: the alias index then writes
 * `undefined/opencode/AGENTS.md` into the working directory, which is how one
 * of those files ended up in this repo. Delete the key instead.
 */
export function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

export { stateDir } from "../src/shim";
