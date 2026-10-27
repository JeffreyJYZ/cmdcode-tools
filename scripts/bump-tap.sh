#!/bin/zsh
# Pin the Homebrew tap's formula to a cmduse release, from that release's own
# SHA256SUMS.
#
#   scripts/bump-tap.sh <tag> <formula-path>
#   scripts/bump-tap.sh cmduse-v0.7.14 ~/…/homebrew-tap/Formula/cmduse.rb
#
# Why a script rather than four `sd` pairs: the formula pins the PREVIOUS
# release's asset names, so a version-only rewrite publishes urls whose sha256
# still belong to the old tarballs (a remembered hash pins the wrong file, and
# nothing local notices), and the tag carries a `v` (`cmduse-v0.7.14`) while the
# asset does not (`cmduse-0.7.14-aarch64-apple-darwin.tar.gz`) — two strings that
# differ, so a `url.replace(tag, …)` builds a 404.
#
# Pins are matched by TARGET TRIPLE, not by asset filename, so the rewrite works
# from any previous version. Nothing is written unless every pin the formula
# carries resolves to a sha in the sums file; `verify-crate.ts` is the check that
# reads the result back.
set -eu
TAG="${1:?usage: bump-tap.sh <tag> [formula]}"
if [ -n "${2:-}" ]; then
  FORMULA="$2"
else
  if ! command -v brew >/dev/null 2>&1; then
    echo "brew not found; pass the formula path as the second argument" >&2
    exit 1
  fi
  FORMULA="$(brew --prefix)/Library/Taps/jeffreyjyz/homebrew-tap/Formula/cmduse.rb"
fi
SUMS="$(mktemp -t cmduse-sums)"
trap 'rm -f "$SUMS"' EXIT

curl -sL --fail "https://github.com/JeffreyJYZ/cmdcode-tools/releases/download/$TAG/SHA256SUMS" -o "$SUMS"

python3 - "$TAG" "$SUMS" "$FORMULA" <<'PY'
import re, sys

tag, sums_path, formula_path = sys.argv[1:4]
version = tag[len("cmduse-v"):] if tag.startswith("cmduse-v") else tag


def target_of(asset):
    """cmduse-<version>-<target>.tar.gz -> <target>"""
    name = asset[: -len(".tar.gz")]
    return name[len("cmduse-"):].split("-", 1)[1]


sums = {}
for line in open(sums_path):
    parts = line.split()
    if len(parts) == 2:
        sums[target_of(parts[1])] = parts[0]

text = open(formula_path).read()
missing = []

for match in re.finditer(r'url "[^"]+\.tar\.gz"', text):
    asset = match.group(0).rsplit("/", 1)[-1][:-1]
    if target_of(asset) not in sums:
        missing.append(asset)
if missing:
    print("ABORT — the formula pins an asset this release does not carry:")
    print("  " + ", ".join(missing))
    sys.exit(1)


def fix(match):
    url, old = match.group(1), match.group(2)
    target = target_of(url.rsplit("/", 1)[-1])
    new = f"https://github.com/JeffreyJYZ/cmdcode-tools/releases/download/{tag}/cmduse-{version}-{target}.tar.gz"
    print(f"{target:32} {old[:12]} -> {sums[target][:12]}")
    return f'url "{new}"\n      sha256 "{sums[target]}"'


text = re.sub(
    r'url "([^"]+\.tar\.gz)"\n      sha256 "([0-9a-f]{64})"', fix, text
)
open(formula_path, "w").write(text)
print(f"pinned {tag} in {formula_path}")
PY
