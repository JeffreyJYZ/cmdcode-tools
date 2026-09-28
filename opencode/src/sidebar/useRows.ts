// Sidebar data hook: cmduse polled once a minute for CommandCode account totals,
// ocuse the same way for OpenCode Go / Zen, mpc's catalog read from disk, and
// opencode's own store for the active model's period usage and this session's
// totals (the account APIs have no per-model, per-session dimension).
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { minPlan } from "../catalog";
import { loadMeta, loadUsage, loadZen } from "./data";
import {
	type ModelMeta,
	type ModelUsage,
	modelKey,
	modelRows,
	type SidebarRow,
	separator,
	tierFor,
	type Usage,
	usageRows,
} from "./rows";
import { loadModelUsage, loadSessionUsage, periodStart } from "./usageDb";
import { type ZenUsage, zenRows } from "./zen";

// A minute is plenty: the numbers move on request boundaries, not continuously,
// and each poll is a process spawn.
const POLL_MS = 60_000;

/**
 * Which family a session's provider belongs to, as far as this panel is
 * concerned. `unknown` is the frame during a session switch, before the host has
 * resolved the new session's model; it must not be read as someone else's, or
 * the panel blanks and refetches on every tab change.
 */
export type SessionKind = "ours" | "go" | "zen" | "other" | "unknown";

export function sessionKind(providerID: string | undefined): SessionKind {
	if (!providerID) return "unknown";
	if (providerID.startsWith("command-code")) return "ours";
	if (providerID.startsWith("opencode-go")) return "go";
	if (providerID === "opencode" || providerID.startsWith("opencode-zen"))
		return "zen";
	return "other";
}

/** Whether the panel has anything to say about this session at all. */
function shows(kind: SessionKind): boolean {
	return kind === "ours" || kind === "go" || kind === "zen";
}

/** The section's title, per family. */
export function panelTitle(kind: SessionKind): string {
	if (kind === "ours") return "Command Code";
	if (kind === "zen") return "OpenCode Zen";
	return "OpenCode Go";
}

// Account totals are account-wide, so the last snapshot is worth keeping: the
// next mount, and every session switch, can paint the plan and windows before
// cmduse runs again.
let lastSnapshot: Usage | undefined;

/** Keep an account snapshot for the next panel that needs it. */
export function rememberSnapshot(snapshot: Usage): void {
	lastSnapshot = snapshot;
}

/** Rows to paint before this panel's first fetch of the session completes. */
export function seededRows(): SidebarRow[] {
	return lastSnapshot ? usageRows(lastSnapshot) : [];
}

/**
 * The last `Usage (this model)` figure and the model it came from. The account
 * block above is seeded on remount (`seededRows`); the model block had no such
 * memory, so that one row blanked on every remount and session switch while the
 * plan above it stayed up — which reads as the panel having lost the row.
 */
let lastModelUsage: { key: string; usage: ModelUsage } | undefined;

/**
 * Keep the last figure for a model. Keyed canonically because the session's id
 * and the stored `modelID` differ by vendor prefix and punctuation.
 */
export function rememberModelUsage(id: string, usage: ModelUsage): void {
	lastModelUsage = { key: modelKey(id), usage };
}

/**
 * The remembered figure for `id`, or undefined when that model is unseen. An
 * undefined id is the frame during a session switch: keeping the previous row up
 * beats blanking it, the same call `wasOurs` makes for the account block.
 */
export function seededModelUsage(
	id: string | undefined,
): ModelUsage | undefined {
	if (!lastModelUsage) return undefined;
	if (id === undefined) return lastModelUsage.usage;
	return lastModelUsage.key === modelKey(id) ? lastModelUsage.usage : undefined;
}

export function useRows(
	activeModelId: () => string | undefined,
	providerID: () => string | undefined,
	sessionID: () => string | undefined,
) {
	const [usage, setUsage] = createSignal<SidebarRow[]>(seededRows());
	const [zen, setZen] = createSignal<ZenUsage | undefined>();
	const [meta, setMeta] = createSignal<Map<string, ModelMeta>>(new Map());
	const [modelUsage, setModelUsage] = createSignal<
		{ key: string; usage: ModelUsage } | undefined
	>(lastModelUsage);
	const [sessionUsage, setSessionUsage] = createSignal<
		ModelUsage | undefined
	>();
	// Once a session on one of our models has been seen, an unresolved switch
	// keeps the section up rather than hiding it; a cold start on someone else's
	// model still shows nothing.
	const [wasOurs, setWasOurs] = createSignal(false);

	void loadMeta()
		.then(setMeta)
		.catch(() => {});
	/** Scan the store for one model, remember what it says, and publish it. */
	const refreshModelUsage = (id: string | undefined, sinceMs: number) => {
		if (!id) return;
		const fresh = loadModelUsage(id, sinceMs);
		if (fresh) rememberModelUsage(id, fresh);
		setModelUsage(lastModelUsage);
	};

	const refresh = async () => {
		const kind = sessionKind(providerID());
		const session = sessionID();
		// Session totals are provider-agnostic and cheap (one indexed read).
		if (session) setSessionUsage(loadSessionUsage(session) ?? undefined);
		try {
			if (kind === "ours") {
				const snapshot = await loadUsage();
				rememberSnapshot(snapshot);
				setUsage(usageRows(snapshot));
				refreshModelUsage(activeModelId(), periodStart(snapshot));
			} else if (kind === "go" || kind === "zen") {
				setZen(await loadZen());
			}
		} catch {
			// the CLI is missing or offline: keep the last snapshot
		}
	};
	// Poll only while this session is one we cover. The panel returns no rows
	// otherwise, but an unconditional poll still spawned a CLI for every session
	// on every provider — and cmduse's spinner writes to /dev/tty.
	createEffect(() => {
		const kind = sessionKind(providerID());
		if (!shows(kind)) return;
		setWasOurs(true);
		void refresh();
		const timer = setInterval(() => void refresh(), POLL_MS);
		onCleanup(() => clearInterval(timer));
	});
	// `refresh` above is keyed on the provider, so a switch between two of our
	// models waited for the next minute poll — and showed the previous model's
	// figure until it landed. Track the id itself: the scan is sqlite (no process
	// spawn), and the seed keeps the row up while it runs.
	createEffect(() => {
		const id = activeModelId();
		if (sessionKind(providerID()) !== "ours" || !id) return;
		refreshModelUsage(id, periodStart(lastSnapshot ?? {}));
	});

	/** Only a figure belonging to the current model counts; else the seed. */
	const usageFor = (id: string | undefined): ModelUsage | undefined => {
		const seen = modelUsage();
		if (seen && (id === undefined || seen.key === modelKey(id))) {
			return seen.usage;
		}
		return seededModelUsage(id);
	};

	return createMemo(() => {
		const kind = sessionKind(providerID());
		if (!shows(kind) && (kind === "other" || !wasOurs())) return [];
		const id = activeModelId();
		const found = id ? (meta().get(modelKey(id)) ?? meta().get(id)) : undefined;
		if (kind === "go" || kind === "zen") {
			return zenRows(zen(), found, sessionUsage());
		}
		// gating keys are model ids, not display names, so tier comes from the
		// session's id rather than the catalog row.
		const model = found
			? {
					...found,
					tier: found.tier ?? (id ? tierFor(id) : undefined),
					minPlan: id ? minPlan(id) : undefined,
				}
			: undefined;
		// Account block, a rule, then the model block: two different subjects, and
		// without the divider the rows read as one long list.
		return [
			...usage(),
			separator(),
			...modelRows(model, usageFor(id), sessionUsage()),
		];
	});
}
