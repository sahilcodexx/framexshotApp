# Changelog

All notable changes to FrameXShot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-10-02

**Drawing, cropping, an opt-in startup entry and self-update.** The editor gains Pen and Highlighter tools and a crop tool that really deletes pixels; the app stops registering itself with your desktop behind your back; and portable builds can update from inside Settings.

### Editor

- **Pen and Highlighter tools** — freehand strokes with width and opacity controls. Highlighter caps its own alpha at 0.45 and uses square caps so overlapping translucent segments do not darken into dots; Pen honours the opacity you pick. Strokes are smoothed with a quadratic curve through segment midpoints.
- **Crop tool (destructive)** — pick Crop, drag a selection, confirm with the Crop button in the bottom bar. Everything outside the selection is deleted, producing a genuinely smaller image. Because that is irreversible at the pixel level, undo now restores the previous *image* as well as the previous annotations, so a crop → crop → undo → undo chain walks back correctly.
  - Selections are clamped to the screenshot rect, so a stray drag cannot crop into the padding or the mockup frame.
  - Crop geometry lives in `src/lib/crop-selection.ts` with unit tests, including the 36px mockup-header offset that would otherwise silently shift every selection upward.
- **Export scale** — `0.5x` / `1x` / `2x` output multiplier in Settings → General.
- **Sliders no longer draw tick marks by default**, which removes visual noise from every panel that uses them.

### Capture

- **Countdown delay for UI-triggered captures** — capture from the app window can wait out a user-set delay with a visible on-screen countdown, so you can open a menu or switch windows before the shutter fires. Global hotkeys stay instant by design: a multi-second wait after every keypress reads as the app hanging.

### Startup

- **Launch at login is now opt-in** (Settings → General → Startup). Previous versions registered the app as a startup app on every launch with no way to turn it off from inside the app.
  - A separate **"Start hidden to tray"** switch decides what the login launch actually shows. The autostart registration always carries `--hidden` because the plugin bakes its arguments in at init; this switch is what makes the window appear or not.
  - When the platform cannot report the registration state, the switches disable themselves rather than showing "off" — an unknown state must not be indistinguishable from a disabled one.

### Updates

- **In-app self-update for portable installs** (Settings → About). Checks GitHub for a newer release, verifies the artifact against the release's SHA-256, installs it and relaunches.
  - Flatpak, system packages and Homebrew installs are detected and told which command to run instead — the app never overwrites itself behind a package manager's back.
  - Windows self-update is not supported.
- **Release CI now publishes `checksums.txt`** — each build job hashes its own bundle output and the publish job merges the per-arch files into the release before it goes live.

## [1.2.0] - 2026-09-23

**One-line macOS install + Homebrew tap.** A universal installer script at the repo root, a Homebrew cask that clears Gatekeeper automatically, and a fix that made the Linux build-from-source installer 404 for every end user.

### Installer

- **New universal `install.sh`** (repo root) — detects the OS via `uname -s`:
  - **macOS**: resolves the latest release tag via the GitHub API (or `FXS_VERSION` to pin), picks the chip-matching DMG (`arm64` → `*_aarch64.dmg`, `x86_64` → `*_x64.dmg`), mounts with `hdiutil`, replaces `/Applications/framexshot.app`, unmounts, and runs `xattr -cr` so Gatekeeper never blocks the app. No Apple Developer certificate required.
  - **Linux**: delegates to the existing `packaging/install.sh` build-from-source flow.
  - Works piped: `curl -fsSL https://raw.githubusercontent.com/sahilcodexx/framexshotApp/main/install.sh | sh`
- **Linux installer repo slug fixed**: `packaging/install.sh` pointed at the private `sahilcodexx/framexshot` repo, so unauthenticated tag/tarball requests 404'd for every end user. It now uses the public `sahilcodexx/framexshotApp` repo.

### macOS

- **Homebrew tap cask staged** (`packaging/homebrew-framexshot/Casks/framexshot.rb`) for `sahilcodexx/homebrew-framexshot` — `on_arm` / `on_intel` blocks point at the per-architecture release DMGs, and a `postflight` step runs `xattr -cr` so `brew install --cask framexshot` needs no manual Gatekeeper step.
- **README — Gatekeeper section rewritten** with all three macOS install paths: Homebrew, the universal curl script, and a step-by-step zero-Terminal "Open Anyway" walkthrough for non-technical users (with screenshot-style descriptions).

