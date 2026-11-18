# Lane Q — tool arg with no `-1` starts the watch loop and hangs: DONE

## Before / after (measured on this tree)

```
before  oduseArgs("--no-wallet")  -> "--no-wallet"            (string, verbatim)
after   oduseArgs("--no-wallet")  -> ["-1", "--no-wallet"]
before  ocuseArgs("--plan go-plus") -> "--plan go-plus"
after   ocuseArgs("--plan go-plus") -> ["-1", "--plan", "go-plus"]
before  arkuseArgs("daily")      -> "daily"
after   arkuseArgs("daily")      -> ["daily"]                 (subcommand passes through)
after   buildCmduseArgs("--rows 5") -> ["-1", "--plain", "--rows", "5"]
```

Old argv fed to the binary meant "no one-shot requested" → live watch loop →
the agent turn hung until a human killed it. The three sibling builders now use
the same rule as `buildCmduseArgs`: subcommand passes through, explicit
`-1`/`--once` passes through (never doubled), everything else gets `-1` prefixed.
Empty/undefined/whitespace is exactly `["-1"]` for ocuse/arkuse/oduse; cmduse
keeps `["-1", "--plain"]` by design. Return type is now `string[]` for all four,
which keeps the call sites simplest — `run{Ocuse,Arkuse,Oduse}(arg: string | readonly string[])`
already accepts an argv array and uses it as-is, so there is no string round-trip.

## Real spawn (the only test that can catch a hang)

```
runOduse(oduseArgs("--no-wallet"), {candidates:[target/debug/odusedev], timeoutMs:30000})
  -> argv=["-1","--no-wallet"]  exit=0  ms=9462  firstLine="OpenDesign usage — credits, from …"
timeout 30 ./target/debug/odusedev -1 --no-wallet >/dev/null 2>&1 ; echo exit=$?
  -> exit=0
```

Careful: the one-shot takes ~9.5 s on this machine (it reads/parses the local
store). A 5–8 s timeout on `-1 --no-wallet` reports 124 and looks like the bug
again — raise it to 30 s. The regression test uses a 30 s bound, so a real hang
still fails while a slow-but-finite one-shot passes.

Two spawn tests in `test/cli.test.ts`:
- a hermetic shim that loops forever unless argv contains `-1`/`--once` — the
  produced argv exits, the pre-fix bare string times out. Fast, always runs.
- a real `oduse` binary spawn (skip-if-absent via `ODUSE_BIN` / the repo's
  `target/debug/odusedev` / bare name, same order as `check-parity.ts`) that
  asserts the produced argv closes within 30 s.

The earlier string assertions all passed on the broken code. That is exactly
why the real spawn is required.

## Descriptions corrected

The three `*_TOOL_ARG_DESCRIPTION` constants in `src/constants/providers.ts`
now distinguish flags from subcommands and state the one-shot guarantee:
flags are added to the one-shot dashboard, a subcommand runs as-is, and the
tool never starts the live watch loop. Removed the misleading examples that
read as watch-mode invocations (`daily` as a flag example, and the bare
"empty means the one-shot dashboard" wording that said nothing about flags).

## Other

- `SUBCOMMANDS` in `src/constants/cli.ts` gained `mcp`: all four binaries accept
  it and the set is the single source of truth. It is not advertised in a tool.
- No version files, core/**, cmduse/**, oc-cmd-compare/**, or
  `src/{index,v2,tui-commands}.ts*` touched. Tree left dirty, no commit.

## Gate

`cd opencode-plugin && bun test && bun check && bun fmt --check && bunx biome lint`
→ all pass, exit 0: 361 pass / 0 fail, no type errors in 80 files, 89 files
formatted. Biome emits one pre-existing info only (its `biome.json` schema pins
2.6.3 while the CLI is 2.6.7) and no warnings in the changed files.
