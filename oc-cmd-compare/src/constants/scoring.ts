import type { ScoreConfig } from "#~/cli/engine/score.ts";

/** Tokens per million, the denominator of every per-M-token rate. */
export const PER_MILLION = 1_000_000;

/** Speed-variant suffixes that share the base model's weights. Longest first:
 * `ultrafast` must be tried before `fast`, or the base key keeps `ultra`. */
export const SPEED_SUFFIXES = ["ultraspeed", "highspeed", "ultrafast", "fastx", "fast"];

/**
 * Throughput a speed variant without its own figure borrows from its base.
 * Serving differs, so the base's number is not inherited verbatim, but leaving
 * the variant at `null` scores it at the neutral 0.5 — as if a "Fast" model
 * were mid-pack on speed, which is what made DeepSeek V4.1 Flash Fast rank
 * below its slower base. A speed tier is multiples of its base, so claim 2x.
 */
export const SPEED_TPS_FACTOR = 2;

/** Published throughput for a model that neither source scores. The suffix rule
 * would guess 512 for Ultrafast (2x its base); CommandCode advertises 1000, and a
 * stated figure always beats a derived one. */
export const TPS_OVERRIDES: Record<string, number> = {
	deepseekv41flashultrafast: 1000,
};

export const DEFAULT_SCORE: ScoreConfig = {
	abilityWeight: 0.35,
	tpsWeight: 0.1,
	scale: "log",
};
