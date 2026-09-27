// Sidebar data hook: cmduse polled once a minute for account totals, mpc's
// catalog read from disk, and opencode's own store for the active model's
// period usage (the account API has no per-model dimension).
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { minPlan } from "../catalog";
import { loadMeta, loadUsage } from "./data";
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
import { loadModelUsage, periodStart } from "./usageDb";

// A minute is plenty: the numbers move on request boundaries, not continuously,
// and each poll is a process spawn.
const POLL_MS = 60_000;

/** Which provider a session is on, as far as this panel is concerned. */
export type SessionKind = "ours" | "other" | "unknown";

/**
 * `unknown` is the frame during a session switch, before the host has resolved
 * the new session's model. It must not be read as "another provider", or the
 * panel blanks and refetches on every tab change.
 */
export function sessionKind(providerID: string | undefined): SessionKind {
	if (!providerID) return "unknown";
	return providerID.startsWith("command-code") ? "ours" : "other";
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

export function useRows(
	activeModelId: () => string | undefined,
	providerID: () => string | undefined,
) {
	const [usage, setUsage] = createSignal<SidebarRow[]>(seededRows());
	const [meta, setMeta] = createSignal<Map<string, ModelMeta>>(new Map());
	const [modelUsage, setModelUsage] = createSignal<ModelUsage | undefined>();
	// Once a session on one of our models has been seen, an unresolved switch
	// keeps the section up rather than hiding it; a cold start on someone else's
	// model still shows nothing.
	const [wasOurs, setWasOurs] = createSignal(false);

	void loadMeta()
		.then(setMeta)
		.catch(() => {});
	const refresh = async () => {
		try {
			const snapshot = await loadUsage();
			rememberSnapshot(snapshot);
			setUsage(usageRows(snapshot));
			const id = activeModelId();
			setModelUsage(
				id
					? (loadModelUsage(id, periodStart(snapshot)) ?? undefined)
					: undefined,
			);
		} catch {
			// cmduse missing/offline: keep the last snapshot
		}
	};
	// Poll only while this session is on one of our models. The panel returns no
	// rows otherwise, but an unconditional poll still spawned cmduse for every
	// session on every provider — and cmduse's spinner writes to /dev/tty.
	createEffect(() => {
		const kind = sessionKind(providerID());
		if (kind !== "ours") return;
		setWasOurs(true);
		void refresh();
		const timer = setInterval(() => void refresh(), POLL_MS);
		onCleanup(() => clearInterval(timer));
	});

	return createMemo(() => {
		const kind = sessionKind(providerID());
		if (kind === "other") return [];
		if (kind === "unknown" && !wasOurs()) return [];
		const id = activeModelId();
		const found = id ? (meta().get(modelKey(id)) ?? meta().get(id)) : undefined;
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
		return [...usage(), separator(), ...modelRows(model, modelUsage())];
	});
}
