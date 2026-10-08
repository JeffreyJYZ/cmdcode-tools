/**
 * Server half (opencode v2): captures the assembled system prompt and tool
 * definitions on every request (their sizes only — the message store cannot
 * see them) and exposes the `context_breakdown` tool so the model can ask where
 * the window went. The /context dialog lives in the TUI half (./tui).
 */
import type { Plugin as PluginNs } from "@opencode/plugin";
import {
	computeBreakdown,
	measuredTokensOf,
	renderMarkdown,
} from "./breakdown";
import { readCapture, writeCapture } from "./capture";
import { SERVER_ID } from "./constants/ids";
import { TOOL_DESCRIPTION } from "./constants/tool";

export { TOOL_DESCRIPTION };

const encoder = new TextEncoder();
const bytesOf = (value: string): number => encoder.encode(value).length;

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

export const contextPlugin: PluginNs.Plugin = {
	id: SERVER_ID,
	async setup(ctx) {
		// The system prompt and tool schemas are built per request and never
		// stored, so measure them here and hand the sizes to the TUI half.
		await ctx.session.hook("context", (event) => {
			try {
				const systemBytes = (event.system ?? []).reduce(
					(total, part) => total + bytesOf(part?.text ?? ""),
					0,
				);
				const toolDefsBytes = Object.entries(event.tools ?? {}).reduce(
					(total, [name, definition]) =>
						total +
						bytesOf(
							name +
								(definition?.description ?? "") +
								safeJson(definition?.input),
						),
					0,
				);
				void writeCapture(String(event.sessionID), {
					systemBytes,
					toolDefsBytes,
					at: Date.now(),
				});
			} catch {
				// A missing capture only costs two rows in the dialog.
			}
		});

		await ctx.tool.transform((editor) => {
			editor.add({
				name: "context_breakdown",
				description: TOOL_DESCRIPTION,
				input: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				async execute(_input: unknown, toolCtx: { sessionID: string }) {
					const sessionID = String(toolCtx.sessionID);
					const messages = await ctx.session.context({ sessionID });
					const session = await ctx.session.get({ sessionID });
					const capture = await readCapture(sessionID);
					let limit: number | undefined;
					try {
						const models = await ctx.model.list({
							location: session?.location as never,
						});
						const model = models?.data?.find(
							(entry) =>
								entry.providerID === session?.model?.providerID &&
								entry.id === session?.model?.id,
						);
						limit = model?.limit?.context;
					} catch {
						// No limit: the header shows "?" and omits the percent.
					}
					const breakdown = computeBreakdown({
						messages,
						systemBytes: capture?.systemBytes,
						toolDefsBytes: capture?.toolDefsBytes,
						measuredTokens: measuredTokensOf(messages),
						limit,
					});
					return { content: renderMarkdown(breakdown) };
				},
			} as never);
		});
	},
};

export default contextPlugin;
