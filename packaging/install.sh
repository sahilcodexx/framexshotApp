#!/usr/bin/env bash
#
# FrameXShot — universal Linux installer (build-from-source)
#
# Installs every build + runtime dependency through your native package
# manager, downloads the FrameXShot source for a release tag, compiles it
# against your system libraries (no AppImage/Flatpak/deb/rpm), and installs
# it to /usr/local. This is the ONLY supported way to install on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/sahilcodexx/framexshot/main/packaging/install.sh | sh
#
# Env overrides:
#   FXS_VERSION   — build a specific tag (default: latest release tag)
#   FXS_SKIP_DEPS — set to 1 to skip dependency installation
#   FXS_NO_SUDO   — set to 1 to fail instead of prompting for sudo
#   FXS_KEEP_SRC  — set to 1 to keep the source tree in /tmp (debugging)

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
REPO="sahilcodexx/framexshot"
GITHUB_URL="https://github.com/${REPO}"
VERSION="${FXS_VERSION:-latest}"
SKIP_DEPS="${FXS_SKIP_DEPS:-0}"
NO_SUDO="${FXS_NO_SUDO:-0}"
KEEP_SRC="${FXS_KEEP_SRC:-0}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Helpers ─────────────────────────────────────────────────────────────────
is_root()  { [ "$(id -u)" -eq 0 ]; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

sudo_() {
  if is_root; then "$@"; else
    [ "$NO_SUDO" = "1" ] && die "needs root; run as root or set FXS_NO_SUDO=0"
    if ! command -v sudo >/dev/null 2>&1; then
      die "sudo not found and not running as root — run this script as root"
    fi
    sudo "$@"
  fi
}

# ── Distro / package-manager detection ─────────────────────────────────────
detect_pm() {
  if have_cmd apt-get; then echo "apt"
  elif have_cmd dnf;   then echo "dnf"
  elif have_cmd pacman; then echo "pacman"
  elif have_cmd zypper; then echo "zypper"
  elif have_cmd apk;   then echo "apk"
  else echo "unknown"
  fi
}

os_id() {
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${ID:-unknown}"
  else
    echo "unknown"
  fi
}

arch() {
  case "$(uname -m)" in
    x86_64|aarch64|arm64) echo "supported" ;;
    *) echo "unsupported" ;;
  esac
}

download() {
  local url="$1" out="$2"
  if have_cmd curl; then curl -fsSL --retry 3 -o "$out" "$url"
  elif have_cmd wget; then wget -qO "$out" "$url"
  else die "need curl or wget to download the source"; fi
}

# Resolve "latest" to a concrete tag.
latest_tag() {
  if [ "$VERSION" != "latest" ]; then echo "$VERSION"; return; fi
  local json
  if have_cmd curl; then
    json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"
  else
    json="$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest")"
  fi
  printf '%s' "$json" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4 \
    || die "Could not resolve latest release tag"
}

# ── Dependency sets per package manager ─────────────────────────────────────
# Runtime: WebKit/GTK shell, appindicator tray, tesseract OCR + capture/
# clipboard/dialog tools (the app degrades gracefully to D-Bus fallbacks).
# Build:  Rust toolchain, Node/pnpm for the frontend, pkg-config, etc.
#
# Capture tools (grim/slurp/spectacle/scrot/maim) are *recommended* — the app
# falls back to xdg-desktop-portal + GNOME Shell D-Bus when they're missing,
# so they are installed best-effort and never abort the build.
apt_runtime=(
  libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0 libgtk-3-0
  libayatana-appindicator3-1 tesseract-ocr
  wl-clipboard xclip xsel xdg-desktop-portal zenity kdialog xdotool
)
apt_build=(
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev libssl-dev
  build-essential pkg-config curl wget file
)
dnf_runtime=(
  webkit2gtk4.1 gtk3 libappindicator-gtk3 tesseract
  wl-clipboard xclip xsel xdg-desktop-portal zenity kdialog xdotool
)
dnf_build=(
  webkit2gtk4.1-devel gtk3-devel librsvg2-devel libxdo-devel openssl-devel
  pkg-config gcc gcc-c++ make curl wget file
)
pacman_runtime=(
  webkit2gtk-4.1 gtk3 libappindicator-gtk3 tesseract
  wl-clipboard xclip xsel xdg-desktop-portal zenity kdialog xdotool
)
pacman_build=(
  base-devel rust nodejs pnpm pkg-config curl wget file
  openssl appmenu-gtk-module librsvg xdotool
)
# openSUSE: WebKitGTK 4.1 ships as `webkit2gtk3` (soup3-based); the legacy
# soup2 build is `webkit2gtk3-soup2` (4.0 API — NOT compatible).
zypper_runtime=(
  webkit2gtk3 gtk3 libappindicator-gtk3 tesseract-ocr
  wl-clipboard xclip xsel xdg-desktop-portal zenity kdialog xdotool
)
zypper_build=(
  webkit2gtk3-devel gtk3-devel librsvg-devel libxdo-devel libopenssl-devel
  pkg-config gcc gcc-c++ make curl wget file
)

