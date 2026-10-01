#!/usr/bin/env sh
# Reproducible build of Lighter's OFFICIAL signer (lighter-go) as WASM — PR12.
#
# Source:    https://github.com/elliottech/lighter-go
# Pinned:    tag v1.0.10, commit 9d38261d1a4cc5c7211b383ba07a4d6e41604708
# Toolchain: golang:1.23.2-bullseye (the version in upstream's justfile)
# Build:     GOOS=js GOARCH=wasm go build -trimpath ./wasm/   (upstream `build-wasm`)
# Output:    vendor/lighter-signer/{lighter-signer.wasm,wasm_exec.js} (gitignored)
#
# The artifacts are platform-independent (WASM), verified against the
# SHA-256 values pinned in lib/lighter/signer-adapter.ts, and the adapter
# refuses to load anything that doesn't match. Nothing is downloaded at
# application runtime. Requires git + docker.
set -eu

REPO=https://github.com/elliottech/lighter-go.git
COMMIT=9d38261d1a4cc5c7211b383ba07a4d6e41604708
WASM_SHA=411a3280862c2d9445f74472a360882d5ecfd272276e3c961ca2431c4f1a2c54
EXEC_SHA=45ce9dfe7211247544ab6f4268eb8cb5b6f3d5ae602dc3b51447b7eada99c229

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$REPO" "$WORK/lighter-go"
git -C "$WORK/lighter-go" checkout --quiet "$COMMIT"

MSYS_NO_PATHCONV=1 docker run --rm -v "$WORK/lighter-go:/src" -w /src golang:1.23.2-bullseye sh -c \
  'GOOS=js GOARCH=wasm go build -trimpath -buildvcs=false -o /src/build/lighter-signer.wasm ./wasm/ && cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" /src/build/wasm_exec.js'

mkdir -p "$ROOT/vendor/lighter-signer"
cp "$WORK/lighter-go/build/lighter-signer.wasm" "$WORK/lighter-go/build/wasm_exec.js" "$ROOT/vendor/lighter-signer/"

check() {
  actual=$(sha256sum "$1" | cut -d' ' -f1)
  [ "$actual" = "$2" ] || { echo "CHECKSUM MISMATCH for $1: $actual (expected $2)" >&2; rm -f "$1"; exit 1; }
}
check "$ROOT/vendor/lighter-signer/lighter-signer.wasm" "$WASM_SHA"
check "$ROOT/vendor/lighter-signer/wasm_exec.js" "$EXEC_SHA"
echo "Lighter signer built and verified: $ROOT/vendor/lighter-signer"
