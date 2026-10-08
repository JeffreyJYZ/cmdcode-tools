import { describe, expect, test } from "bun:test";
import { SERVER_ID, TUI_ID } from "../src/constants/ids";
import { TOOL_DESCRIPTION } from "../src/constants/tool";
import serverPlugin from "../src/index";
import tuiPlugin from "../src/tui";

type Claim = { append?: string; render: (input: never) => unknown };

function captureTui() {
	const claims: Claim[] = [];
	const ctx = {
		ui: { slot: (claim: Claim) => void claims.push(claim) },
		keymap: { layer: () => {} },
	};
	tuiPlugin.setup?.(ctx as never);
	return claims;
}

describe("tui plugin definition", () => {
	test("exports a v2 definition with the pinned id", () => {
		expect(tuiPlugin.id).toBe(TUI_ID);
		expect(typeof tuiPlugin.setup).toBe("function");
	});

	test("mounts an app slot that returns void", () => {
		const claims = captureTui();
		expect(claims.map((claim) => claim.append)).toEqual(["app"]);
		expect(claims[0]?.render(undefined as never)).toBeUndefined();
	});
});

describe("server plugin definition", () => {
	test("exports a v2 definition with the pinned id", () => {
		expect(serverPlugin.id).toBe(SERVER_ID);
		expect(typeof serverPlugin.setup).toBe("function");
	});

	test("registers the context hook and the context_breakdown tool", async () => {
		const hooks: string[] = [];
		const tools: { name?: string; description?: string }[] = [];
		const ctx = {
			session: { hook: async (name: string) => void hooks.push(name) },
			tool: {
				transform: async (edit: (editor: unknown) => void) =>
					edit({ add: (tool: { name?: string }) => void tools.push(tool) }),
			},
		};
		await serverPlugin.setup?.(ctx as never);
		expect(hooks).toEqual(["context"]);
		expect(tools[0]?.name).toBe("context_breakdown");
		expect(tools[0]?.description).toBe(TOOL_DESCRIPTION);
	});
});
