// Gating DATA: the canonical tables in ../../../core/gating.json, shared with
// cmduse-core's build.rs. src/gating.ts adds the TS types + canonicalization on
// top of these; edit the JSON, never the consts. Regen the JSON: `bun run
// extract` from the repo root (needs the installed Command Code CLI).

import data from "../../../core/gating.json";
import type { Category } from "../gating";

/** model id -> category (models absent from this table have unknown category) */
export const MODEL_CATEGORIES = data.categories as Record<string, Category>;

/** planId -> access rules; plan ids absent from this table get everything */
export const PLAN_RULES = data.plans as Record<
	string,
	{ allowedCategories: Category[]; blockedModels: string[] }
>;

/** Models the API hard-blocks (403 MODEL_NOT_IN_PLAN) per plan, beyond the
 * category rules. Empirically probed — the CLI bundle misses these because it
 * tracks category via serving lane, not per-model plan entitlements. */
export const HARD_BLOCKED = data.hardBlocked as Record<string, string[]>;

/** canonical known model ids (lowercase compare) */
export const KNOWN_MODELS = data.knownModels as string[];

/** deprecated/aliased model id -> canonical id */
export const MODEL_ALIASES = data.aliases as Record<string, string>;

/** ISO timestamp the snapshot was extracted (absent on pre-metadata files). */
export const GATE_EXTRACTED_AT = (data as { extractedAt?: string }).extractedAt;

/** Command Code CLI version the snapshot was scraped from. */
export const GATE_CLI_VERSION = (data as { cliVersion?: string }).cliVersion;

/** Warn once a process when gating.json is older than this many days. */
export const GATE_STALE_DAYS = 30;
