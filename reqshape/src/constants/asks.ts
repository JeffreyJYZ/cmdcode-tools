import type { AskKind } from "~/types.ts";

/**
 * Row kinds that *open* a new ask. Only a prompt the user typed does.
 *
 * `synthetic` / `system` / `compaction` / `shell` rows are interjections: a
 * system-reminder lands after the prompt and before its answer, so treating one
 * as a boundary filed the answer's reqs under the interjection, which the
 * filter then discarded along with the whole response. They now continue the
 * ask they interrupted.
 */
export const BOUNDARY: Record<string, AskKind> = {
	user: "user",
};
