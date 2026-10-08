/**
 * Pure breakdown of a session's context window into delta.app-style buckets.
 *
 * One implementation, two collectors: the TUI dialog reads opencode's live
 * `data` (messages, model limit) plus the request capture the server half wrote;
 * the `context_breakdown` tool reads the same shapes from the server API. The
 * numbers agree because the folding below is the only place that classifies a
 * part.
 *
 * Units: **bytes** are UTF-8 (what delta shows in its size column), **tokens**
 * are a 4-chars-per-token estimate matching opencode's own `Token.estimate`.
 * The header's measured count is the provider's real number and can differ.
 */
import { formatBytes, formatPercent, formatTokens } from "./format";

export type Tone =
	| "thinking"
	| "outputs"
	| "system"
	| "inputs"
	| "user"
	| "assistant"
	| "toolDefs"
	| "other";

export interface Bucket {
	readonly key: string;
	readonly label: string;
	readonly tone: Tone;
	readonly bytes: number;
	readonly tokens: number;
	/** Per-tool split, only for Tool Outputs. */
	readonly children: readonly Bucket[];
}

export interface BreakdownInput {
	/** The replayable context (`/api/session/{id}/context`), not the whole history. */
	readonly messages: readonly unknown[];
	/** UTF-8 bytes of the assembled system prompt, from the request capture. */
	readonly systemBytes?: number;
	/** UTF-8 bytes of the tool definitions, from the request capture. */
	readonly toolDefsBytes?: number;
	/** Provider-measured tokens for the last turn (header numerator). */
	readonly measuredTokens?: number;
	/** Model context window in tokens (header denominator). */
	readonly limit?: number;
	/** Agent instructions size, used only when there is no request capture. */
	readonly fallbackSystemBytes?: number;
}

export interface Breakdown {
	readonly buckets: readonly Bucket[];
	readonly totalBytes: number;
	readonly totalTokens: number;
	readonly measuredTokens?: number;
	readonly limit?: number;
	readonly percent?: number;
}

const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).length;
const tokenEstimate = (value: string): number => Math.ceil(value.length / 4);

function json(value: unknown): string {
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

class Acc {
	bytes = 0;
	tokens = 0;
	add(text: string): this {
		if (text) {
			this.bytes += byteLength(text);
			this.tokens += tokenEstimate(text);
		}
		return this;
	}
	addBytes(size: number): this {
		if (size > 0) {
			this.bytes += size;
			this.tokens += Math.ceil(size / 4);
		}
		return this;
	}
}

// Structural views of SessionMessageInfo. The host types are not a dependency
// here (this module is bundled into both halves), so narrow defensively.
interface PartLike {
	readonly type?: string;
	readonly text?: string;
	readonly name?: string;
	readonly state?: {
		readonly status?: string;
		readonly input?: unknown;
		readonly content?: unknown;
		readonly error?: unknown;
	};
}
interface FileLike {
	readonly data?: string;
}
interface MessageLike {
	readonly type?: string;
	readonly text?: string;
	readonly content?: readonly PartLike[];
	readonly summary?: string;
	readonly recent?: string;
	readonly command?: string;
	readonly output?: unknown;
	readonly files?: readonly FileLike[];
}

/** Text carried by a tool result: text content joined, files as their URI JSON. */
function resultText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((entry) => {
			if (entry && typeof entry === "object") {
				const text = (entry as { text?: unknown }).text;
				if (typeof text === "string") return text;
			}
			return json(entry);
		})
		.join("");
}

function outputText(output: unknown): string {
	if (typeof output === "string") return output;
	if (output && typeof output === "object") {
		const inner = (output as { output?: unknown }).output;
		if (typeof inner === "string") return inner;
		return json(output);
	}
	return "";
}

/** Longest-first so the bar and the rows share one order. */
const bySize = (a: Bucket, b: Bucket): number => b.bytes - a.bytes;

