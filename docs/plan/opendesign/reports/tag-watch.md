# Tag run watch — cmdcode-tools 0.8.3 wave

Watch of three in-progress tag runs on `JeffreyJYZ/cmdcode-tools`. Conclusions
from `gh run watch <id> --exit-status`. No run failed; no retry or re-tag done.

## cmduse-v0.8.3 — run 44063234443 (release.yml)

**Conclusion: success.** All six build jobs (`aarch64-apple-darwin`,
`x86_64-apple-darwin`, `aarch64-unknown-linux-musl`,
`x86_64-unknown-linux-gnu`, `x86_64-unknown-linux-musl`,
`aarch64-unknown-linux-gnu`), `release` (Package / Publish release) and
`verify` (Re-download and verify every asset) passed.

**Eight binaries confirmed from the artifact.** Release carries six
`cmduse-0.8.3-*.tar.gz` assets plus `SHA256SUMS`; unpacking
`cmduse-0.8.3-aarch64-apple-darwin.tar.gz` shows all eight binaries:

- `cmduse`, `cmdusedev`
- `ocuse`, `ocusedev`
- `arkuse`, `arkusedev`
- `oduse`, `odusedev`

(also `cmduse.1` and `LICENSE-MIT`)

## plugin-v0.5.35 — run 44063235175 (npm-plugin.yml)

**Conclusion: success.** Single `publish` job passed every step: Test,
typecheck and build; The tag and the manifest must agree; Publish; Verify the
tarball is actually served.

**Registry confirmed:** `bun pm view @jeffreyjyz/opencode-command-code version`
→ `0.5.35` (was `0.5.33` before the run).

## mpc-v0.1.13 — run 44063234689 (npm-plugin.yml)

**Conclusion: success.** Single `publish` job passed every step: Test,
typecheck and build; The tag and the manifest must agree; Publish; Verify the
tarball is actually served.

**Registry confirmed:** `bun pm view @jeffreyjyz/mpc version` → `0.1.13`
(was `0.1.12` before the run).

## Verification commands

- `gh release view cmduse-v0.8.3 --repo JeffreyJYZ/cmdcode-tools --json assets --jq '.assets[].name'`
- `gh release download cmduse-v0.8.3 --repo JeffreyJYZ/cmdcode-tools --pattern 'cmduse-0.8.3-aarch64-apple-darwin.tar.gz' --dir <tmp> --clobber` then `tar tzf <asset>`
- `bun pm view @jeffreyjyz/opencode-command-code version`
- `bun pm view @jeffreyjyz/mpc version`
