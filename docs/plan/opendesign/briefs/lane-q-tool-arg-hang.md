# Lane Q — a `*_usage` tool arg with no `-1` starts the watch loop and hangs forever

## The bug, measured

```
$ timeout 5 ./target/debug/odusedev --no-wallet ; echo $?
124          ← still running: the live watch loop
$ timeout 5 ./target/debug/odusedev -1 --no-wallet ; echo $?
0

$ timeout 5 ./target/debug/ocusedev --plan go-plus ; echo $?
124
$ timeout 5 ./target/debug/ocusedev -1 --plan go-plus ; echo $?
0
```

`oduse_usage({arg: "--no-wallet"})` — a call the tool's **own description advertises** — hangs the agent's turn until a human kills it. The user hit exactly this:

> "BRO THE TOOL IS BROKEN STUCK FOREVER / SO I KILLED IT"

## Root cause

`opencode-plugin/src/cli.ts`:

```ts
export function oduseArgs(arg: string | undefined): string {
	return arg !== undefined && arg.trim() !== "" ? arg : "-1";
}
```

Three of the four builders pass the argument string through **verbatim** whenever it is non-empty. The fourth does not:

```ts
export function buildCmduseArgs(arg: string): string[] {
	const tokens = splitCliArgs(arg);
	if (!tokens.length) return [...DEFAULT_ARGS];           // -1 --plain
	if (tokens.some((t) => SUBCOMMANDS.has(t))) return tokens;
	return [...DEFAULT_ARGS, ...tokens];                    // ← flags get -1 prefixed
}
```

`DEFAULT_ARGS = ["-1", "--plain"]` and `SUBCOMMANDS` live in `opencode-plugin/src/constants/cli.ts`. So `cmduse --rows 5` becomes `cmduse -1 --plain --rows 5` and returns, while `oduse --rows 5` becomes `oduse --rows 5` — which the binary reads as "no one-shot requested", i.e. the watch loop.

A bare `oduse` is documented as the live watch loop; that is correct behaviour for the CLI. It is never correct for a tool call.

## The fix

1. **Give the three builders cmduse's rule.** `ocuseArgs`, `arkuseArgs` and `oduseArgs` must return a token list that contains `-1` (or `--once`) whenever the invocation would otherwise be a *dashboard* invocation. Reuse `splitCliArgs` and `SUBCOMMANDS` rather than writing a third copy of the logic — the rule is "a subcommand passes through untouched; anything else gets `-1` prepended". Return type becomes `string[]` for symmetry with `buildCmduseArgs`, or keep `string` and join — pick whichever keeps the call sites simplest, and say which.
2. **Preserve the existing contract.** `undefined`, `""` and whitespace-only still mean exactly `-1`. An explicit `-1`/`--once` in the arg must not be duplicated. A subcommand (`daily`, `model`, `plans`, …) must pass through with its own flags, unmodified, because those subcommands already exit.
3. **Do not hardcode the flag list twice.** If `SUBCOMMANDS` in `constants/cli.ts` lacks an entry that a binary actually accepts, add it there — it is the one place the set lives.
4. **Audit the three tool descriptions against what actually returns.** `OCUSE_TOOL_ARG_DESCRIPTION`, `ARKUSE_TOOL_ARG_DESCRIPTION` and `ODUSE_TOOL_ARG_DESCRIPTION` currently advertise examples like `--plan go-plus`, `daily`, `--no-wallet`, `--json`. After this fix all of those must return. Anything that still cannot (a bare watch-mode invocation has no legitimate tool use) should not be advertised.
5. **A regression test per builder**, in `opencode-plugin/test/cli.test.ts`: for each of the four, assert `args("--rows 5")` contains `-1`, `args("")` is exactly `["-1"]`, `args("daily")` is exactly `["daily"]`, and `args("-1 --json")` does not double the `-1`. Then a **real spawn test** (skip-if-binary-absent, the repo's existing `*_BIN` convention) that the produced argv for `oduse --no-wallet` actually exits within a few seconds — a pure string assertion cannot catch a hang, and a hang is what shipped.

## Verify by running it

```sh
cd ~/dev/cmdcode-tools
timeout 30 ./target/debug/odusedev --no-wallet ; echo "exit=$?"     # must be 0, not 124
```

and the real tool call through the plugin:

```sh
cd opencode-plugin && bun -e 'import { oduseArgs } from "./src/cli.ts"; console.log(oduseArgs("--no-wallet"))'
```

must print an argv whose first token is `-1`. Paste both.

## Constraints

- Python is banned. Rust and Bun only.
- `rg`, never `grep`/`find`; `fd` for paths; always pass an explicit path, never scan from `/` or `~`.
- Never run `sed`. Use the edit tools.
- Never `git commit`, `git push`, `git tag`, or publish anything — the release is cut and this rides a patch that a later round decides on. **Exception:** you may leave the tree dirty and report.
- Never reload or restart opencode. Never use `agent-desktop`, and never move the user's cursor.
- **Your files only:** `opencode-plugin/src/cli.ts`, `opencode-plugin/src/constants/cli.ts`, `opencode-plugin/src/constants/providers.ts` (the three arg descriptions), and `opencode-plugin/test/cli.test.ts`. **Do not touch** `core/**`, `cmduse/**`, `oc-cmd-compare/**`, any version file, or `opencode-plugin/src/{index,v2,tui-commands}.ts*` — those are settled and a second writer loses the change.
- Gate before you report: `cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`. Foreground, waited on inside the same call. **Run the real spawn test too** — a green string assertion is what missed this in the first place.

## Report

Append to `docs/plan/opendesign/reports/lane-q-tool-arg-hang.md`. Final chat reply under 15 lines: the before/after argv for one hanging example, the real-spawn exit code, the descriptions corrected, the gate result.
