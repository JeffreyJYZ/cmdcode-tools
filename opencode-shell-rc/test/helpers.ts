export interface ShellCreateBefore {
	command: string;
	cwd: string;
	timeout: number;
	shell: string;
	env: Record<string, string | undefined>;
}

export { stateDir } from "../src/shim";
