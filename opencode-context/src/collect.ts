/**
 * TUI-side collector: opencode's live session state -> BreakdownInput.
 *
 * Reads the *replayable* context (`session.context`, the same set a provider
 * would receive, post-compaction) rather than the full message history, so the
 * numbers describe the window that is actually loaded.
 */
import type { Plugin as Tui } from "@opencode/plugin/tui";
import {
	type Breakdown,
	computeBreakdown,
	measuredTokensOf,
} from "./breakdown";
import { readCapture } from "./capture";

type Ctx = Tui.Context;

function agentSystemBytes(
	ctx: Ctx,
	agentID: string | undefined,
	location: unknown,
): number | undefined {
	if (!agentID) return undefined;
	try {
		const agents = ctx.data.location.agent.list(location as never);
		const agent = agents?.find((entry) => entry.id === agentID);
		return agent?.system
			? new TextEncoder().encode(agent.system).length
			: undefined;
	} catch {
		return undefined;
	}
}

export async function collectBreakdown(
	ctx: Ctx,
	sessionID: string,
): Promise<Breakdown> {
	let messages: readonly unknown[] = [];
	try {
		messages = await ctx.client.session.context({ sessionID });
	} catch {
		// A client that rejects (older host, transient) still has the raw list.
		messages = ctx.data.session.message.list(sessionID) ?? [];
	}

	const session = ctx.data.session.get(sessionID);
	const models = ctx.data.location.model.list(session?.location as never);
	const model = models?.find(
		(entry) =>
			entry.providerID === session?.model?.providerID &&
			entry.id === session?.model?.id,
	);
	const capture = await readCapture(sessionID);

	return computeBreakdown({
		messages,
		systemBytes: capture?.systemBytes,
		toolDefsBytes: capture?.toolDefsBytes,
		measuredTokens: measuredTokensOf(messages),
		limit: model?.limit?.context,
		fallbackSystemBytes: agentSystemBytes(
			ctx,
			session?.agent,
			session?.location,
		),
	});
}
