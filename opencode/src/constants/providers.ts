// Provider/integration identity and the two-wire lane table.

/** Provider-id prefix shared by both Command Code lanes and the plugin id. */
export const PROVIDER_ID_PREFIX = "command-code";

/** Plugin id (stable contract; the v2 `setup` definition and the TUI share it). */
export const PLUGIN_ID = PROVIDER_ID_PREFIX;

/** Integration id backing both lanes' credentials (/connect + env). */
export const INTEGRATION_ID = PROVIDER_ID_PREFIX;

/** Display name for the integration and the no-key warning. */
export const INTEGRATION_NAME = "Command Code";

/** OpenCode Go provider id (ocuse reads its store). */
export const GO_PROVIDER_ID = "opencode-go";

/** OpenCode Zen provider id and its `opencode-zen` alias prefix. */
export const ZEN_PROVIDER_ID = "opencode";
export const ZEN_PROVIDER_PREFIX = "opencode-zen";

/** TUI plugin id (stable contract; test/tui.test.ts pins it). */
export const TUI_ID = "command-code.tui";

/** The cmd_usage tool description, shared by the v1 and v2 halves. */
export const TOOL_DESCRIPTION =
	"Fetch live Command Code plan/usage: plan name, monthly credits, 5-hour & weekly windows, billing-period summary. Pass arg='plans' for the plan comparison table only, or extra cmduse flags (e.g. '--tz +05:30 daily').";

export type Lane = {
	id: "command-code-anthropic" | "command-code-openai";
	name: string;
	/** v2 runtime package (first-party, distinct from the v1 `npm` value). */
	pkg: string;
	/** Wire field reasoning must round-trip through on the openai-compatible
	 * lane; v2 spells the old `interleaved: {field}` as `compatibility`. */
	reasoningField?: string;
};

/** The Anthropic and OpenAI-compatible provider lanes this plugin owns. */
export const LANES: Lane[] = [
	{
		id: "command-code-anthropic",
		name: "Command Code (Anthropic)",
		pkg: "@opencode/ai/providers/anthropic",
	},
	{
		id: "command-code-openai",
		name: "Command Code (OpenAI)",
		pkg: "@opencode/ai/providers/openai-compatible",
		reasoningField: "reasoning_content",
	},
];