# Optional capture tools — never abort if a distro lacks one.
apt_optional=(grim slurp spectacle scrot maim)
dnf_optional=(grim slurp spectacle scrot maim)
pacman_optional=(grim slurp spectacle scrot maim hyprshot hyprland-contrib xdg-desktop-portal-hyprland)
zypper_optional=(grim slurp spectacle scrot maim)

install_recommended() {
  local pm="$1"; shift
  local pkgs=("$@")
  [ "${#pkgs[@]}" -eq 0 ] && return 0
  say "Installing optional capture tools (best-effort)"
  case "$pm" in
    apt)    sudo_ apt-get install -y --no-install-recommends "${pkgs[@]}" || warn "Some optional tools unavailable — capture will use D-Bus fallbacks" ;;
    dnf)    sudo_ dnf install -y "${pkgs[@]}" || warn "Some optional tools unavailable — capture will use D-Bus fallbacks" ;;
    pacman) sudo_ pacman -Sy --needed --noconfirm "${pkgs[@]}" || warn "Some optional tools unavailable — capture will use D-Bus fallbacks" ;;
    zypper) sudo_ zypper --non-interactive install "${pkgs[@]}" || warn "Some optional tools unavailable — capture will use D-Bus fallbacks" ;;
    *) warn "Unknown package manager — skipping optional tools" ;;
  esac
}

