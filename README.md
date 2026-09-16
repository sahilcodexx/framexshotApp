# FrameXShot

A fast, open-source **Linux screenshot tool** built with Tauri v2 + React. Capture, edit, and enhance your screenshots with professional quality — entirely offline, entirely local.

[![License: BSD 3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)](https://www.linux.org)

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

All shortcuts are customisable in Preferences. Capture works on X11 and Wayland via `xcap`, `grim` + `slurp`, `spectacle`, `cosmic-screenshot`, and the GNOME Shell / xdg-desktop-portal D-Bus interfaces — automatic fallback per desktop environment.

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

Download `framexshot_<version>_x64-setup.exe` and run the installer — no extra dependencies.

### 🍎 macOS

Download the DMG for your architecture and drag FrameXShot to `/Applications`:

```bash
# Apple Silicon (M1/M2/M3/M4)
open framexshot_<version>_aarch64.dmg

# Intel
open framexshot_<version>_x64.dmg
```

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

**Stack:** Tauri v2 · React 19 · TypeScript 5.8 · Vite 7 · Zustand · Tailwind CSS v4 + shadcn oklch (`@custom-variant dark`, `@theme inline`) · xcap (X11/Wayland)

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
