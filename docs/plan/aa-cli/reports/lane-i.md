# Lane I — release plumbing for `aa-models`

Three files: the npm publish workflow, the repo-root dev-link script, and (added after the first pass, at the coordinator's direction) the CI typescript matrix. Nothing else was touched.

## 1. `.github/workflows/npm-plugin.yml` now knows seven packages

`aa-models` is the seventh published package (`@jeffreyjyz/aa-models`, bins `aa`/`aadev`, no build step — the same category as `mpc`/`reqshape`). It was added at every place the file enumerates packages, following the file's existing style exactly.

The tag table in the header comment, and the sentence that counts them now saying "one workflow publishes all seven":

```
#   mpc-v*          oc-cmd-compare         @jeffreyjyz/mpc
#   reqshape-v*     reqshape               @jeffreyjyz/reqshape
#   aa-models-v*    aa-models              @jeffreyjyz/aa-models
```

`on: push: tags`:

```yaml
            - "mpc-v*"
            - "reqshape-v*"
            - "aa-models-v*"
```

the `workflow_dispatch` choice list:

```yaml
                    - oc-cmd-compare
                    - reqshape
                    - aa-models
```

the tag-to-directory `case`:

```sh
                      reqshape-v*)    dir=reqshape;              tag="${ref#reqshape-v}" ;;
                      aa-models-v*)   dir=aa-models;             tag="${ref#aa-models-v}" ;;
                      *) echo "no package for tag $ref" >&2; exit 1 ;;
```

and the build-step check, whose comment now names the source-only package:

```sh
                  # Only the four packages with a build step get one; mpc, reqshape
                  # and aa-models ship TypeScript source and run under bun.
```

The `case "$dir"` below it is unchanged: `aa-models` falls into the `*) build=false` arm, which is correct because the package has no build script and ships `src/` directly (`package.json` has no `build`, `files` is `["src", "LICENSE"]`, and both bins point at `src/index.ts`).

Nothing else in the workflow was altered — not the trusted-publishing comments, not the tag/manifest agreement check, not the tarball poll.

## 2. `scripts/dev-link.ts` links `aadev`

`aa-models/package.json` declares `aa` and `aadev`, and its own `dev:link` links `aadev` into `~/.bun/bin`, but the repo-root script is what puts every dev twin on `PATH`, so `aadev` was missing there. It is now the fifth entry, built the same way as `mpcdev`/`reqshapedev` — a symlink straight at the bun entry file, no build step:

```ts
	{ name: "reqshapedev", target: join(ROOT, "reqshape/src/index.ts") },
	{ name: "aadev", target: join(ROOT, "aa-models/src/index.ts") },
```

The header comment was updated to say "five dev names" and to list `aadev` alongside the installed name it must not shadow (`aa`). Everything else is untouched: the Rust build still runs `cargo build -p cmd-usage`, every link is still removed then recreated so a dangling link after `cargo clean` is repaired rather than skipped, the closing line still reports `DEV_COMMANDS.length` (now `linked 5 dev commands`), and the script still exits non-zero printing the `export PATH="…"` line when the link directory is off `PATH`.

This file takes `--dir` and has no `--help` and no dry-run flag, so the proof below uses `--dir` plus a temporary directory on `PATH` rather than re-linking the machine's `~/dev/bin`.

## 3. `.github/workflows/ci.yml` `typescript` matrix (added in the follow-up pass)

The original brief missed this one: the `typescript` job is a `matrix.include` list that names every workspace package, and `working-directory: ${{ matrix.package }}` is a job default, so a package absent from the matrix has its tests, types, format check and lint skipped silently. `aa-models` was absent.

Confirmed there is genuinely no build script before choosing the arm: `aa-models/package.json` `scripts` holds only `start`, `test`, `lint`, `typecheck` and `dev:link` — no `build`, no `dist`, `files` is `["src", "LICENSE"]`. So it takes the arm without `build: true`, exactly like `oc-cmd-compare` and `reqshape`, and the `- if: matrix.build` step skips it.

New entry (line 38), placed with the other source-only packages:

```yaml
                    - package: reqshape
                    - package: aa-models
                    - package: opencode-context
```

The rest of the job is untouched: `bun install --frozen-lockfile`, `bun test`, `bun check`, `bun fmt --check`, `bunx biome lint` are the same for every member, and `aa-models` has the two devDependencies those need (`@biomejs/biome`, `@types/bun`) plus its own `biome.json`. `aa-models` is already a root `package.json` workspace, so the shared `bun.lock` covers it and `--frozen-lockfile` holds.

## Proof

YAML parsed with ruby's psych, not by eye, for both files:

```
$ ruby -ryaml -e 'd=YAML.load_file(".github/workflows/npm-plugin.yml") …'
YAML OK (parser: ruby 4.0.10 psych 5.3.1)
tags: ["plugin-v*", "shell-rc-v*", "context-v*", "session-dir-v*", "mpc-v*", "reqshape-v*", "aa-models-v*"]
dispatch options: ["opencode-plugin", "opencode-shell-rc", "opencode-context", "opencode-session-dir", "oc-cmd-compare", "reqshape", "aa-models"]

$ ruby -ryaml -e 'd=YAML.load_file(".github/workflows/ci.yml") …'
YAML OK (parser: ruby 4.0.10 psych 5.3.1)
triggers: ["push", "pull_request"]
  package=opencode-plugin build=true
  package=oc-cmd-compare build=(none -> falsy)
  package=reqshape build=(none -> falsy)
  package=aa-models build=(none -> falsy)
  package=opencode-context build=true
  package=opencode-shell-rc build=true
  package=opencode-session-dir build=true
```

Note for anyone repeating this: psych is YAML 1.1, so the `on:` key comes back as the boolean `true` — `d["on"]` is `nil` and `d[true]` is the mapping.

dev-link run against a temp link directory, never `~/dev/bin`:

```
$ TMPD=$(mktemp -d); PATH="$TMPD:$PATH" bun scripts/dev-link.ts --dir "$TMPD"
building Rust bins (cargo build -p cmd-usage)…
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.02s
cmdusedev -> /Users/jyz/dev/cmdcode-tools/target/debug/cmdusedev
ocusedev -> /Users/jyz/dev/cmdcode-tools/target/debug/ocusedev
mpcdev -> /Users/jyz/dev/cmdcode-tools/oc-cmd-compare/src/index.ts
reqshapedev -> /Users/jyz/dev/cmdcode-tools/reqshape/src/index.ts
aadev -> /Users/jyz/dev/cmdcode-tools/aa-models/src/index.ts
linked 5 dev commands into /var/folders/…/tmp.vKYakiiIWm (on PATH)
```

`ls -l` on that directory shows all five links with `aadev` pointing at `aa-models/src/index.ts`. The machine's `~/dev/bin` was not written; the cargo invocation was an incremental no-op (1.02s).

Gates on the owned TS file:

```
bun fmt --check scripts/dev-link.ts  → 1 file is formatted
bunx biome lint scripts/dev-link.ts  → Checked 1 file in 34ms. No fixes applied.
```

`scripts/dev-link.ts` is 97 lines; `.github/workflows/ci.yml` is 77.

## Files touched

- `.github/workflows/npm-plugin.yml` — seven-package enumeration: header table, tag list, dispatch options, resolve `case`, build-step comment.
- `scripts/dev-link.ts` — the `aadev` entry and the header comment.
- `.github/workflows/ci.yml` — `aa-models` in the `typescript` matrix, no build arm.

Nothing in `aa-models/**`, `cmduse/**`, `oc-cmd-compare/**`, any `package.json`, README or version number was touched. No commit, no push.
