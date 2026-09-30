// Sidebar data hook: cmduse polled every 5s for CommandCode account totals,
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
import { loadModelUsage, loadSessionUsage, usageDbPath } from "./usageDb";
import { type ZenUsage, zenRows } from "./zen";

// Refresh cadence. The sqlite reads (this session, this model) are free; the
// cmduse/ocuse spawn behind them is not — it costs a process and an account API
// call each time, so 5s is deliberately hot: it is the cadence of a panel you
// are watching, not of one left open.
const POLL_MS = 5_000;

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

/**
 * The last mpc catalog this process loaded. The account block (`lastSnapshot`)
 * and the per-model figure (`lastModelUsage`) both survive a remount, but the
 * catalog had no such memory: `meta` started as an empty Map and only filled
 * after a successful mpc spawn, so a remount during a network outage blanked the
 * whole model block — name, tier, rates and the local `Usage (this model)` row —
 * while the account rows stayed up. mpc needs the network, so the remount could
 * sit empty for as long as the outage lasted.
 */
let lastMeta: Map<string, ModelMeta> | undefined;

/** Keep a catalog for the next panel that needs it. An empty map is never
 * remembered: it cannot be distinguished from "mpc returned nothing" and would
 * wipe a good catalog. */
export function rememberMeta(meta: Map<string, ModelMeta>): void {
	if (meta.size > 0) lastMeta = meta;
}

/** Rows to paint before mpc's catalog is read again. */
export function seededMeta(): Map<string, ModelMeta> {
	return lastMeta ?? new Map();
}

export function useRows(
	activeModelId: () => string | undefined,
	providerID: () => string | undefined,
	sessionID: () => string | undefined,
) {
	const [usage, setUsage] = createSignal<SidebarRow[]>(seededRows());
	const [zen, setZen] = createSignal<ZenUsage | undefined>();
	const [meta, setMeta] = createSignal<Map<string, ModelMeta>>(seededMeta());
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

	/**
	 * Re-read the catalog. A file read unless its TTL lapsed, so calling it on
	 * every poll costs nothing and means a catalog change — a new model, a
	 * promotion, a configured AA key — reaches a *running* panel instead of
	 * waiting for the client to be restarted.
	 */
	const refreshMeta = (): void => {
		void loadMeta()
			.then((next) => {
				rememberMeta(next);
				if (next.size > 0) setMeta(next);
			})
			.catch(() => {});
	};
	refreshMeta();
	/** Scan the store for one model in this conversation, and publish it. */
	const refreshModelUsage = (id: string | undefined) => {
		if (!id) return;
		const fresh = loadModelUsage(id, 0, usageDbPath(), sessionID());
		if (fresh) rememberModelUsage(id, fresh);
		setModelUsage(lastModelUsage);
	};

	// One poll in flight at a time. During an outage a single cmduse invocation
	// can sit in its retry ladder for a while, and the 5s interval would stack a
	// new spawn on every tick; when the network returned those landed out of
	// order, repainting the flapping snapshot the user saw. `data.ts` bounds each
	// spawn too, so a black-hole fetch cannot pin this flag forever.
	let inFlight = false;
	const refresh = async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			const kind = sessionKind(providerID());
			const session = sessionID();
			refreshMeta();
			// Session totals are provider-agnostic and cheap (one indexed read).
			if (session) setSessionUsage(loadSessionUsage(session) ?? undefined);
			if (kind === "ours") {
				const snapshot = await loadUsage();
				rememberSnapshot(snapshot);
				setUsage(usageRows(snapshot));
				refreshModelUsage(activeModelId());
			} else if (kind === "go" || kind === "zen") {
				setZen(await loadZen());
			}
		} catch {
			// the CLI is missing, offline, or returned its errored defaults: keep
			// the last snapshot rather than painting "Free" with no windows.
		} finally {
			inFlight = false;
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
	// figure until it landed. Track the model *and* the session, because the
	// figure counts this conversation's turns: a tab change keeps the provider,
	// so the poll alone would only notice a minute later. The scan is sqlite (no
	// process spawn) and the seed keeps the row up while it runs.
	createEffect(() => {
		const id = activeModelId();
		const session = sessionID();
		if (sessionKind(providerID()) !== "ours" || !id || !session) return;
		refreshModelUsage(id);
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
		// The session id is the only name available when the catalog is missing;
		// its vendor prefix is noise, so keep the tail.
		const fallbackName = id ? (id.split("/").pop() ?? id) : undefined;
		if (kind === "go" || kind === "zen") {
			return zenRows(zen(), found, sessionUsage(), fallbackName);
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
			...modelRows(model, usageFor(id), sessionUsage(), fallbackName),
		];
	});
}
