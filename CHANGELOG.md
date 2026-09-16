# Changelog

All notable changes to FrameXShot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-02

First proper release. **Verified working on CachyOS / Arch / Hyprland** end-to-end: region capture via `slurp` + `grim`, fullscreen via `grim`, window via `hyprctl` + `grim -g` — all without touching `xdg-desktop-portal`. The portal is only used as a last-resort fallback on non-Hyprland desktops.

### Capture — Hyprland / wlroots

- **Region** → `slurp` (selection overlay) → `grim -g -` (capture that geometry)
- **Fullscreen** → `grim` (single monitor) or per-output via `wlr-randr` if available
- **Window** → `hyprctl activewindow -j` → `grim -g "x,y WxH"`
- **xcap** stays as the X11 fallback
- `xdg-desktop-portal.Screenshot` is **skipped inside a Flatpak** (the Hyprland portal backend returns `GDBus.NotAllowed` for non-interactive calls); host tools are used instead via `flatpak-spawn --host`
- On a native install, the chain hits `grim` / `slurp` first and never reaches the portal

### Linux install paths (CI now ships all three)

| Format | Best for |
|--------|----------|
| **`.pkg.tar.zst`** (Arch) | CachyOS / Arch / Manjaro / EndeavourOS / Hyprland — recommended |
| **`.deb`** (Debian) | Debian 12+ / Ubuntu 22.04+ / Pop!_OS / Mint / Elementary |
| **`.rpm`** (Fedora) | Fedora / RHEL / Nobara / openSUSE |
| **`.flatpak`** | Universal — any distro where native packages lag (ships its own libwayland/Mesa/WebKit2GTK runtime) |

AppImage was dropped: Tauri's bundled `linuxdeploy` ships `strip` (binutils 2.35) which can't process CachyOS-era libraries with `.relr.dyn` RELR relocations.

### Other changes since the v1.0.0-rc builds

- `pnpm` 10 → 11 + `pnpm-workspace.yaml` (`allowBuilds: esbuild: false`)
- `RegionSelector.tsx` no longer auto-loads a screenshot on mount (the hidden selector window was triggering a portal call on every app launch)
- `.desktop` file gets `WEBKIT_DISABLE_DMABUF_RENDERER=1` in the Exec line for Hyprland WebKit stability
- `tauri.conf.json` no longer lists `appimage` in `bundle.targets` — `pnpm tauri build` only produces `.deb` / `.rpm` on Linux
- CI workflow: new `arch` job in `archlinux:latest` container, uploads `framexshot_<ver>_x86_64.pkg.tar.zst`
- AUR `packaging/aur/PKGBUILD` synced to v1.0.6 with Hyprland deps

### Fixed

- **GDBus `NotAllowed` portal error** on Hyprland: `is_flatpak()` gate prevents the portal call from inside a Flatpak; native install uses host tools directly.
- **Blank window / "Operation was cancelled"**: PKGBUILD now uses `pnpm tauri build --no-bundle` and validates that the binary has embedded frontend assets before packaging.

## [Unreleased] — older v1.0.0-rc history

These entries are kept for archaeology of the pre-1.0.0 release-candidate line.

### Fixed

- **Background Border at 0px**: Fixed issue where background was still visible when Background Border was set to 0px. Now 0px means no background border at all - the screenshot edges touch the canvas edges directly.

### Added

- **Background Border slider**: New control in the Background Effects panel to adjust the padding around captured screenshots
  - Slider range: 0px (no border) to 200px (maximum border)
  - Smart default: Automatically calculates 5% of the average image dimension, capped at 200px
  - Real-time preview updates during slider drag
  - Full undo/redo support
  - Tooltip explaining the control's purpose
- **Frontend test framework**: Set up Vitest with React Testing Library
  - 19 tests for editor store padding functionality
  - Test coverage for transient/commit actions, undo/redo, and smart defaults
- **Rust unit tests**: Added tests for image processing utilities
  - 8 tests for CropRegion bounds clamping and validation
  - 5 tests for filename generation and directory utilities

### Changed

- Padding is now a configurable setting stored in EditorSettings (previously hardcoded to 100px)
