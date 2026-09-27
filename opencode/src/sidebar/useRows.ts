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
	separator,
	tierFor,
	usageRows,
} from "./rows";
import { loadModelUsage, periodStart } from "./usageDb";

// A minute is plenty: the numbers move on request boundaries, not continuously,
// and each poll is a process spawn.
const POLL_MS = 60_000;

export function useRows(
	activeModelId: () => string | undefined,
	active: () => boolean,
) {
	const [usage, setUsage] = createSignal<ReturnType<typeof usageRows>>([]);
	const [meta, setMeta] = createSignal<Map<string, ModelMeta>>(new Map());
	const [modelUsage, setModelUsage] = createSignal<ModelUsage | undefined>();

	void loadMeta()
		.then(setMeta)
		.catch(() => {});
	const refresh = async () => {
		try {
			const snapshot = await loadUsage();
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
		if (!active()) return;
		void refresh();
		const timer = setInterval(() => void refresh(), POLL_MS);
		onCleanup(() => clearInterval(timer));
	});

	return createMemo(() => {
		if (!active()) return [];
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
