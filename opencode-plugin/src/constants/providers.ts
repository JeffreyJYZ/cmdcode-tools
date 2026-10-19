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

/** The v2 /cmd-usage slash command id (registered and bound in tui.tsx). */
export const CMD_USAGE_COMMAND_ID = "command-code.cmd-usage";

/** The v2 /ocuse-usage slash command id (registered and bound in tui.tsx). */
export const OCUSE_USAGE_COMMAND_ID = "command-code.ocuse-usage";

/** The v2 /arkuse-usage slash command id (registered and bound in tui.tsx). */
export const ARKUSE_USAGE_COMMAND_ID = "command-code.arkuse-usage";

/** The cmd_usage tool description, shared by the v1 and v2 halves. */
export const TOOL_DESCRIPTION =
	"Fetch live Command Code plan/usage: plan name, monthly credits, 5-hour & weekly windows, billing-period summary. Pass arg='plans' for the plan comparison table only, or extra cmduse flags (e.g. '--tz +05:30 daily').";

/** The mpc_prices tool description, shared by the v1 and v2 halves. */
export const MPC_TOOL_DESCRIPTION =
	"Per-model price comparison: what a model costs per request ($/1M input, output and cache rates) and per month (request allowance) on each Command Code (cc) and OpenCode Go (oc) plan side, plus ability, Tok/s, the cheaper-side verdict and running deals. Pass '--model <regex>' to filter rows, '--minimal' | '--medium' | '--detail' for table width, '--json' for the full structured rows, '--cc-plan' / '--oc-plan' to pick a plan, or '--usage' to project real usage.";

/** The mpc_prices `arg` description, shared by the v1 and v2 halves. */
export const MPC_TOOL_ARG_DESCRIPTION =
	"Optional mpc flags: '--model <regex>' filters rows, '--minimal' | '--medium' | '--detail' set table width, '--json' for full structured rows, '--cc-plan'/'--oc-plan' pick a plan, '--usage' projects real usage";

/** The ocuse_usage tool description, shared by the v1 and v2 halves. */
export const OCUSE_TOOL_DESCRIPTION =
	"Fetch live OpenCode Go/Zen usage: the account's window meters, per-model spend against limits, 5-hour & weekly windows, billing-period summary. Defaults to the one-shot dashboard; pass extra ocuse flags for more (e.g. '--plan go-plus', 'daily', '--json').";

/** The ocuse_usage `arg` description, shared by the v1 and v2 halves. */
export const OCUSE_TOOL_ARG_DESCRIPTION =
	"Optional: extra ocuse flags (e.g. '--plan go-plus', 'daily', '--json'); empty means the one-shot dashboard";

/** The arkuse_usage tool description, shared by the v1 and v2 halves. */
export const ARKUSE_TOOL_DESCRIPTION =
	"Fetch live Volcengine ARK Agent Plan usage in AFP: the plan's 5-hour/weekly/monthly meters from arkcli, this machine's per-model AFP, and the reconciliation between them. Defaults to the one-shot dashboard; pass extra arkuse flags for more (e.g. 'daily', '--plan medium', '--json').";

/** The arkuse_usage `arg` description, shared by the v1 and v2 halves. */
export const ARKUSE_TOOL_ARG_DESCRIPTION =
	"Optional: extra arkuse flags (e.g. '--plan medium', '--profile <name>', 'daily', '--json'); empty means the one-shot dashboard";

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
export const LANES: [Lane, Lane] = [
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
