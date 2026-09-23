#!/bin/sh
#
# FrameXShot — universal installer (macOS + Linux)
#
# Detects the OS with `uname -s` and runs the matching install flow.
# Works when piped directly into a shell:
#
#   curl -fsSL https://raw.githubusercontent.com/sahilcodexx/framexshotApp/main/install.sh | sh
#
# macOS: downloads the architecture-matching DMG from the latest GitHub
#        release (arm64 → *_aarch64.dmg, x86_64 → *_x64.dmg), mounts it with
#        hdiutil, replaces /Applications/framexshot.app, unmounts, and runs
#        `xattr -cr` on the installed app so Gatekeeper never blocks it.
#        No Apple Developer certificate is required.
#
# Linux: delegates to the existing build-from-source installer at
#        packaging/install.sh (deps + cargo build + install to /usr/local).
#
# Env:
#   FXS_VERSION   — pin a release (1.1.0 or v1.1.0); default: latest
#   FXS_SKIP_DEPS, FXS_NO_SUDO, FXS_KEEP_SRC — Linux only (see packaging/install.sh)
#
# This script is POSIX sh (no bashisms) so it runs under `sh` on macOS
# (bash 3.2) and Debian/Ubuntu (dash) alike.

set -eu

REPO="sahilcodexx/framexshotApp"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
API_BASE="https://api.github.com/repos/${REPO}"
DOWNLOAD_BASE="https://github.com/${REPO}/releases/download"
APP_NAME="framexshot.app"
APP_PATH="/Applications/${APP_NAME}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# download_to <url> <output-file>
download_to() {
  if have curl; then curl -fsSL --retry 3 -o "$2" "$1"
  elif have wget; then wget -qO "$2" "$1"
  else die "need curl or wget to download files"; fi
}

# fetch_to_stdout <url>
fetch_to_stdout() {
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else die "need curl or wget to download files"; fi
}

# Prints the bare release version (no leading "v"), e.g. "1.1.0".
resolve_version() {
  if [ -n "${FXS_VERSION:-}" ]; then
    printf '%s' "${FXS_VERSION#v}"
    return 0
  fi

  # Primary: GitHub REST API — latest release tag.
  tag="$(fetch_to_stdout "${API_BASE}/releases/latest" \
    | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4 || true)"

  # Fallback: follow the browser redirect of /releases/latest, which lands on
  # /releases/tag/vX.Y.Z (works when the API is rate-limited or unreachable).
  if [ -z "$tag" ] && have curl; then
    loc="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
      "https://github.com/${REPO}/releases/latest" || true)"
    case "${loc##*/}" in
      v[0-9]*) tag="${loc##*/}" ;;
    esac
    unset loc
  fi

  [ -n "$tag" ] || die "could not resolve the latest release tag — set FXS_VERSION=1.1.0 to pin one"
  printf '%s' "${tag#v}"
}

# ── macOS: DMG → /Applications + clear Gatekeeper quarantine ────────────────
install_macos() {
  # 1. Pick the DMG for this chip.
  case "$(uname -m)" in
    arm64)  dmg_arch="aarch64" ;;
    x86_64) dmg_arch="x64" ;;
    *)      die "unsupported Mac architecture: $(uname -m)" ;;
  esac

  have hdiutil || die "hdiutil not found — are you really on macOS?"
  have curl    || die "curl is required on macOS"
  have xattr   || die "xattr not found — are you really on macOS?"

  ver="$(resolve_version)"

  url="${DOWNLOAD_BASE}/v${ver}/framexshot_${ver}_${dmg_arch}.dmg"
  say "FrameXShot ${ver} — macOS (${dmg_arch})"
  say "Installing to ${APP_PATH}"

  # 2. Scratch space + cleanup on any exit (vars are globals so the EXIT
  #    trap can see them in every shell — locals would be out of scope).
  tmp="$(mktemp -d)"
  dmg="${tmp}/framexshot.dmg"
  mnt="${tmp}/mnt"
  mounted=0
  mkdir -p "$mnt"

  cleanup() {
    if [ "$mounted" = "1" ]; then
      hdiutil detach "$mnt" -quiet 2>/dev/null \
        || hdiutil detach "$mnt" -force -quiet 2>/dev/null \
        || true
    fi
    rm -rf "$tmp"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # 3. Download the DMG.
  say "Downloading ${url}"
  download_to "$url" "$dmg"

  # 4. Mount it at a known path.
  say "Mounting DMG"
  hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mnt" -quiet
  mounted=1

  # 5. Locate the .app bundle inside the volume.
  src="$(find "$mnt" -maxdepth 1 -name '*.app' -print | head -n 1)"
  [ -n "$src" ] || die "no .app bundle found inside the DMG"

  # 6. /Applications is group-writable by admins on macOS; fall back to sudo
  #    for non-admin users (sudo reads the password from the TTY, so piping
  #    this script into sh is safe).
  as_root=""
  if [ ! -w "/Applications" ]; then
    have sudo || die "no write permission for /Applications and sudo is unavailable"
    as_root="sudo"
  fi
  run_as_root() {
    if [ -n "$as_root" ]; then sudo "$@"; else "$@"; fi
  }

  # 7. Replace any existing install — only now that the new app is ready.
  if [ -e "$APP_PATH" ]; then
    say "Removing existing ${APP_NAME}"
    run_as_root rm -rf "$APP_PATH"
  fi

  # 8. Copy the app out of the DMG.
  say "Copying ${APP_NAME} to /Applications"
  if have ditto; then
    run_as_root ditto "$src" "$APP_PATH"
  else
    run_as_root cp -R "$src" "$APP_PATH"
  fi

  # 9. Unmount.
  say "Unmounting DMG"
  hdiutil detach "$mnt" -quiet || hdiutil detach "$mnt" -force -quiet
  mounted=0

  # 10. Clear the quarantine attribute so Gatekeeper never shows a dialog
  #     ("damaged and can't be opened" / "blocked for your protection").
  say "Clearing quarantine (Gatekeeper)"
  run_as_root xattr -cr "$APP_PATH"

  say "Done — FrameXShot is in /Applications."
  say "Open it from Launchpad or Applications. On first capture, grant the"
  say "Screen Recording permission when macOS asks (System Settings →"
  say "Privacy & Security → Screen Recording), then quit and reopen the app."
}

# ── Linux: delegate to the existing build-from-source installer ─────────────
install_linux() {
  linux_url="${RAW_BASE}/packaging/install.sh"
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  say "FrameXShot Linux installer (build-from-source)"
  say "Fetching ${linux_url}"
  download_to "$linux_url" "$installer"

  # packaging/install.sh is a bash script (it uses arrays); prefer bash so it
  # also works when /bin/sh is dash (Debian/Ubuntu).
  if have bash; then
    bash "$installer"
  else
    warn "bash not found — running the Linux installer with sh"
    sh "$installer"
  fi
}

# ── Dispatch ────────────────────────────────────────────────────────────────
main() {
  case "$(uname -s)" in
    Darwin) install_macos ;;
    Linux)  install_linux ;;
    *)      die "unsupported operating system: $(uname -s) (supported: macOS, Linux)" ;;
  esac
}

main ${1+"$@"}
