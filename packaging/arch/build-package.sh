#!/usr/bin/env bash
# Build a native Arch .pkg.tar.zst from the current source tree.
#
# Usage:
#   ./packaging/arch/build-package.sh [version]
#
# Prerequisites (install once):
#   sudo pacman -S base-devel rust nodejs webkit2gtk-4.1 gtk3 libsoup \
#     libappindicator-gtk3 tesseract grim slurp
#   pnpm must be on PATH (npm install -g pnpm  OR  sudo pacman -S pnpm — not both)
#
# Output (repo root):
#   framexshot_<version>_x86_64.pkg.tar.zst

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  VERSION="$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null \
    || grep -m1 '"version"' "$REPO_ROOT/package.json" | sed 's/.*: "\(.*\)".*/\1/')"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  PKG_ARCH="x86_64" ;;
  aarch64) PKG_ARCH="aarch64" ;;
  *) echo "Unsupported architecture for Arch package: $ARCH" >&2; exit 1 ;;
esac

# Preflight — makepkg --nodeps skips auto-install; verify tools exist first.
missing=()
for cmd in makepkg rsync tar pnpm cargo rustc node; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing required tools: ${missing[*]}" >&2
  echo "Install build deps:" >&2
  echo "  sudo pacman -S base-devel rust nodejs webkit2gtk-4.1 gtk3 libsoup libappindicator-gtk3 tesseract grim slurp" >&2
  echo "  npm install -g pnpm   # OR: sudo pacman -S pnpm (pick one, not both)" >&2
  exit 1
fi

echo "Using pnpm: $(command -v pnpm) ($(pnpm --version 2>/dev/null || echo unknown))"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

STAGING="$WORKDIR/src/framexshot-$VERSION"
mkdir -p "$STAGING"

rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='src-tauri/target' \
  --exclude='flatpak-build-dir' \
  --exclude='flatpak-repo' \
  --exclude='dist' \
  --exclude='*.pkg.tar.zst' \
  --exclude='*.flatpak' \
  "$REPO_ROOT/" "$STAGING/"

tar -czf "$WORKDIR/framexshot-${VERSION}.tar.gz" -C "$WORKDIR/src" "framexshot-$VERSION"

cp "$SCRIPT_DIR/PKGBUILD" "$WORKDIR/"
sed -i "s/^pkgver=.*/pkgver=${VERSION}/" "$WORKDIR/PKGBUILD"

cd "$WORKDIR"
# --nodeps: don't let makepkg auto-install makedepends (avoids pnpm file conflicts
# when pnpm is already installed via npm/corepack on CachyOS/Arch).
makepkg -sf --nodeps --noconfirm --skippgpcheck

BUILT_PKG="$(ls -1 framexshot-"${VERSION}"-*-"${PKG_ARCH}".pkg.tar.zst)"

# Sanity check: a binary with embedded frontend assets is ~21 MB;
# a binary without is ~15 MB. The PKGBUILD's build() function already
# verifies the unstripped binary at src-tauri/target/release/framexshot
# has the assets; this guards the post-strip packaged binary against
# being shipped in the broken 15 MB state.
INSTALLED_SIZE=$(bsdtar -xOf "$BUILT_PKG" usr/bin/framexshot 2>/dev/null \
  | wc -c)
if [ "${INSTALLED_SIZE:-0}" -lt 18000000 ]; then
  echo "ERROR: packaged binary is ${INSTALLED_SIZE} bytes (< 18 MB) — likely missing embedded frontend assets." >&2
  echo "       (A working binary is ~21 MB; the broken 'Operation was cancelled' shell is ~15 MB.)" >&2
  exit 1
fi

OUT_NAME="framexshot_${VERSION}_${PKG_ARCH}.pkg.tar.zst"
cp "$BUILT_PKG" "$REPO_ROOT/$OUT_NAME"

echo ""
echo "Built: $REPO_ROOT/$OUT_NAME ($(du -h "$REPO_ROOT/$OUT_NAME" | cut -f1))"
echo "Install: sudo pacman -U $REPO_ROOT/$OUT_NAME"