install_deps() {
  local pm="$(detect_pm)"
  say "Installing runtime dependencies via ${pm}"
  case "$pm" in
    apt)
      # webkit2gtk-4.1 requires Debian 12+/Ubuntu 22.04+. On older distros the
      # lib* packages don't exist at all — fail clearly instead of a confusing
      # "Unable to locate package" (tauri-apps/tauri#9662).
      case "$(os_id)" in
        debian)
          local ver="$(. /etc/os-release; echo "${VERSION_ID:-0}")"
          if [ "${ver%%.*}" -lt 12 ] 2>/dev/null; then
            die "Debian ${ver} is too old — libwebkit2gtk-4.1-0 needs Debian 12+."
          fi
          ;;
        ubuntu)
          local ver="$(. /etc/os-release; echo "${VERSION_ID:-0}")"
          if [ "${ver%%.*}" -lt 22 ] 2>/dev/null; then
            die "Ubuntu ${ver} is too old — libwebkit2gtk-4.1-0 needs Ubuntu 22.04+."
          fi
          ;;
      esac
      sudo_ apt-get update -qq
      sudo_ apt-get install -y "${apt_runtime[@]}"
      install_recommended "$pm" "${apt_optional[@]}"
      ;;
    dnf)
      if [ "$(os_id)" = "rhel" ] || [ "$(os_id)" = "rocky" ] || [ "$(os_id)" = "almalinux" ] || [ "$(os_id)" = "centos" ]; then
        die "Enterprise Linux ships only WebKitGTK 4.0 — FrameXShot needs 4.1."
      fi
      sudo_ dnf install -y "${dnf_runtime[@]}"
      install_recommended "$pm" "${dnf_optional[@]}"
      ;;
    pacman)
      sudo_ pacman -Sy --needed --noconfirm "${pacman_runtime[@]}"
      install_recommended "$pm" "${pacman_optional[@]}"
      ;;
    zypper)
      sudo_ zypper --non-interactive install "${zypper_runtime[@]}"
      install_recommended "$pm" "${zypper_optional[@]}"
      ;;
    *)
      die "Unsupported package manager — supported: apt, dnf, pacman, zypper"
      ;;
  esac

  say "Installing build dependencies via ${pm}"
  case "$pm" in
    apt)
      sudo_ apt-get install -y "${apt_build[@]}"
      # Arch-style rust+node come from distro repos on Debian/Fedora/SUSE
      sudo_ apt-get install -y cargo rustc nodejs npm || true
      ;;
    dnf)
      sudo_ dnf install -y "${dnf_build[@]}"
      sudo_ dnf install -y cargo rust nodejs npm || true
      ;;
    pacman)
      sudo_ pacman -Sy --needed --noconfirm "${pacman_build[@]}"
      ;;
    zypper)
      sudo_ zypper --non-interactive install "${zypper_build[@]}"
      sudo_ zypper --non-interactive install cargo rust nodejs npm || true
      ;;
  esac

  # pnpm is the project's package manager and is NOT in distro repos.
  if ! have_cmd pnpm; then
    say "Installing pnpm (not in distro repos)"
    if have_cmd npm; then
      sudo_ npm install -g pnpm
    else
      die "Need npm (Node.js) to install pnpm — install nodejs first"
    fi
  fi
}

# ── Build & install from source ─────────────────────────────────────────────
build_and_install() {
  local ver="$VERSION" tarball="/tmp/framexshot-${ver}.tar.gz"
  local src_dir
  src_dir="$(mktemp -d)"

  say "Downloading source for ${ver}"
  download "${GITHUB_URL}/archive/refs/tags/v${ver}.tar.gz" "$tarball"

  say "Extracting"
  tar -xzf "$tarball" -C "$src_dir" --strip-components=1

  say "Installing frontend dependencies (pnpm)"
  ( cd "$src_dir" && pnpm install --frozen-lockfile )

  say "Building frontend"
  ( cd "$src_dir" && pnpm run build )

  say "Compiling Rust binary (this takes a few minutes)"
  ( cd "$src_dir" && cargo build --release --locked --manifest-path src-tauri/Cargo.toml )

  local bin="$src_dir/src-tauri/target/release/framexshot"
  [ -f "$bin" ] || die "Build failed — binary not produced at $bin"

  say "Installing FrameXShot to /usr/local"
  sudo_ install -Dm755 "$bin" /usr/local/bin/framexshot
  sudo_ install -Dm644 "$src_dir/src-tauri/icons/128x128.png" \
    /usr/share/icons/hicolor/128x128/apps/com.framexshot.app.png
  sudo_ install -Dm644 "$src_dir/src-tauri/icons/32x32.png" \
    /usr/share/icons/hicolor/32x32/apps/com.framexshot.app.png
  sudo_ install -Dm644 "$src_dir/flatpak/com.framexshot.app.desktop" \
    /usr/share/applications/com.framexshot.app.desktop

  if [ "$KEEP_SRC" != "1" ]; then rm -rf "$src_dir"; fi
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  say "FrameXShot Linux installer (build-from-source)"
  say "Distro: $(os_id)   Package manager: $(detect_pm)"

  [ "$(arch)" = "unsupported" ] && die "Unsupported architecture: $(uname -m)"

  if [ "$VERSION" = "latest" ]; then
    VERSION="$(latest_tag)" || die "Could not resolve latest release tag"
  fi
  VERSION="${VERSION#v}"

  if [ "$SKIP_DEPS" != "1" ]; then
    install_deps
  fi

  build_and_install

  say "Done! Launch FrameXShot with: framexshot"
  say "Or find it in your application menu."
}

main "$@"