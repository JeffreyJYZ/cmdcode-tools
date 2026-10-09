import type { ScoreConfig } from "#~/cli/engine/score.ts";

/** Tokens per million, the denominator of every per-M-token rate. */
export const PER_MILLION = 1_000_000;

/** Speed-variant suffixes that share the base model's weights. */
export const SPEED_SUFFIXES = ["ultraspeed", "highspeed", "fastx", "fast"];

/**
 * Throughput a speed variant without its own figure borrows from its base.
 * Serving differs, so the base's number is not inherited verbatim, but leaving
 * the variant at `null` scores it at the neutral 0.5 — as if a "Fast" model
 * were mid-pack on speed, which is what made DeepSeek V4.1 Flash Fast rank
 * below its slower base. A speed tier is multiples of its base, so claim 2x.
 */
export const SPEED_TPS_FACTOR = 2;

export const DEFAULT_SCORE: ScoreConfig = {
	abilityWeight: 0.35,
	tpsWeight: 0.1,
	scale: "log",
};
