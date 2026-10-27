#!/usr/bin/env bun
// User token for the OpenCode Console, via the OAuth device flow.
//
//   bun scripts/console-auth.ts            # request a code, print the URL, wait for approval
//   bun scripts/console-auth.ts --refresh  # exchange the stored refresh token for a new access token
//
// A *user* token is the only credential that can read `/api/v1/budgets/members`:
// a service-account key (`oc_sk_…`) gets 403 no matter what permission it
// carries, because budgets fall under the docs' "actions that always require a
// person signed in". The token acts as you with your workspace role.
//
// Stored at ~/.config/opencode/console-user-token.json, mode 0600, never printed.
import { existsSync } from "node:fs";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CONSOLE = "https://opencode.ai/console";
const CLIENT_ID = "ocuse";

function arg(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
}

function expand(path: string): string {
	return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

interface Stored {
	access_token: string;
	refresh_token: string;
	org_id?: string;
	expires_at?: number;
	client_id?: string;
}

async function post(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
	const response = await fetch(`${CONSOLE}${path}`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	const text = await response.text();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(`${path}: HTTP ${response.status}: ${text.slice(0, 200)}`);
	}
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${text.slice(0, 200)}`);
	return parsed;
}

function save(out: string, stored: Stored, expiresIn?: number): void {
	mkdirSync(dirname(out), { recursive: true });
	const payload: Stored = {
		...stored,
		client_id: CLIENT_ID,
		expires_at: expiresIn ? Date.now() + expiresIn * 1000 : stored.expires_at,
	};
	writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
	chmodSync(out, 0o600);
}

const argv = process.argv.slice(2);
const out = resolve(expand(arg(argv, "--out") ?? "~/.config/opencode/console-user-token.json"));

if (argv.includes("--refresh")) {
	if (!existsSync(out)) {
		console.error(`no token at ${out}; run without --refresh first`);
		process.exit(1);
	}
	const stored = JSON.parse(readFileSync(out, "utf8")) as Stored;
	const result = await post("/auth/device/token", {
		grant_type: "refresh_token",
		refresh_token: stored.refresh_token,
		client_id: stored.client_id ?? CLIENT_ID,
	});
	save(out, {
		access_token: String(result.access_token),
		refresh_token: String(result.refresh_token),
		org_id: result.org_id ? String(result.org_id) : stored.org_id,
	});
	console.log(`refreshed → ${out}`);
	process.exit(0);
}

// 1. Ask for a device code bound to a workspace.
const code = await post("/auth/device/code", {
	client_id: CLIENT_ID,
	supports_org_scope: "true",
});
const deviceCode = String(code.device_code);
const uri = String(code.verification_uri_complete ?? "");
const completeUri = uri.startsWith("http") ? uri : `https://opencode.ai${uri}`;
const interval = Number(code.interval ?? 5);
const expiresIn = Number(code.expires_in ?? 600);

console.log(`open this and approve (code ${String(code.user_code ?? "")}):\n\n  ${completeUri}\n`);
console.log(`waiting up to ${Math.round(expiresIn / 60)} min, polling every ${interval}s…`);

// 2. Poll until approved, per RFC 8628.
const deadline = Date.now() + expiresIn * 1000;
while (Date.now() < deadline) {
	await Bun.sleep(interval * 1000);
	try {
		const result = await post("/auth/device/token", {
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: deviceCode,
			client_id: CLIENT_ID,
		});
		save(
			out,
			{
				access_token: String(result.access_token),
				refresh_token: String(result.refresh_token),
				org_id: result.org_id ? String(result.org_id) : undefined,
			},
			Number(result.expires_in ?? 0) || undefined,
		);
		console.log(
			`approved${result.org_id ? ` · workspace ${String(result.org_id)}` : ""} → ${out} (0600)`,
		);
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("authorization_pending")) {
			console.error(message);
			process.exit(1);
		}
	}
}
console.error("device code expired before approval");
process.exit(1);
