# `blocked` schema — array of objects

The guard config is `~/.config/opencode/shell-rc.json`. `blocked` as a string map is the thing being
replaced: it cannot carry a reason, cannot express "blocked with no alternative", and reads as a
puzzle. New shape:

```json
{
	"blocked": [
		{ "name": "grep", "alternative": "rg", "reason": "respects .gitignore and is faster" },
		{ "name": "sed", "alternative": "sd (or read for line ranges)" },
		{ "name": "tccutil", "reason": "TCC changes are the user's; there is no grant verb" }
	]
}
```

## Fields

| field | required | meaning |
|---|---|---|
| `name` | yes | the command to shadow; `[A-Za-z0-9._+-]+` after trim, else the entry is skipped |
| `alternative` | no | what to use instead — a command line, first word checked against `PATH` |
| `reason` | no | one short sentence, shown in parentheses |

## Message

`<name> is blocked in agent shells — ` then:

- `alternative` present and its first word resolves on `PATH` → `use <alternative>`
- otherwise `reason` present → `<reason>`
- otherwise `alternative` present → `<alternative>`
- otherwise → skipped (nothing to say)

With a reason appended when the `use` form was chosen: `use rg (respects .gitignore and is faster)`.

Trailing parentheses that already belong to the alternative are not doubled:
`sd (or read for line ranges)` stays as written.

## Backwards compatibility

- `blocked` as `Record<string, string>` is still accepted; each pair becomes
  `{ name, alternative: value }`. No reason, same message as today.
- `blocked` missing, not an object/array, or malformed → the defaults (today: empty), never a guess.
- Duplicate `name`: the later entry wins.
- Order is the order written — array order, or the map's insertion order.
- Existing skips stay: invalid name, blank entry, and `cat` (it emits raw bytes; `bat` reformats, so a
  blocked `cat` would return something that is not the file).

## Generated script safety

The message is interpolated into a double-quoted zsh string. Escape `\`, `"`, `$` and `` ` `` in the
composed text before writing it, so a reason containing a quote or a `$` cannot break the function or
execute anything.

## What this changes for the runner

`renderGuards` takes the parsed entries, not a map. `loadConfig` normalises both forms into
`{ name, alternative?, reason? }[]`. `syncGuards` is unchanged: one small read and compare per
command, file rewritten only when its text moves.
