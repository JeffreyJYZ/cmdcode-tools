import { INTERNAL, KNOWN, VALUED } from "#~/constants/cli.ts";

export type Bag = Record<string, unknown>;

// `Number("")` is 0 and `Number(true)` is 1, so a blank or bare flag would be
// coerced into a plausible-looking value (`--out ""` silently priced every model
// with zero output tokens, `--width ""` became 0 and disabled trimming). Reject
// both shapes before the conversion; a bare boolean is also caught by
// `assertValues`, but config/plugin layers reach here without that guard.
export function int(name: string, value: unknown, min = 0): number {
	const want = min === 0 ? "a non-negative integer" : `an integer ≥ ${min}`;
	if (value === true || value === "" || Number(value) < min) {
		throw new Error(`--${name} expects ${want}, got "${value}"`);
	}
	const n = Number(value);
	if (!Number.isFinite(n) || !Number.isInteger(n)) {
		throw new Error(`--${name} expects ${want}, got "${value}"`);
	}
	return n;
}

export function share(name: string, value: unknown): number {
	if (value === true || value === "") {
		throw new Error(`--${name} expects a number between 0 and 1`);
	}
	const n = Number(value);
	if (!Number.isFinite(n) || n < 0 || n > 1) {
		throw new Error(`--${name} expects a number between 0 and 1`);
	}
	return n;
}

/** Reject undeclared flags before mapping. */
export function assertKnown(bag: Bag): void {
	const extra = Object.keys(bag).filter(
		(key) => !KNOWN.has(key) && !INTERNAL.has(key),
	);
	if (extra.length > 0) {
		throw new Error(
			`unknown flag "--${extra[0]}" — see --help for the full list`,
		);
	}
}

/** camelCase key -> the `--kebab-case` spelling the user typed. */
function flag(key: string): string {
	return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

/** Reject a value-taking flag used bare (`--shape` with no argument). */
export function assertValues(bag: Bag): void {
	const bare = Object.keys(bag).filter(
		(key) => VALUED.has(key) && bag[key] === true,
	);
	if (bare.length > 0) {
		throw new Error(
			`${flag(String(bare[0]))} expects a value — see --help`,
		);
	}
}
