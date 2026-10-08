// Gating LOGIC on top of the canonical DATA in ./constants/gating (sourced from
// ../../core/gating.json, shared with cmduse-core's build.rs). Edit the JSON,
// never the consts. Regen: `bun run extract` from the repo root (needs the
// installed Command Code CLI).
import {
	GATE_CLI_VERSION,
	GATE_EXTRACTED_AT,
	GATE_STALE_DAYS,
	KNOWN_MODELS,
	MODEL_ALIASES,
} from "./constants/gating";

export type Category = "opensource" | "premium";

let staleWarned = false;

/** Warn once per process when gating.json is older than GATE_STALE_DAYS. */
export function warnIfGatingStale(): void {
	if (staleWarned || !GATE_EXTRACTED_AT) return;
	const days = Math.floor(
		(Date.now() - Date.parse(GATE_EXTRACTED_AT)) / 86_400_000,
	);
	if (days > GATE_STALE_DAYS) {
		staleWarned = true;
		console.warn(
			`[command-code] gating snapshot is ${days}d old (CLI ${GATE_CLI_VERSION ?? "?"}) — run \`bun run extract\` from the repo root`,
		);
	}
}

/** strip a trailing date suffix like -20251101 before aliasing (mirrors CLI kr regex) */
function findKnown(s: string): string | undefined {
	const k = s.toLowerCase();
	return KNOWN_MODELS.find((m) => m.toLowerCase() === k);
}

export function canonicalizeModelId(model: string): string {
	const stripDate = (s: string) => s.replace(/[-@]\d{8}$/, "");
	const direct = findKnown(model);
	if (direct) return direct;
	const aliased = MODEL_ALIASES[model.toLowerCase()];
	if (aliased) return findKnown(aliased) ?? model;
	return findKnown(stripDate(model)) ?? model;
}

/** Bare model id with any provider qualifier stripped: everything after the
 * FIRST colon ("anthropic:claude-opus-5" → "claude-opus-5"). Matches
 * cmduse-core's `bare_model`; a model id that itself contains ':' keeps it. */
export function bareModel(blocked: string): string {
	const i = blocked.indexOf(":");
	return i >= 0 ? blocked.slice(i + 1) : blocked;
}
