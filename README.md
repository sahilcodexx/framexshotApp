# FrameXShot

A fast, open-source **cross-platform screenshot tool** built with Tauri v2 + React — first-class on Linux (X11 + Wayland), with native Windows and macOS builds. Capture, edit, and enhance your screenshots with professional quality — entirely offline, entirely local.

[![License: BSD 3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-informational)](#-install)

> Lives in the system tray, captures with a keypress, applies backgrounds / effects / annotations — all in a slick adaptive UI (light / dark via shadcn oklch) powered by Rust + React.

No cloud. No telemetry. Everything happens locally.

---

## ✨ Features

### Capture

| Mode | Description | Default Shortcut |
|------|-------------|-----------------|
| **Region** | Drag-select any area of the screen | `Ctrl+Shift+2` |
| **Fullscreen** | Capture the full display | `Ctrl+Shift+F` |
| **Window** | Capture a specific application window | `Ctrl+Shift+D` |
| **OCR Region** | Extract text from a selected region (copies to clipboard) | `Ctrl+Shift+O` |

All shortcuts are customisable in Preferences.

- **Linux** — capture works on X11 and Wayland via `xcap`, `grim` + `slurp`, `spectacle`, `cosmic-screenshot`, and the GNOME Shell / xdg-desktop-portal D-Bus interfaces — automatic fallback per desktop environment.
- **Windows** — capture runs through the `xcap` crate on the Windows GDI path (`BitBlt`). No external capture tool is required and no system permission is requested.
- **macOS** — capture goes through the platform capture backend (`xcap`) and requires Screen Recording permission.

### Image Editor

- **Background library** — Curated wallpapers, mac-style assets, mesh gradients, and solid colours
- **Custom backgrounds** — Pick any hex colour or use a transparent checkerboard
- **Effects** — Blur + noise sliders with 200 ms idle-commit for silky preview performance
- **Shadow** — Configurable X/Y offset, blur, and opacity (inner shadow keeps the visual frame balanced)
- **Border radius** — Pixel-perfect corner rounding
- **Padding** — Equal on all four sides
- **Floating sidebar** — Detached `rounded-2xl` card with `-mt-8` top fill
- **Cursors** — `pointer` for buttons, `grab/grabbing` for canvas, `ew-resize` for sliders, `crosshair` for drawing
- **Export** — High-quality JPEG to disk, or direct clipboard copy

### Annotation Tools

- **Shapes** — Circle, rectangle, line, arrow
- **Text** — Add labels with adjustable size
- **Numbered badges** — Auto-incrementing callout labels for step-by-step guides
- **Interaction** — Select, move, resize, and delete annotations
- **Styling** — Colour, opacity, border, and alignment controls

### Workflow

- **Global shortcuts** — Capture from anywhere, even when the window is hidden in the tray
- **Auto-apply** — Apply your default background and save without ever opening the editor
- **Quick Overlay** — A floating preview window that fades out automatically
- **System tray** — FrameXShot lives in the tray; close to hide, never quits until you say so
- **Persistent preferences** — Save directory, shortcut bindings, theme, and defaults survive restarts
- **Keep-mounted editor** — The editor stays in the DOM between captures, so state is never lost

---

## 📦 What's Shipped

| Platform | Asset | Notes |
|----------|-------|-------|
| **Linux (x86_64)** | `.deb`, `.rpm`, `.pkg.tar.zst` (+ `.sig`), `.flatpak` | Native Arch `.pkg.tar.zst` recommended on CachyOS / Arch / Hyprland (grim+slurp, no portal sandbox) |
| **Linux (arm64)** | `.deb`, `.rpm` | Raspberry Pi / Asahi / etc. |
| **Windows** | `*_x64-setup.exe` | NSIS installer |
| **macOS (Intel)** | `*_x64.dmg` | macOS 10.15+ |
| **macOS (Apple Silicon)** | `*_aarch64.dmg` | macOS 10.15+ |

> **AppImage is not shipped.** Its FUSE namespace breaks WebKitGTK on COSMIC and several other Wayland compositors (blank window for normal users). Use `.deb`, `.rpm`, `.pkg.tar.zst`, or `.flatpak` instead.

---

## 🚀 Install

### 📦 Debian / Ubuntu / Pop!_OS / Mint

```bash
# x86_64
sudo apt install ./framexshot_<version>_amd64.deb

# arm64
sudo apt install ./framexshot_<version>_arm64.deb
```

### 📦 Fedora / RHEL / Nobara / openSUSE

```bash
# x86_64
sudo dnf install ./framexshot_<version>_x86_64.rpm

# arm64
sudo dnf install ./framexshot_<version>_aarch64.rpm
```

### 🏔️ Arch Linux / CachyOS / Manjaro (native package)

Download the signed `.pkg.tar.zst` from [Releases](../../releases) and install:

```bash
sudo pacman -U ./framexshot_<version>_x86_64.pkg.tar.zst
```

The native package compiles against your system WebKit/GTK — no Flatpak sandbox. On Hyprland, capture uses `grim`+`slurp` directly (no `xdg-desktop-portal` screenshot calls). Optional Hyprland helpers:

```bash
sudo pacman -S hyprshot hyprland-contrib xdg-desktop-portal-hyprland
```

**Build the package locally:**

```bash
./packaging/arch/build-package.sh
```

### 📦 Flatpak (universal Linux)

```bash
flatpak install --user ./framexshot_<version>_amd64.flatpak
```

The Flatpak includes all runtime dependencies (WebKitGTK, portal, etc.) so it works on any distro without installing them first.

### 🖥️ Windows

Download `framexshot_<version>_x64-setup.exe` and run the installer — **NSIS** is the Windows installer target, so there is no MSI/WiX toolchain to install.

**Windows prerequisites**

| Requirement | Needed for |
|-------------|-----------|
| **WebView2 runtime** | Rendering the UI. Preinstalled on Windows 11 and current Windows 10; the installer can fetch it if it is missing. |
| **Tesseract OCR** | The **OCR Region** feature only. Install the [UB Mannheim build](https://github.com/UB-Mannheim/tesseract/wiki) and make sure `tesseract.exe` is on your `PATH`. |
| **Rust MSVC toolchain** | Building from source only: `rustup default stable-msvc`, plus the *Desktop development with C++* workload from Visual Studio Build Tools. |

**Build & run from source on Windows**

```powershell
pnpm install
pnpm tauri dev     # dev build with HMR
pnpm tauri build   # release build + NSIS installer
```

> This repo pins `pnpm` (`packageManager` in `package.json`, plus `pnpm-lock.yaml` / `pnpm-workspace.yaml`). If you prefer npm, the equivalents are `npm install`, `npm run tauri dev`, and `npm run tauri build`.

Build artifacts land in `src-tauri/target/release/bundle/nsis/`. `nsis` is the only Windows installer target configured in `tauri.conf.json`; the `deb` / `rpm` / `dmg` targets are simply ignored when building on Windows.

**Windows capture backend**

- **Screen capture** — the [`xcap`](https://crates.io/crates/xcap) crate with the **`wgc`** feature, i.e. Windows.Graphics.Capture rather than the older GDI `BitBlt` path. No `grim` / `slurp` / `spectacle` equivalent is needed, and Windows has no screen-recording permission prompt to grant.
- **Folder picker** — `tauri-plugin-dialog`, i.e. the native Windows folder browser.
- **Shutter sound** — the Win32 `MessageBeep` API.
- **Cursor position** — the Win32 `GetCursorPos` API.
- **Region overlay** — a borderless always-on-top window moved and sized to cover the monitor under the cursor. That same monitor is the one captured, so selections are correct on multi-monitor and mixed-DPI setups.

**Known Windows limitations**

- **Region capture works on one monitor at a time.** The overlay covers whichever monitor the cursor is on, so any single display can be used — but a region *spanning* two monitors is not supported. *Fullscreen* capture does stitch all monitors into one virtual-desktop image.
- **WGC requires Windows 10 1903 (build 18362) or newer.** On Windows 10 the OS draws a yellow border around the surface while it is being captured; Windows 11 suppresses it.
- **OCR needs Tesseract installed separately.** It is not bundled — see the prerequisites table above. FrameXShot detects it at startup and tells you how to install it if it is missing, rather than failing mid-capture.

### 🍎 macOS

Download the DMG for your architecture and drag FrameXShot to `/Applications`:

```bash
# Apple Silicon (M1/M2/M3/M4)
open framexshot_<version>_aarch64.dmg

# Intel
open framexshot_<version>_x64.dmg
```

**macOS prerequisites**

| Requirement | Needed for |
|-------------|-----------|
| **Screen Recording permission** | Window capture (macOS 10.15+). Grant it in *System Settings → Privacy & Security → Screen Recording*. |
| **Tesseract OCR** | The **OCR Region** feature only. Install with `brew install tesseract`. |
| **Xcode Command Line Tools + Rust** | Building from source only: `xcode-select --install`, then the stable Rust toolchain. |

**Build & run from source on macOS**

```bash
pnpm install
pnpm tauri dev     # dev build with HMR
pnpm tauri build   # release build + .dmg bundle
```

> This repo pins `pnpm` (`packageManager` in `package.json`, plus `pnpm-lock.yaml` / `pnpm-workspace.yaml`). If you prefer npm, the equivalents are `npm install`, `npm run tauri dev`, and `npm run tauri build`.

Build artifacts land in `src-tauri/target/release/bundle/dmg/`. `dmg` is the only macOS bundle target configured in `tauri.conf.json`; the `deb` / `rpm` / `nsis` targets are simply ignored when building on macOS.

**macOS capture backend**

- **Screen capture** — the [`xcap`](https://crates.io/crates/xcap) crate on its CoreGraphics backend (`CGWindowListCreateImage`). No `grim` / `slurp` / `spectacle` equivalent is needed.
- **Folder picker** — `tauri-plugin-dialog`, i.e. the native macOS folder browser.
- **Shutter sound** — `afplay` on a system sound (`/System/Library/Sounds/Glass.aiff`, falling back to `Ping.aiff`).
- **Cursor position** — `CGEventGetLocation` via a small CoreGraphics FFI shim (`src-tauri/src/mac_api.rs`).
- **Region overlay** — a borderless always-on-top window moved and sized to cover the monitor under the cursor. Deliberately *not* native fullscreen, which would exile the overlay to its own Space behind a ~1s animation and render it against a black backdrop.

**Screen Recording permission (required)**

macOS 10.15+ gates all screen capture behind the *Screen Recording* TCC permission. FrameXShot checks for it before every capture and, if it is missing, shows a message with an **Open Settings** button instead of capturing.

This matters because the failure is otherwise silent: without permission `CGWindowListCreateImage` does **not** error — it returns your desktop wallpaper with every window missing, which looks like a working capture of an empty desktop.

1. System Settings → Privacy & Security → Screen Recording → enable **FrameXShot**
2. **Quit and reopen FrameXShot.** macOS caches the permission answer for the lifetime of the process, so granting it does not take effect until a restart.

**Gatekeeper on unsigned builds**

If a release was built without an Apple Developer certificate, macOS reports *"FrameXShot is damaged and can't be opened."* That message is about the missing code signature, not a corrupt download:

```bash
xattr -cr /Applications/framexshot.app
```

The release workflow signs and notarizes automatically once the `APPLE_*` repository secrets are configured — see the comments in `.github/workflows/release.yml`.

**Known macOS limitations**

- **Region capture works on one monitor at a time.** The overlay covers whichever monitor the cursor is on, so any single display can be used — but a region *spanning* two monitors is not supported. *Fullscreen* capture does stitch all monitors into one virtual-desktop image.
- **The menu bar and Dock stay on top of the region overlay.** Tauri's always-on-top maps to `NSFloatingWindowLevel` (3), which is below `NSMainMenuWindowLevel` (24), and a higher level is not reachable through Tauri's public API. The captured image still includes those areas and selection coordinates are unaffected — but a drag *starting* on the menu bar strip goes to the menu bar.
- **macOS 10.15 (Catalina) is the minimum.** The Screen Recording permission APIs the app links against do not exist before it.
- **OCR needs Tesseract installed separately.** Install it with `brew install tesseract`. FrameXShot detects it and tells you how to install it if it is missing, rather than failing mid-capture.

---

## 🖥️ Desktop Environment & Wayland Capture Compatibility

FrameXShot automatically detects your desktop environment and Wayland/X11 session, using multi-tiered capture fallbacks:

| Desktop Environment | Display Server | Primary Tool | Fallback Chain |
|---------------------|----------------|--------------|----------------|
| **GNOME 42+** | Wayland / X11 | `org.gnome.Shell` D-Bus (built-in, no install needed) | `xdg-desktop-portal` → `gnome-screenshot` |
| **KDE Plasma 5/6** | Wayland / X11 | `spectacle` | `xdg-desktop-portal` → `grim` + `slurp` |
| **COSMIC** | Wayland | `cosmic-screenshot` | `xdg-desktop-portal` → `grim` |
| **Sway / Hyprland** | Wayland (wlroots) | `grim` + `slurp` | `xdg-desktop-portal` |
| **XFCE / MATE / Cinnamon / LXQt** | X11 | `maim` / `scrot` / `spectacle` | `xdg-desktop-portal` → `xcap` |

### Install capture backends

Most desktops already ship a working tool (GNOME 42+ works out of the box — no install needed). For the others:

**Debian / Ubuntu / Pop!_OS / Mint:**
```bash
sudo apt install spectacle grim slurp scrot maim wl-clipboard tesseract-ocr xdg-desktop-portal
```

**Fedora / RHEL:**
```bash
sudo dnf install spectacle grim slurp scrot maim wl-clipboard tesseract xdg-desktop-portal
```

**Arch Linux / Manjaro:**
```bash
sudo pacman -S spectacle grim slurp scrot maim wl-clipboard tesseract xdg-desktop-portal
```

**openSUSE (Leap / Tumbleweed):**
```bash
sudo zypper install spectacle grim slurp scrot maim wl-clipboard tesseract-ocr xdg-desktop-portal
```

*Tip: For OCR, install `tesseract-ocr` (Debian/Ubuntu) or `tesseract` (Fedora/Arch/openSUSE).*

---

## ⚙️ Build from Source

### Requirements

| Tool | Minimum Version |
|------|----------------|
| Node.js | 20+ |
| pnpm | 10+ |
| Rust | 1.80+ (stable) |
| Tauri CLI | v2 |

### System Build Dependencies

**Debian / Ubuntu / Pop!_OS:**
```bash
sudo apt update
sudo apt install -y build-essential curl wget pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf libxdo-dev clang libclang-dev \
  libpipewire-0.3-dev libgbm-dev libdrm-dev
```

**Fedora / RHEL / CentOS:**
```bash
sudo dnf install -y gcc gcc-c++ make curl wget pkg-config \
  gtk3-devel webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel \
  librsvg2-devel patchelf libxdo-devel clang-devel \
  pipewire-devel mesa-libgbm-devel libdrm-devel
```

**Arch Linux / Manjaro:**
```bash
sudo pacman -S --needed base-devel curl wget pkgconf \
  gtk3 webkit2gtk-4.1 libayatana-appindicator \
  librsvg patchelf xdotool clang \
  pipewire mesa libdrm
```

**openSUSE (Leap / Tumbleweed):**
```bash
sudo zypper install -t pattern devel_basis
sudo zypper install -y gtk3-devel libwebkit2gtk-4_1-devel \
  libayatana-appindicator3-devel librsvg-devel patchelf \
  libxdo-devel clang-devel pipewire-devel
```

**Windows (MSVC):**

No GTK / WebKitGTK / appindicator packages are needed. You need the MSVC Rust toolchain, the MSVC C++ build tools, and the WebView2 runtime (plus Node.js 20+ and pnpm 10+ from the table above):

```powershell
# Rust, MSVC toolchain
rustup default stable-msvc

# Visual Studio Build Tools with the "Desktop development with C++" workload
winget install Microsoft.VisualStudio.2022.BuildTools

# WebView2 runtime (already present on Windows 11 and current Windows 10)
winget install Microsoft.EdgeWebView2Runtime

# Optional — only for the OCR Region feature
winget install UB-Mannheim.TesseractOCR
```

### Clone & Build

```bash
git clone https://github.com/sahilcodexx/framexshotApp.git
cd framexshotApp

pnpm install --frozen-lockfile
pnpm tauri build
```

Build artifacts land in `src-tauri/target/release/bundle/`. The native Arch package is built separately with `./packaging/arch/build-package.sh`.

---

## 📖 Usage

### Quick Start

1. Launch FrameXShot — it appears in the system tray
2. Press a capture shortcut (default: `Ctrl+Shift+2` for region)
3. Select your area
4. The editor opens — pick a background, adjust effects, annotate
5. Press `Ctrl+S` to save or `Shift+Ctrl+C` to copy to clipboard

### Auto-Apply Workflow

For lightning-fast captures without touching the editor:

1. Toggle **"Auto-apply background"** on the main screen
2. Set your preferred default background in Preferences
3. Capture — FrameXShot automatically applies the background and saves instantly
4. A **Quick Overlay** preview fades in for a few seconds, then disappears
5. Done — no editor required

### Keyboard Shortcuts

#### Capture

| Action | Default |
|--------|---------|
| Capture Region | `Ctrl+Shift+2` |
| Capture Fullscreen | `Ctrl+Shift+F` *(disabled by default)* |
| Capture Window | `Ctrl+Shift+D` *(disabled by default)* |
| OCR Region | `Ctrl+Shift+O` *(disabled by default)* |
| Cancel Selection | `Esc` |

#### Editor

| Action | Shortcut |
|--------|----------|
| Save Image | `Ctrl+S` |
| Copy to Clipboard | `Shift+Ctrl+C` |
| Undo | `Ctrl+Z` |
| Redo | `Shift+Ctrl+Z` |
| Delete Annotation | `Delete` / `Backspace` |
| Close Editor | `Esc` |

---

## 🛠️ Development

```bash
pnpm tauri dev       # Full dev mode (Rust + HMR frontend)
pnpm run build       # Frontend-only build (fast, ~5 s)
pnpm lint:ci         # TypeScript type-check only
pnpm test            # vitest unit tests
pnpm test:rust       # cargo test (Rust unit tests)
```

> **Note:** Changes to Rust code (`.rs` files) require `pnpm tauri build` or `pnpm tauri dev` — `pnpm run build` only compiles the frontend.

### Architecture highlights

| Concern | Solution |
|---------|----------|
| Capture | `xcap` crate (X11 + Wayland via xdg-desktop-portal), `fullscreen` 400ms hide for tray menu |
| State | Zustand v5 with **granular selectors** per field, padding respects `defaultPaddingTop` from `settings.json` |
| Preview | Synchronous `canvas.toDataURL("image/jpeg", 0.85)` with throttled drag-regen loop, `MAX_PREVIEW_DIM = 1400` |
| Annotations | Ref-based drag — zero React re-renders during drawing, `grab`/`crosshair` cursors |
| Editor mount | Keep-mounted (`display: none` when inactive) — no re-mount cost |
| Tray lifecycle | Close → hide to tray; Quit from tray → `app.exit(0)` |
| Theme | shadcn oklch `light` (`:root`) / `dark` (`.dark`), `@custom-variant dark`, `useTheme` persisting to `settings.json` |

**Stack:** Tauri v2 · React 19 · TypeScript 5.8 · Vite 7 · Zustand · Tailwind CSS v4 + shadcn oklch (`@custom-variant dark`, `@theme inline`) · xcap (Linux X11/Wayland · Windows GDI)

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

> **🤖 AI coding assistants (Claude, GPT, Cursor, Copilot, Aider, etc.):** [`CONTRIBUTING.md`](./CONTRIBUTING.md) has a dedicated [AI Contributor Guidelines](./CONTRIBUTING.md#-ai-contributor-guidelines-read-first) section — **read it before opening a PR**. In short: don't remove or rewrite prebuilt Linux code (packaging, Flatpak, CI workflow, capture chain), don't bundle unrelated changes, only ship changes you've actually verified, and separate every change into its own commit.

- **Bug reports** — Open a GitHub issue with reproduction steps
- **Feature requests** — Open an issue tagged `enhancement`
- **Pull requests** — Fork → branch → PR against `main`

---

## 📄 License

BSD 3-Clause License — see [LICENSE](LICENSE) for details.