## [1.1.0] - 2026-09-18

**Windows and macOS support.** FrameXShot now builds and runs on Windows (x86_64) and macOS alongside Linux. The capture *flow* is unchanged — what's new is the Windows/macOS capture backend and the platform-conditional UI.

### Capture — Windows

- **New backend** (`src-tauri/src/xcap_capture.rs`) on the [`xcap`](https://crates.io/crates/xcap) crate's Windows GDI path (`BitBlt`)
  - **Region** → captures the primary monitor to a static, then the `region-selector` overlay crops it
  - **Fullscreen** → every monitor is captured and stitched into one virtual-desktop image (negative monitor origins are handled)
  - **Window** → the active window's bounds via `xcap`
- **Folder picker** → `tauri-plugin-dialog` (native Windows browser) instead of the Linux `zenity` / `kdialog` shell-outs
- **Shutter sound** → Win32 `MessageBeep`
- **Cursor position** → Win32 `GetCursorPos`
- **Installer** → NSIS (`framexshot_<version>_x64-setup.exe`). `nsis` was already in `bundle.targets`, so no `msi` / WiX target was added

### Capture — macOS

- **Same backend as Windows** (`src-tauri/src/xcap_capture.rs`) — `xcap` is cross-platform, so macOS uses its CoreGraphics backend (`CGWindowListCreateImage`) and needs no shell-outs. The Linux chain (grim / slurp / spectacle / cosmic-screenshot / scrot / maim / hyprshot / grimblast) is now gated `target_os = "linux"` and is never compiled on macOS.
  - **Region** → captures the primary monitor to a static, then the `region-selector` overlay crops it
  - **Fullscreen** → every monitor is captured and stitched into one virtual-desktop image (negative monitor origins are handled)
  - **Window** → the focused window's bounds via `xcap`
- **Folder picker** → `tauri-plugin-dialog` (native macOS picker) instead of the Linux `zenity` / `kdialog` shell-outs
- **Shutter sound** → `afplay` on `/System/Library/Sounds/Glass.aiff`, falling back to `Ping.aiff`
- **Cursor position** → always `(0,0)` — macOS has no dependency-free way to read the cursor, so the quick overlay is positioned on the first monitor

### Changed

- **Windows resize support**: the main window is created with `decorations(false)`, and unlike GTK there is no compositor fallback — a frameless Windows window could not be resized *at all*. `TitleBar` now renders 8 invisible, Windows-only grab strips (4 edges at 5px, 4 corners at 12px) that call `startResizeDragging`. Linux and macOS render exactly as before.
- **Platform-neutral copy**: `bundle.shortDescription` / `bundle.longDescription` no longer claim the app is "for Linux"; the Preferences *About* blurb and the save-path placeholder are no longer Linux-specific; the global-hotkeys "disabled" wording no longer mentions Xwayland outside Linux.
- **Platform-conditional UI**:
  - The Hyprland / Wayland `bind = $mainMod SHIFT, 2, ...` hint block is now shown on **Linux only**.
  - The macOS **Screen Recording Permission** onboarding step is omitted on Windows and Linux (no Windows-specific replacement step was added).
  - The OCR permission-failure message only shows the macOS *System Settings → Privacy & Security → Screen Recording* guidance on macOS; Windows now gets a "check that nothing is blocking screen capture" message instead.
- New `src/lib/platform.ts` exporting SSR-safe `isMac` / `isWindows` / `isLinux` helpers, used by the platform-conditional UI above.

### Known platform limitations

- **Region capture covers the primary monitor only (Windows and macOS)** — the selector overlay is a single `fullscreen(true)` window on the primary display, so secondary-monitor and cross-monitor regions are not supported yet. Fullscreen capture *does* cover the whole virtual desktop.
- **Window capture can return black for GPU-composited windows (Windows)** — `xcap` uses the GDI path, which cannot read surfaces drawn with hardware overlay / flip-model composition (some games, video players and hardware-accelerated windows).
- **Window capture requires Screen Recording permission (macOS 10.15+)** — grant it in *System Settings → Privacy & Security → Screen Recording*. Without it the OS returns a black or empty image.
- **Cursor position always reports `(0,0)` on macOS** — so the quick overlay is positioned on the first monitor rather than the monitor under the cursor.
- **Tesseract must be installed separately** for the OCR feature — it is not bundled, and OCR fails with a "Tesseract OCR not installed" message when `tesseract` is not on `PATH`.

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
