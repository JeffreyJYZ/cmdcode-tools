# Brief — lane A: `blocked` as an array of objects

Repo: `~/dev/cmdcode-tools`. Read the root `AGENTS.md`, `opencode-shell-rc/AGENTS.md`, then
`docs/plan/skills-and-guards/schema.md` — that file is the contract, follow it exactly.

## Job

`opencode-shell-rc` only. `blocked` becomes an array of `{ name, alternative?, reason? }` with the
legacy string map still accepted; message composition, escaping, skip rules and backwards
compatibility are all specified in the schema doc.

1. `loadConfig` normalises both forms into `{ name, alternative?, reason? }[]`.
2. `renderGuards` composes the sentence per the table in the schema doc, escapes `\ " $` and the
   backtick before writing, and keeps `unalias`/`function`/`return 127` as they are.
3. Duplicate name → later wins. Invalid name, blank entry and `cat` still skipped.
4. Tests: array form with alternative + reason, alternative only, reason only, neither (skipped),
   legacy map still working, duplicate resolution, escaping a reason containing `"` and `$`, and the
   existing 0.4.3 case where the alternative is not on `PATH`.
5. Update `opencode-shell-rc/README.md`: the guard section, the example JSON, and the stale bullet
   that still says a guard is skipped when its replacement is missing.
6. Bump the package to **0.5.0**. Do not tag, publish or push.
7. Leave `~/.config/opencode/shell-rc.json` alone — the controller migrates it after release.

Gates: `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint`, `bun run build` in that package.

Report to `docs/plan/skills-and-guards/lane-a.md`: the normaliser shape, one rendered message per
case, the escape test, the gates, and every exported symbol that changed.
