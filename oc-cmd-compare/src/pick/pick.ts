import type { Options } from "#~/cli/options.ts";
import type { CompareRow } from "#~/types.ts";
import type { ReportMeta } from "#~/view/schema.ts";
import { applyKey, filterRows, initialPickState, selectedRow } from "./filter.ts";
import { detailLines, frameLines } from "./frame.ts";
import { decodeKeys, type PickKey } from "./keys.ts";

/** How long a lone ESC waits for the rest of a sequence before it means Esc. */
const ESC_WAIT_MS = 25;

/**
 * The picker only replaces the plain table when it can actually run: a real
 * terminal on both ends, and none of the modes whose output is a contract
 * (`--json`, `--format`, `--usage`, `--check`, `--print-config`).
 */
export function pickable(options: Options): boolean {
	if (!options.pick) return false;
	if (options.json || options.format !== "table") return false;
	if (options.usage || options.check || options.printConfig) return false;
	return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * Full-screen search over the rows `collect()` already produced. Resolves with
 * the exit code and prints the chosen row's detail table once the terminal is
 * back to normal. Nothing is fetched here.
 */
export async function pickRows(
	rows: CompareRow[],
	meta: ReportMeta,
	width: number,
): Promise<number> {
	const stdin = process.stdin;
	const out = process.stdout;
	let state = initialPickState();
	let matches = rows;
	let pending = "";
	let timer: ReturnType<typeof setTimeout> | undefined;
	let restored = false;
	let settle: (code: number) => void = () => {};

	const widthOf = (): number => {
		// A pty can report 0 columns (`script` does); 0 is not a width.
		const reported = Number(out.columns ?? 0);
		return Math.max(20, reported > 0 ? reported : width > 0 ? width : 120);
	};
	const rowsFit = (): number => Math.max(4, out.rows || 24);

	function draw(): void {
		const frameWidth = widthOf();
		const row = selectedRow(state, matches);
		const detail = row ? detailLines(row, meta, frameWidth) : [];
		const lines = frameLines({
			query: state.query,
			rows: matches,
			total: rows.length,
			selected: state.selected,
			width: frameWidth,
			height: rowsFit(),
			detail,
		});
		out.write(`\u001b[H${lines.join("\n")}\u001b[J`);
	}

	function restore(): void {
		if (restored) return;
		restored = true;
		if (timer) clearTimeout(timer);
		process.off("SIGTERM", onSignal);
		process.off("SIGINT", onSignal);
		process.off("uncaughtException", onCrash);
		process.off("unhandledRejection", onCrash);
		out.off("resize", draw);
		stdin.off("data", onData);
		try {
			stdin.setRawMode(false);
		} catch {
			// The terminal is already gone; the reset below still runs.
		}
		stdin.pause();
		out.write("\u001b[?25h\u001b[0m\u001b[?1049l");
	}

	function onSignal(): void {
		restore();
		process.exit(143);
	}

	function onCrash(error: unknown): void {
		restore();
		const text = error instanceof Error ? error.message : String(error);
		process.stderr.write(`mpc: ${text}\n`);
		process.exit(1);
	}

	function finish(): void {
		const chosen = state.done === "choose" ? selectedRow(state, matches) : undefined;
		restore();
		if (chosen) {
			for (const line of detailLines(chosen, meta, widthOf())) console.log(line);
		}
		settle(0);
	}

	function feed(keys: PickKey[]): void {
		for (const key of keys) {
			if (state.done) break;
			state = applyKey(state, key, matches.length);
			matches = filterRows(rows, state.query);
			if (state.selected > matches.length - 1) {
				state = { ...state, selected: Math.max(0, matches.length - 1) };
			}
		}
		if (state.done) finish();
		else draw();
	}

	function onData(chunk: Buffer): void {
		if (timer) clearTimeout(timer);
		const decoded = decodeKeys(pending + chunk.toString("latin1"));
		pending = decoded.rest;
		if (pending !== "") {
			timer = setTimeout(() => {
				const tail = decodeKeys(pending, true);
				pending = "";
				feed(tail.keys);
			}, ESC_WAIT_MS);
		}
		if (decoded.keys.length > 0) feed(decoded.keys);
	}

	try {
		return await new Promise<number>((resolve) => {
			settle = resolve;
			try {
				stdin.setRawMode(true);
			} catch {
				restore();
				resolve(1);
				return;
			}
			stdin.resume();
			out.write("\u001b[?1049h\u001b[?25l");
			process.once("SIGTERM", onSignal);
			process.once("SIGINT", onSignal);
			process.once("uncaughtException", onCrash);
			process.once("unhandledRejection", onCrash);
			out.on("resize", draw);
			stdin.on("data", onData);
			draw();
		});
	} finally {
		// A throw, an abort or a signal all land here with the terminal intact.
		restore();
	}
}
