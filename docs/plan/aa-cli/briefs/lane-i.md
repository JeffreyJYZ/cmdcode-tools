# Lane I — release plumbing for the new package

Repo `/Users/jyz/dev/cmdcode-tools`. Two files, both about wiring `aa-models` into machinery that
enumerates packages by hand. Nothing else.

## 1. `.github/workflows/npm-plugin.yml` knows six packages, not seven

The workflow resolves a tag to a package directory by name. `aa-models` is a seventh published package
(`@jeffreyjyz/aa-models`, bin `aa`/`aadev`, no build step — same category as `mpc`/`reqshape`). Add it
everywhere the file enumerates packages, so a `aa-models-v0.1.0` tag publishes it through the same OIDC
path:

- the header comment's tag table (it lists every prefix),
- `on: push: tags`,
- the `workflow_dispatch` input's choice list,
- the `case` that maps a tag to a directory (`aa-models-v*) dir=aa-models; tag="${ref#aa-models-v}" ;;`),
- and the sanity check near the end that distinguishes packages with a build step from those without.

Read the whole file first and follow its existing style exactly — it already documents the two traps it is
built around (a bare `npm publish` can leave a ghost version, and a tag must never publish a neighbour
package). Do not "improve" anything else in it.

## 2. `scripts/dev-link.ts` doesn't know `aadev`

`aa-models/package.json` declares bins `aa` and `aadev`, and its own `dev:link` links `aadev` — but the repo
root script `scripts/dev-link.ts` is the thing that puts every dev twin on `PATH`, so right now `aadev`
isn't reachable the way `mpcdev`/`reqshapedev` are.

Add `aadev` following the existing shape exactly: build the new member the way the bun-built twins are
built (or skip the build for a source-only package, whichever the script already does for `reqshape`/
`mpc`), link it into the link dir, keep the script idempotent, keep the dangling-link repair, and keep the
"exit non-zero and print the `export PATH=` line when the link dir is off `PATH`" behaviour.

## Constraints

- You own exactly `.github/workflows/npm-plugin.yml` and `scripts/dev-link.ts`, plus
  `docs/plan/aa-cli/reports/lane-i.md`.
- Do not touch version numbers, tags, `package.json` files, `cmduse/**`, `oc-cmd-compare/**` or
  `aa-models/src/**`. Another lane is editing some of those right now.
- Validate the YAML locally before you report — an unquoted `:` in a step name once made GitHub register a
  workflow that fails every push in 0 s. Use a real parser (`ruby -ryaml -e 'YAML.load_file("…")'`), and say
  which parser you used.
- `rg`/`fd` with explicit paths only; never `grep`/`find`/`sed`. One tree, no worktree. No commit, no push.
- Proof: print the new lines, the YAML parse verdict, and `bun scripts/dev-link.ts --help` (or a dry run if
  it has one) showing `aadev` would be linked. Do not actually re-link the machine's binaries if the script
  has no dry run — say that instead.
