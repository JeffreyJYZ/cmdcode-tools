import { describe, expect, test } from "bun:test";
import { buildAsks } from "#~/measure/asks.ts";
import type { RawMessage, RawTokens } from "#~/measure/rows.ts";
import type { SessionRow } from "#~/measure/store.ts";

const SESSION = "ses_1";

function message(
	kind: string,
	time: number,
	extra: Partial<RawMessage> = {},
): RawMessage {
	return {
		sessionID: SESSION,
		kind,
		time,
		text: "",
		model: "glm-5.2",
		provider: "opencode-go",
		tokens: null,
		cost: 0,
		...extra,
	};
}

function tokens(input: number, output: number, read = 0): RawTokens {
	return { input, output, cache: { read, write: 0 } };
}

const sessions = new Map<string, SessionRow>([
	[SESSION, { child: false, directory: "/dev/one" }],
]);

describe("buildAsks", () => {
	test("an ask is the run of reqs after its prompt, numbered across the session", () => {
		const asks = buildAsks(
			[
				message("user", 1_000, { text: "add a flag" }),
				message("assistant", 2_000, { tokens: tokens(100, 10) }),
				message("assistant", 3_000, { tokens: tokens(200, 20) }),
				message("user", 4_000, { text: "now test it" }),
				message("assistant", 5_000, { tokens: tokens(300, 30) }),
			],
			sessions,
		);
		expect(asks).toHaveLength(2);
		expect(asks[0]?.text).toBe("add a flag");
		expect(asks[0]?.reqs.map((req) => req.position)).toEqual([1, 2]);
		expect(asks[0]?.directory).toBe("/dev/one");
		// Position counts across the session, not the ask: this is the axis the
		// re-read context grows along.
		expect(asks[1]?.reqs.map((req) => req.position)).toEqual([3]);
	});

	test("bookkeeping rows continue an ask instead of opening one", () => {
		const asks = buildAsks(
			[
				message("user", 1_000, { text: "go" }),
				message("assistant", 2_000, { tokens: tokens(1, 1) }),
				message("idle", 2_500),
				message("model-switched", 2_600),
				message("agent-switched", 2_700),
				message("assistant", 3_000, { tokens: tokens(1, 1) }),
			],
			sessions,
		);
		expect(asks).toHaveLength(1);
		expect(asks[0]?.reqs).toHaveLength(2);
	});

	test("interjections continue the ask instead of opening one", () => {
		const asks = buildAsks(
			[
				message("user", 1_000, { text: "hi" }),
				message("assistant", 1_100, { tokens: tokens(1, 1) }),
				message("synthetic", 2_000, { text: "continue" }),
				message("assistant", 2_100, { tokens: tokens(1, 1) }),
				message("system", 3_000),
				message("assistant", 3_100, { tokens: tokens(1, 1) }),
				message("compaction", 4_000, { text: "summary" }),
				message("shell", 5_000),
				message("assistant", 5_100, { tokens: tokens(1, 1) }),
			],
			sessions,
		);
		// One user ask holds every req: the interjections did not split it, so
		// the responses that followed them are no longer dropped with it.
		expect(asks).toHaveLength(1);
		expect(asks[0]?.kind).toBe("user");
		expect(asks[0]?.reqs).toHaveLength(4);
	});

	test("streaming turns are skipped and reqs before a prompt are kept as orphans", () => {
		const asks = buildAsks(
			[
				message("assistant", 1_000, { tokens: tokens(5, 5) }),
				message("assistant", 1_100),
				message("user", 2_000, { text: "hello" }),
				message("assistant", 2_100, { tokens: tokens(6, 6) }),
			],
			sessions,
		);
		expect(asks[0]?.kind).toBe("orphan");
		expect(asks[0]?.reqs).toHaveLength(1);
		expect(asks[1]?.reqs).toHaveLength(1);
		// Position still runs across the session, orphan included.
		expect(asks[1]?.reqs[0]?.position).toBe(2);
	});

	test("positions restart per session", () => {
		const two = new Map<string, SessionRow>([
			[SESSION, { child: false, directory: "/dev/one" }],
			["ses_2", { child: true, directory: "/dev/two" }],
		]);
		const asks = buildAsks(
			[
				message("user", 1_000, { text: "one" }),
				message("assistant", 1_100, { tokens: tokens(1, 1) }),
				{
					...message("user", 2_000, { text: "two" }),
					sessionID: "ses_2",
				},
				{
					...message("assistant", 2_100, { tokens: tokens(1, 1) }),
					sessionID: "ses_2",
				},
			],
			two,
		);
		expect(asks.map((ask) => ask.reqs[0]?.position)).toEqual([1, 1]);
		expect(asks[1]?.child).toBe(true);
		expect(asks[1]?.directory).toBe("/dev/two");
	});

	test("an unknown session yields empty context rather than throwing", () => {
		const asks = buildAsks(
			[
				message("user", 1_000, { text: "hi" }),
				message("assistant", 1_100, { tokens: tokens(1, 1) }),
			],
			new Map(),
		);
		expect(asks[0]?.directory).toBe("");
		expect(asks[0]?.child).toBe(false);
	});
});
