import type { CustomRates } from "#~/market/rates.ts";
import { defaultStorePath } from "#~/measure/store.ts";

export interface Options {
	/** `user` keeps only prompts you typed; `all` includes subagent sessions. */
	sessions: "user" | "all";
	/** Which mean the projection prices: the per-req mean, or one vote per conversation. */
	weight: "turn" | "session";
	/** Epoch ms floor; 0 keeps everything. */
	since: number;
	project: string;
	model: string;
	limit: number;
	sort: "reqmo" | "cost" | "name";
	format: "text" | "json";
	explain: boolean;
	account: boolean;
	/** cac already printed --help or --version; there is nothing left to do. */
	handled: boolean;
	color: "auto" | "always" | "never";
	db: string;
	mpc: string;
	cmduse: string;
	custom: CustomRates | null;
}

export function defaultOptions(): Options {
	return {
		sessions: "all",
		weight: "turn",
		since: 0,
		project: "",
		model: "",
		limit: 0,
		sort: "reqmo",
		format: "text",
		explain: false,
		account: true,
		handled: false,
		color: "auto",
		db: defaultStorePath(),
		mpc: process.env.MPC_BIN ?? "mpc",
		cmduse: process.env.CMDUSE_BIN ?? "cmduse",
		custom: null,
	};
}
