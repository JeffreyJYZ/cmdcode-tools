import { BOUNDARY } from "#~/constants/asks.ts";
import type { Ask, AskKind, Req } from "#~/types.ts";
import { numberOr, type RawMessage } from "./rows.ts";
import type { SessionRow } from "./store.ts";

function toReq(message: RawMessage, position: number): Req {
	const tokens = message.tokens;
	return {
		model: message.model,
		provider: message.provider,
		tokensIn: numberOr(tokens?.input) ?? 0,
		output: numberOr(tokens?.output) ?? 0,
		reasoning: numberOr(tokens?.reasoning) ?? 0,
		cacheRead: numberOr(tokens?.cache?.read) ?? 0,
		cacheWrite: numberOr(tokens?.cache?.write) ?? 0,
		cost: numberOr(message.cost) ?? 0,
		position,
	};
}

/**
 * Group a session's rows into asks. Messages arrive grouped by session and
 * ordered by the store's own sequence, so an ask is simply the run of assistant
 * rows between one boundary and the next. Position counts across the whole
 * session rather than the ask, because that is the axis a re-read context grows
 * along: the first request of a conversation is cheap, the hundredth is not.
 */
export function buildAsks(
	messages: RawMessage[],
	sessions: Map<string, SessionRow>,
): Ask[] {
	const asks: Ask[] = [];
	let current: Ask | null = null;
	let sessionID = "";
	let position = 0;

	const flush = () => {
		if (current) asks.push(current);
		current = null;
	};
	const open = (message: RawMessage, kind: AskKind): Ask => {
		const session = sessions.get(message.sessionID);
		return {
			sessionID: message.sessionID,
			directory: session?.directory ?? "",
			child: session?.child ?? false,
			kind,
			text: message.text,
			time: message.time,
			reqs: [],
		};
	};

	for (const message of messages) {
		if (message.sessionID !== sessionID) {
			flush();
			sessionID = message.sessionID;
			position = 0;
		}
		const boundary = BOUNDARY[message.kind];
		if (boundary) {
			flush();
			current = open(message, boundary);
			continue;
		}
		// Everything that is not a boundary continues the ask: bookkeeping rows
		// (idle, agent-switched, model-switched) and the interjections above.
		if (message.kind !== "assistant") continue;
		// A turn without tokens is still streaming; it has not been billed yet.
		if (!message.tokens) continue;
		position += 1;
		// Reqs before any boundary belong to nobody; keep them visible rather
		// than silently dropping them.
		current ??= open(message, "orphan");
		current.reqs.push(toReq(message, position));
	}
	flush();
	return asks;
}