export function computeBreakdown(input: BreakdownInput): Breakdown {
	const system = new Acc();
	const thinking = new Acc();
	const inputs = new Acc();
	const user = new Acc();
	const assistant = new Acc();
	const other = new Acc();
	const checkpoint = new Acc();
	const outputs = new Map<string, Acc>();
	const outputsAcc = new Acc();

	for (const raw of input.messages) {
		const message = raw as MessageLike;
		switch (message.type) {
			case "user": {
				user.add(message.text ?? "");
				for (const file of message.files ?? []) {
					// The stored attachment is base64; decoded is ~3/4 the length.
					if (typeof file.data === "string")
						user.addBytes(Math.floor(file.data.length * 0.75));
				}
				break;
			}
			case "synthetic":
				user.add(message.text ?? "");
				break;
			case "assistant": {
				for (const part of message.content ?? []) {
					if (part.type === "text") {
						assistant.add(part.text ?? "");
					} else if (part.type === "reasoning") {
						thinking.add(part.text ?? "");
					} else if (part.type === "tool") {
						const name = part.name ?? "tool";
						inputs.add(name);
						inputs.add(json(part.state?.input));
						const result = outputs.get(name) ?? new Acc();
						result.add(resultText(part.state?.content));
						if (part.state?.status === "error")
							result.add(json(part.state.error));
						outputs.set(name, result);
					}
				}
				break;
			}
			case "system":
				system.add(message.text ?? "");
				break;
			case "shell":
				other.add(`${message.command ?? ""}\n${outputText(message.output)}`);
				break;
			case "skill":
				other.add(message.text ?? "");
				break;
			case "compaction":
				checkpoint.add(message.summary ?? "");
				checkpoint.add(message.recent ?? "");
				break;
			default:
				break;
		}
	}

	for (const value of outputs.values()) {
		outputsAcc.bytes += value.bytes;
		outputsAcc.tokens += value.tokens;
	}

	// The system prompt and tool schemas are not in the message store: the
	// server half captures their real sizes from the assembled request.
	if (input.systemBytes !== undefined) system.addBytes(input.systemBytes);
	else system.addBytes(input.fallbackSystemBytes ?? 0);
	const toolDefs = new Acc();
	toolDefs.addBytes(input.toolDefsBytes ?? 0);

	const children: Bucket[] = [...outputs.entries()]
		.map(([name, value]) =>
			makeBucket(`output:${name}`, name, "outputs", value),
		)
		.sort(bySize);

	const buckets: Bucket[] = [
		makeBucket("outputs", "Tool Outputs", "outputs", outputsAcc, children),
		makeBucket("thinking", "Thinking Blocks", "thinking", thinking),
		makeBucket("system", "System Prompt", "system", system),
		makeBucket("inputs", "Tool Inputs", "inputs", inputs),
		makeBucket("user", "User Messages", "user", user),
		makeBucket("assistant", "Assistant Prose", "assistant", assistant),
		makeBucket("toolDefs", "Tool Definitions", "toolDefs", toolDefs),
		makeBucket("checkpoint", "Conversation Checkpoint", "other", checkpoint),
		makeBucket("other", "Other", "other", other),
	]
		.filter(
			(bucket) =>
				bucket.bytes > 0 &&
				!(bucket.key === "toolDefs" && input.toolDefsBytes === undefined),
		)
		.sort(bySize);

	const totalBytes = buckets.reduce((n, bucket) => n + bucket.bytes, 0);
	const totalTokens = buckets.reduce((n, bucket) => n + bucket.tokens, 0);
	// Callers usually pass the measured count; derive it from the messages when
	// they do not, so the header is never accidentally blank.
	const measured = input.measuredTokens ?? measuredTokensOf(input.messages);
	const percent =
		measured !== undefined && input.limit
			? Math.round((measured / input.limit) * 100)
			: undefined;
	return {
		buckets,
		totalBytes,
		totalTokens,
		measuredTokens: measured,
		limit: input.limit,
		percent,
	};
}

function makeBucket(
	key: string,
	label: string,
	tone: Tone,
	source: Acc,
	children: readonly Bucket[] = [],
): Bucket {
	return {
		key,
		label,
		tone,
		bytes: source.bytes,
		tokens: source.tokens,
		children,
	};
}

interface TokenLike {
	readonly input?: number;
	readonly output?: number;
	readonly reasoning?: number;
	readonly cache?: { readonly read?: number; readonly write?: number };
}

/** Provider-measured tokens for the newest assistant turn — the header number. */
export function measuredTokensOf(
	messages: readonly unknown[],
): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { type?: string; tokens?: TokenLike };
		if (message.type !== "assistant" || !message.tokens) continue;
		const tokens = message.tokens;
		return (
			(tokens.input ?? 0) +
			(tokens.output ?? 0) +
			(tokens.reasoning ?? 0) +
			(tokens.cache?.read ?? 0) +
			(tokens.cache?.write ?? 0)
		);
	}
	return undefined;
}

/** The tool's output: same numbers, as markdown for the model to read back. */
export function renderMarkdown(breakdown: Breakdown): string {
	const header =
		breakdown.measuredTokens !== undefined
			? `${formatTokens(breakdown.measuredTokens)} / ${
					breakdown.limit !== undefined ? formatTokens(breakdown.limit) : "?"
				} tokens${breakdown.percent !== undefined ? ` (${breakdown.percent}%)` : ""}`
			: "measured tokens unavailable";
	const lines = [
		"## Context Window",
		"",
		`**${header}** · ${formatBytes(breakdown.totalBytes)} across categories (sizes are UTF-8 bytes; per-category tokens are a 4-chars/token estimate)`,
		"",
		"| Category | Size | Est. tokens | Share |",
		"| --- | ---: | ---: | ---: |",
	];
	const row = (label: string, bytes: number, tokens: number): string =>
		`| ${label} | ${formatBytes(bytes)} | ${formatTokens(tokens)} | ${formatPercent(
			bytes,
			breakdown.totalBytes,
		)} |`;
	for (const bucket of breakdown.buckets) {
		lines.push(row(bucket.label, bucket.bytes, bucket.tokens));
		for (const child of bucket.children) {
			lines.push(row(`└ ${child.label}`, child.bytes, child.tokens));
		}
	}
	return lines.join("\n");
}
