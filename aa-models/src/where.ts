import type { Model } from "#~/model.ts";

export interface WhereClause {
	path: string;
	op: "=" | "!=" | ">" | ">=" | "<" | "<=" | "~";
	value: string;
}

const OPS = ["!=", ">=", "<=", "=", ">", "<", "~"] as const;

/** Resolve a dot-path into the record, stopping at the first non-object. */
export function resolvePath(value: unknown, path: string): unknown {
	let cur: unknown = value;
	for (const key of path.split(".")) {
		if (cur === null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

/** A clause's path, operator and value; `null` when the expression is unusable. */
export function parseWhere(expr: string): WhereClause | null {
	const match = /^\s*([A-Za-z0-9_.\-[\]]+)\s*(!=|>=|<=|=|>|<|~)\s*(.*?)\s*$/.exec(expr);
	if (!match) return null;
	const path = match[1];
	const op = match[2];
	if (path === undefined || op === undefined) return null;
	if (!OPS.includes(op as (typeof OPS)[number])) return null;
	return { path, op: op as WhereClause["op"], value: match[3] ?? "" };
}

export function asText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
	if (typeof value === "object") return null;
	return String(value);
}

export function isMissing(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	return typeof value === "number" && !Number.isFinite(value);
}

/** Case-insensitive regex, substring when the user's text is not a pattern. */
export function like(text: string, needle: string): boolean {
	try {
		return new RegExp(needle, "i").test(text);
	} catch {
		return text.toLowerCase().includes(needle.toLowerCase());
	}
}

function numeric(op: WhereClause["op"], left: number, want: string): boolean | null {
	const right = Number(want);
	if (want.trim() === "" || !Number.isFinite(right)) return null;
	switch (op) {
		case "=":
			return left === right;
		case "!=":
			return left !== right;
		case ">":
			return left > right;
		case ">=":
			return left >= right;
		case "<":
			return left < right;
		case "<=":
			return left <= right;
		default:
			return null;
	}
}

function compareText(text: string, clause: WhereClause): boolean {
	const want = clause.value;
	switch (clause.op) {
		case "=":
			return text.toLowerCase() === want.toLowerCase();
		case "!=":
			return text.toLowerCase() !== want.toLowerCase();
		case "~":
			return like(text, want);
		case ">":
			return text > want;
		case ">=":
			return text >= want;
		case "<":
			return text < want;
		default:
			return text <= want;
	}
}

/** One clause against one resolved value. Missing never satisfies a clause. */
export function testValue(value: unknown, clause: WhereClause): boolean {
	if (isMissing(value)) return false;
	if (Array.isArray(value)) {
		if (clause.op === "~") return value.some((item) => like(String(item), clause.value));
		return compareText(asText(value) ?? "", clause);
	}
	if (typeof value === "number") {
		const answer = numeric(clause.op, value, clause.value);
		if (answer !== null) return answer;
		return compareText(String(value), clause);
	}
	return compareText(asText(value) ?? "", clause);
}

export function matchesWhere(model: Model, clause: WhereClause): boolean {
	return testValue(resolvePath(model, clause.path), clause);
}
