import { runCmduse } from "#~/data/cmduse.ts";

interface CmdusePlan {
	name: string;
	price: string;
	creditsMonthly: string;
	fiveHour: string;
	weekly: string;
}

export function money(value: string): number | null {
	const m = value.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
	return m ? Number(m[1]) : null;
}

export async function cmdusePlans(): Promise<CmdusePlan[]> {
	const result = await runCmduse(["plans", "--json"]);
	if (!result.ok) {
		throw new Error(
			`cmduse plans --json failed: ${result.stderr.trim() || "is the command-code CLI installed?"}`,
		);
	}
	return JSON.parse(result.stdout) as CmdusePlan[];
}
