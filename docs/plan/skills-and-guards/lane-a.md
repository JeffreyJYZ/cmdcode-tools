# Lane A report — `blocked` as an array of objects

## What changed

`opencode-shell-rc` only. `blocked` is now an array of `{ name, alternative?, reason? }`; the legacy
`Record<string, string>` map is still accepted by both the config file and `renderGuards`.

- `src/guards.ts` — new normaliser, message composition, escaping, DOC comment.
- `test/guards.test.ts` — rewritten for the new shape, all legacy cases preserved.
- `README.md` — array example, field semantics, back-compat, stale bullet replaced.
- `package.json` — `0.4.3` → `0.5.0`.

Live `~/.config/opencode/shell-rc.json` was not touched. No tag, publish or push.

Left for the controller: `opencode-shell-rc/AGENTS.md` lines 34–35 still describe the old
"blank replacement" skip and the sentence-as-replacement case; the guard bullets need to reference
the new schema doc. This lane does not edit the repo's own `AGENTS.md`.

## Normaliser shape

`normalizeBlocked(value: unknown): BlockedEntry[]` is the single conversion point; both
`loadConfig` and `renderGuards` call it, so direct calls and config-file reads resolve identically.

- Array: keep objects with a trimmed string `name`; trim `alternative`/`reason`, drop empty ones.
  An entry with neither is dropped (nothing to say). Malformed entries are skipped.
- Object (legacy map): each string value becomes `{ name, alternative: value }` in insertion
  order; non-string/blank values are skipped.
- Anything else (`undefined`, `null`, string, number, bad JSON) → `[]` = the defaults.
- Duplicates: `Map.delete` then `Map.set` on each name, so the **later** entry wins and sits at its
  later position.

`loadConfig()` returns `{ blocked: BlockedEntry[] }`; malformed file falls back through
`normalizeBlocked(DEFAULT_BLOCKED)` (empty today).

## One rendered message per case

`renderGuards` composes the sentence, escapes it, then writes:

```
unalias <name> 2>/dev/null
function <name> {
  print -r -u2 -- "<name> is blocked in agent shells — <instruction>"
  return 127
}
```

`unalias`, `function` and `return 127` are unchanged. `print` gained `-r` so a literal backslash in
a reason is not re-interpreted by zsh's `print` (`\t` became a tab without it).

| case | input | rendered message |
|---|---|---|
| alternative + reason, alternative on PATH | `{name:"grep", alternative:"rg", reason:"respects .gitignore and is faster"}` | `grep is blocked in agent shells — use rg (respects .gitignore and is faster)` |
| alternative only, on PATH | `{name:"find", alternative:"fd"}` | `find is blocked in agent shells — use fd` |
| reason only | `{name:"tccutil", reason:"TCC changes are human-only; ask the user"}` | `tccutil is blocked in agent shells — TCC changes are human-only; ask the user` |
| neither | `{name:"grep"}` | *(no guard written)* |
| alternative not on PATH, reason present | `{name:"tccutil", alternative:"tcc", reason:"ask the user"}` | `tccutil is blocked in agent shells — ask the user` |
| alternative not on PATH, no reason (0.4.3 sentence case) | `{name:"tccutil", alternative:"TCC changes are human-only; ask the user"}` | `tccutil is blocked in agent shells — TCC changes are human-only; ask the user` |
| alternative with its own trailing parentheses | `{name:"sed", alternative:"sd (or read for line ranges)"}` | `sed is blocked in agent shells — use sd (or read for line ranges)` |
| legacy map | `{find:"fd"}` | `find is blocked in agent shells — use fd` |
| duplicate names | two `grep` entries, `ag` later | one function, `use ag`; `use rg` absent |

Skips unchanged: invalid name, blank alternative+reason, `cat`. Duplicates resolve before a
function is emitted.

## Escape test

Reason: `say "hi" $HOME \`whoami\` and C:\tmp` (one literal backslash before `tmp`, two backticks).

Generated script line:

```
  print -r -u2 -- "grep is blocked in agent shells — use rg (say \"hi\" \$HOME \`whoami\` and C:\\tmp)"
```

Unit assertions: the escaped string is present verbatim in `renderGuards` output and in the
`syncGuards` file; both backticks carry a leading backslash (two escaped backticks). A real-zsh test sources the
generated file and asserts stderr contains the original literal text with `"`/`$`/backticks and a
single backslash before `tmp`, and no `parse error` — proving neither command substitution nor
escape mangling happens.

## Gates

Run in `opencode-shell-rc`, all green:

| command | result |
|---|---|
| `bun test` | 81 pass, 0 fail (154 assertions) |
| `bun check` | no type errors in 12 files |
| `bun fmt --check` | all 21 files formatted |
| `bunx biome lint` | exit 0; 1 pre-existing *info*: `biome.json` pins schema 2.6.3 while CLI is 2.6.7 (no lint finding) |
| `bun run build` | bundled 6 modules, declarations emitted |

Before the final pass, `bun check` caught `split()[0]` as `string | undefined` (fixed with `?? ""`)
and Biome flagged string concatenation (rewritten as a template literal). `bun fmt` was applied to
the two edited TS files before the final `bun fmt --check`.

## Exported symbols changed

In `src/guards.ts`:

- `Blocked` — was `Record<string, string>`; now `BlockedEntry[] | LegacyBlocked`.
- `Config` — `blocked` field now `BlockedEntry[]` (was `Blocked` map).
- `renderGuards` — parameter is now `Blocked` (accepts both shapes); composition and escaping
  changed; emits `print -r`.
- `loadConfig` — return value now carries an array; normalises both shapes and resolves duplicates.
- New `BlockedEntry` interface — `{ name: string; alternative?: string; reason?: string }`.
- New `LegacyBlocked` type alias — `Record<string, string>`.
- New `normalizeBlocked` function — the shared normaliser described above.

Unchanged exports: `configFile`, `syncGuards`, `guardsExist`. `DEFAULT_BLOCKED` in
`src/constants/shell-rc.ts` stays a `Record<string, string>` (empty) and is only the fallback input
to `normalizeBlocked`.
