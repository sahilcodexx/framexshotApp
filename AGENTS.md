# FrameXShot — Full Agent Context

## Project Overview

Linux desktop screenshot tool built with Tauri v2 + React 19 + Vite 7 + TypeScript 5.8.
All code is local (no network). The app lives in the system tray, captures region/screen/window/OCR,
edits them (annotations, backgrounds, effects), and saves to disk or copies to clipboard.

### Directory Layout

```
framexshot/
├── src/
│   ├── App.tsx                    # Root component — router, event listeners, capture flow
│   ├── main.tsx                   # React entry point
│   ├── index.css                  # Tailwind v4 + CSS variables (Framer theme)
│   ├── components/
│   │   ├── TitleBar.tsx           # Custom title bar (minimize/close)
│   │   ├── SettingsIcon.tsx       # Settings gear button
│   │   ├── ImageEditor.tsx        # Full editor (lazy loaded)
│   │   ├── editor/
│   │   │   ├── AnnotationCanvas.tsx    # Canvas overlay for drawings/shapes
│   │   │   ├── AnnotationToolbar.tsx   # Drawing tool selector
│   │   │   ├── AssetGrid.tsx           # Background image grid
│   │   │   ├── BackgroundSelector.tsx  # Background type picker
│   │   │   ├── EffectsPanel.tsx        # Blur/noise/padding/shadow controls
│   │   │   ├── ImageRoundnessControl.tsx # Border radius slider
│   │   │   └── PropertiesPanel.tsx     # Selected annotation properties
│   │   ├── ui/                        # Reusable primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── switch.tsx
│   │   │   └── tooltip.tsx
│   │   ├── onboarding/           # First-run onboarding flow
│   │   ├── preferences/          # Settings/preferences page
│   │   └── overlay/              # Quick overlay window
│   ├── hooks/
│   │   └── usePreviewGenerator.ts # Renders full preview (canvas + annotations + effects)
│   ├── stores/
│   │   ├── editorStore.ts        # Zustand store for all editor state
│   │   └── index.ts              # Re-exports all selectors
│   ├── lib/
│   │   ├── asset-registry.ts     # Image asset list + centralized imports
│   │   ├── auto-process.ts       # Auto-apply background on capture
│   │   ├── canvas-utils.ts       # Canvas rendering helpers
│   │   ├── annotation-utils.ts   # Annotation drawing on canvas
│   │   ├── onboarding.ts         # Onboarding state helpers
│   │   └── utils.ts              # cn() + misc utilities
│   ├── types/
│   │   └── annotations.ts        # Annotation and tool types
│   ├── assets/                   # Image assets (mac-assets, meshes, etc.)
│   └── test/                     # Test setup
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                # Tray, window creation, menu events
│   │   ├── main.rs               # Entry point (calls lib::run)
│   │   ├── commands.rs           # All IPC commands
│   │   ├── screenshot.rs         # xcap screen capture
│   │   ├── clipboard.rs          # Clipboard operations
│   │   ├── image.rs              # Image processing
│   │   ├── ocr.rs                # OCR via tesseract
│   │   └── utils.rs              # Shared helpers
│   ├── tauri.conf.json           # Tauri config (windows: [])
│   └── capabilities/
│       ├── default.json          # IPC permissions
│       └── desktop.json
├── DESIGN.md                     # Framer design analysis (from getdesign)
├── AGENTS.md                     # This file
└── package.json
```

## Stack

| Layer     | Technology                                          |
|-----------|-----------------------------------------------------|
| Frontend  | React 19, TypeScript 5.8, Vite 7.3                 |
| Styling   | Tailwind CSS v4 (`@theme` inline) + shadcn oklch, CSS variables, `@custom-variant dark` |
| State     | Zustand v5 (editor) + React useState (app)          |
| UI        | Radix primitives, Lucide icons, Sonner toasts, shadcn |
| Animation | `motion/react` (framer-motion v12)                  |
| Backend   | Tauri v2.11, Rust                                    |
| Capture   | xcap (X11/Wayland), xdg-desktop-portal              |
| Storage   | tauri-plugin-store (JSON), tauri-plugin-autostart    |
| Shortcuts | tauri-plugin-global-shortcut                        |
| Theme     | Dynamic light/dark via `useTheme` + `html.dark` class, persisted to `settings.json` |

## Design System — shadcn + Framer (src/index.css)

Dynamic light/dark via oklch. Light = `:root` (`background oklch(1 0 0)` white), Dark = `.dark` (`background oklch(0.145 0 0)` near-black). `@theme inline` maps `--color-background: var(--background)` etc, plus `--color-canvas: var(--background)` alias so `bg-canvas`/`bg-card` flip.

```
Light (:root): --background oklch(1 0 0) / --card oklch(1 0 0) / --border oklch(0.922) / --ring oklch(0.708)
Dark (.dark):  --background oklch(0.145) / --card oklch(0.205) / --border oklch(1 0 0 /10%) / --ring oklch(0.556)
--color-canvas: var(--background) (alias)
--color-destructive: oklch(0.577) light / oklch(0.704) dark
--radius: 0.625rem → --radius-sm/lg/xl via calc
--shadow-*: 0.04-0.10 light / 0.35-0.55 dark (minimal light, heavier dark)
--font-sans: Inter Variable, Inter, system-ui, sans-serif
```

**Conventions:**
- Buttons PILLS (`rounded-full`). `bg-primary` flips (dark: light pill, light: dark pill), `bg-secondary` muted, `bg-destructive/10` for Cancel red tint.
- Cards `rounded-xl`/`rounded-2xl` `bg-card` + `border-border`. Sidebar floating `rounded-2xl border bg-card shadow-sm dark:shadow-xl`.
- Display type `tracking-[-0.04em] leading-[0.95]`.
- Cursors specific: `pointer` for buttons, `grab/grabbing` for canvas/2D pad, `ew-resize` for sliders, `crosshair` for drawing, `default` for `data-tauri-drag-region`.
- No hardcoded `bg-[#xxx]` — all surfaces use tokens so light/dark flip.

## How It Works

### Capture Flow

1. User clicks capture button in App or tray menu
2. `handleCapture()` is called (in App.tsx:295)
3. Window hides (`appWindow.hide()`) — 100ms (400ms for `fullscreen` to let tray menu close) `App.tsx:331`
4. Native capture invoked via Tauri IPC:
   - `native_capture_interactive` (region/ocr) → xcap + portal
   - `native_capture_fullscreen` → xcap full monitor
   - `native_capture_window` → xcap window
5. Capture saves to temp dir, path returned to frontend
6. If `autoApplyBackground` is on → auto-process with default bg → quick overlay
7. If off → `setTempScreenshotPath(path)` + `setMode("editing")` → ImageEditor mounts

### Event Flow (Tray → Frontend)

```
Rust tray menu click
  → on_menu_event (lib.rs:127)
  → show_main_window(app)           # restores window from tray
  → app.emit("capture-triggered")   # emits Tauri event
  → Frontend listen() handler fires (App.tsx:516)
  → handleCaptureRef.current("region")  # uses ref to avoid stale closure
  → handleCapture() hides window, captures, shows window again
```

### Editor Flow

1. ImageEditor mounts (lazy loaded, stays mounted via keep-mounted pattern)
2. `useEffect` with `[]` runs `editorActions.initialize()` once (not on every image change)
3. Image loaded into canvas via `usePreviewGenerator`
4. User adjusts background, effects, annotations — all go to Zustand store
5. Preview generator renders frame via `toDataURL("image/jpeg", 0.85)` on setting commit
6. Save → `invoke("save_edited_image")` → Rust saves to disk + clipboard

### Zustand Store Architecture (editorStore.ts)

```
EditorStore {
  settings: {                // Each field has its own Zustand selector
    backgroundType,
    customColor,
    selectedImageSrc,
    gradientId,
    blurAmount, noiseAmount,
    borderRadius,
    paddingTop/Bottom/Left/Right,
    shadow: { blur, offsetX/Y, opacity }
  },
  annotations: Annotation[], // Undo/redo stack
  past: EditorSettings[],    // For undo
  future: EditorSettings[],  // For redo
  actions: { ... }
}
```

**Selectors** (in stores/index.ts):
- `useBackgroundType()` — only re-renders when background changes
- `useBlurAmount()` — only re-renders when blur changes
- `useShadowBlur()`, `useShadowOffsetX()`, `useShadowOffsetY()`, `useShadowOpacity()` — individual shadow selectors
- `useCanUndo()`, `useCanRedo()`, `useAnnotations()`, etc.

---

## All Changes — Complete Record

### Change 1: Preview Generation (JPEG instead of PNG)
- **Files**: `src/hooks/usePreviewGenerator.ts` (find `toDataURL`)
- **BEFORE**: `canvas.toBlob("image/png")` → async blob → `URL.createObjectURL(blob)` — slow PNG encode
- **AFTER**: `canvas.toDataURL("image/jpeg", 0.85)` — sync encode, 10x smaller payload
- **Impact**: Faster preview, less memory, no blob URL management needed
- **REVERT**: Replace `toDataURL(...)` with `toBlob(...)` + `createObjectURL`

### Change 2: AnnotationCanvas Ref-based Drag
- **Files**: `src/components/editor/AnnotationCanvas.tsx`
- **BEFORE**: Mouse events dispatched to Zustand `setAnnotations` on every frame — React re-rendered per pixel
- **AFTER**: Mutable refs track drag coordinates; only commit to Zustand on `mouseup`. Canvas redraws locally via ref.
- **Impact**: Zero React re-renders during drag, silky 60fps
- **REVERT**: Replace ref-based coords with Zustand setters in `onPointerMove`

### Change 3: Granular Zustand Selectors
- **Files**: `src/stores/editorStore.ts`, `src/stores/index.ts`, `src/components/ImageEditor.tsx`
- **BEFORE**: `useSettings()` returned entire settings object — any change re-rendered ImageEditor
- **AFTER**: Individual selectors like `useBackgroundType()`, `useBlurAmount()`, etc.
- **Impact**: EffectsPanel doesn't re-render when padding changes, etc.
- **REVERT**: Replace individual selectors with single `useSettings()`

### Change 4: Blur/Noise Idle Commit (200ms)
- **Files**: `src/hooks/usePreviewGenerator.ts` (find `renderEffectsRef`)
- **BEFORE**: Blur/noise rendered on every slider change — stutter during drag
- **AFTER**: Skip during drag; commit to canvas only when slider stops for 200ms
- **Impact**: Preview stays interactive during slider drag
- **REVERT**: Remove the idle timer, render effects synchronously

### Change 5: Individual Shadow Selectors
- **Files**: `src/stores/editorStore.ts` (find `useShadowBlur`, etc.), `src/stores/index.ts`
- **BEFORE**: Single `useShadow()` selector returned full shadow object
- **AFTER**: `useShadowBlur()`, `useShadowOffsetX()`, `useShadowOffsetY()`, `useShadowOpacity()` + memoized composite
- **Impact**: Changing padding no longer re-renders EffectsPanel
- **REVERT**: Remove individual selectors, revert to single `useShadow()`

### Change 6: Slider Component Memoized
- **Files**: `src/components/ui/slider.tsx`
- **BEFORE**: `const Slider = ...` (not memoized)
- **AFTER**: `const Slider = React.memo(SliderComponent)`
- **Impact**: Slider doesn't re-render when parent re-renders
- **REVERT**: Remove `React.memo` wrapper

### Change 7: Sidebar Scroll — contain:content
- **Files**: `src/components/ImageEditor.tsx` (find `contain:content` in sidebar div)
- **BEFORE**: `will-change:scroll-position` on sidebar — created permanent compositor layer
- **AFTER**: `contain:content` — prevents layout recalcs without compositor overhead
- **Impact**: Smooth scroll, less GPU memory
- **REVERT**: Replace `contain:content` with `will-change:scroll-position`

### Change 8: Transition Scope Reduction
- **Files**: `src/components/editor/AssetGrid.tsx`, `src/components/editor/BackgroundSelector.tsx`
- **BEFORE**: `transition-all` on thumbnails and buttons
- **AFTER**: `transition-shadow` / `transition-colors` / `transition-transform` per element
- **Impact**: No unnecessary property animations
- **REVERT**: Replace specific transitions with `transition-all`

### Change 9: Remove shadow-2xl from AnnotationCanvas
- **Files**: `src/components/editor/AnnotationCanvas.tsx`
- **BEFORE**: `shadow-2xl` class on canvas container
- **AFTER**: Removed
- **Impact**: Faster canvas composite, no heavy shadow layer
- **REVERT**: Add `shadow-2xl` back

### Change 10: Lazy Image Loading
- **Files**: `src/components/editor/AssetGrid.tsx`, `src/components/editor/BackgroundSelector.tsx`
- **BEFORE**: `<img>` elements loaded eagerly (blocked initial paint)
- **AFTER**: `loading="lazy"` + `decoding="async"` on all `<img>`
- **Impact**: Faster initial render, images load on scroll
- **REVERT**: Remove `loading="lazy" decoding="async"`

### Change 11: Asset Deduplication
- **Files**: `src/lib/asset-registry.ts`, `src/hooks/useEditorSettings.ts`
- **BEFORE**: Both files imported `assetCategories` containing 35MB of image data
- **AFTER**: `assetCategories` centralized in `asset-registry.ts` (exports `getAssetCategories()`); `useEditorSettings.ts` no longer imports images
- **Impact**: 35MB removed from JS bundle of non-editor pages
- **REVERT**: Move `assetCategories` back to `useEditorSettings.ts`

### Change 12: Image Compression
- **Files**: Image files in `src/assets/`
- **BEFORE**: 13MB PNG (mac-asset-7), 3.2MB JPEG (mac-asset-10), total ~35MB
- **AFTER**: 1.3MB JPEG (mac-asset-7), 201KB JPEG (mac-asset-10), total ~13MB
- **Command**: `mogrify -strip -quality 82 *.jpg` (ImageMagick)
- **Impact**: 63% reduction in asset size, faster image decode
- **REVERT**: Restore original images from git or backup

### Change 13: Keep-Mounted Pattern (Pages stay in DOM)
- **Files**: `src/App.tsx` (the entire return block, lines ~645-850)
- **BEFORE**: Early returns at top of component. Changing modes unmounted the current page (all state lost). `if (mode === "editing") return <ImageEditor/>;`
- **AFTER**: All 4 pages always present in DOM. Active page gets `flex-1 overflow-auto`, inactive gets `hidden` (`display: none`).
- **Impact**: ImageEditor preserves images/colors/annotations across captures. No re-mount cost.
- **REVERT**: Restore early-return pattern with `if (mode === "editing") return <ImageEditor/>;`

### Change 14: Remove imagePath dependency from Editor init
- **Files**: `src/components/ImageEditor.tsx` (find `useEffect` with `initialize()`)
- **BEFORE**: `useEffect(() => { editorActions.reset(); editorActions.initialize(); }, [imagePath]);`
- **AFTER**: `useEffect(() => { editorActions.initialize(); }, []);`
- **Impact**: Store not reset on every new capture. Editor keeps previous state.
- **REVERT**: Add `editorActions.reset()` back and depend on `imagePath`.

### Change 15: Custom TitleBar Component
- **Files**: `src/components/TitleBar.tsx` (NEW)
- **BEFORE**: No TitleBar — system native title bar (when decorations=true)
- **AFTER**: 36px custom bar with `data-tauri-drag-region`, "Better Shot" label (left), minimize/close buttons (right)
  - Minimize: `appWindow.minimize()`
  - Close: `appWindow.close()` (the Rust CloseRequested handler hides to tray)
- **Impact**: App has custom frame regardless of OS theme
- **REVERT**: Delete the TitleBar component and remove `<TitleBar/>` from App.tsx

### Change 16: Window Decorations Disabled (All 3 windows)
- **Files**:
  - `src-tauri/src/lib.rs:31` — `show_main_window` function
  - `src-tauri/src/lib.rs:77` — `setup` window creation
  - `src-tauri/src/commands.rs:521` — quick-overlay window
- **BEFORE**: `.decorations(true)` on all 3 windows
- **AFTER**: `.decorations(false)` on all 3 windows
- **Impact**: Removes OS-native title bar/chrome. Requires custom TitleBar component.
- **Note**: Rust changes require `npm run tauri build` to take effect. `npm run build` only compiles JS/CSS.
- **REVERT**: Change each `.decorations(false)` back to `.decorations(true)`

### Change 17: Tray Capture Fix (show window before emitting)
- **Files**: `src-tauri/src/lib.rs:133-156`
- **BEFORE**: Tray menu items directly emitted events: `app.emit("capture-triggered", ())` without showing window
  - `"open"` → called `show_main_window` ✓
  - `"preferences"` → called `show_main_window` ✓
  - `"capture_region"` → no `show_main_window` ✗
  - `"capture_screen"` → no `show_main_window` ✗
  - `"capture_window"` → no `show_main_window` ✗
  - `"capture_ocr"` → no `show_main_window` ✗
- **AFTER**: All capture menu items call `show_main_window(app)` before emitting the event
- **Impact**: Hidden windows are restored before capture starts, ensuring event handlers in the WebView process the request
- **REVERT**: Remove the `show_main_window(app)` calls from the capture tray handlers

### Change 18: Framer UI Redesign (CSS + components)
#### 18a: CSS Variables — Framer Dark Palette
- **Files**: `src/index.css` (replaced entirely)
- **BEFORE**: OKLCH color space with light mode + dark mode classes
  - Light: `--background: oklch(0.9232 0.0026 48.7171)` (light beige)
  - Dark: `--background: oklch(0.2244 0.0074 67.4370)` (off-black)
  - Font: `Plus Jakarta Sans`
  - Radius: `--radius: 1.25rem` (20px)
  - Custom `shadow-x/y/blur/spread/opacity` system
- **AFTER**: Direct hex values, Framer palette, dark mode only
  - Canvas #090909, Surface #141414/#1c1c1c, Hairline #262626
  - White ink, muted #999999, accent #0099ff
  - Inter Variable font
  - Standardized shadow scale (black on dark)
  - `@theme inline` block only (no separate `.dark` class)
- **REVERT**: Restore the old CSS with OKLCH colors and light/dark mode

#### 18b: Button — Pill Shape + Framer Variants
- **Files**: `src/components/ui/button.tsx`
- **BEFORE**:
  - `default`: `bg-primary text-primary-foreground` (purple-ish)
  - `outline`: bordered with shadow
  - `ghost`: transparent
  - `cta`: gradient fill + inset shadow + hover brightness
  - `rounded-md` (8px) base
- **AFTER**:
  - ALL variants: `rounded-full` (pill shape, Framer spec)
  - `default`: white bg, dark text, `hover:bg-white/90`
  - `secondary`: charcoal bg, white text, `hover:bg-[#262626]`
  - `destructive`: red pill
  - `outline`: bordered transparent, fills charcoal on hover
  - `ghost`: muted text, white on hover
  - `link`: accent blue underline
  - `cta`: same as default (flat white pill, no gradient)
  - `focus-visible`: accent blue ring, offset from canvas
  - Sizes: slightly more horizontal padding (px-5 default, px-6 lg)
- **REVERT**: Restore old button variants (purple default, gradient CTA, rounded-md)

#### 18c: Card — Framer Surface + Radius
- **Files**: `src/components/ui/card.tsx`
- **BEFORE**: `rounded-lg border bg-card text-card-foreground shadow-sm`
- **AFTER**: `rounded-xl border border-border bg-card text-card-foreground shadow-sm`
- **Impact**: Cards now use Framer's 20px radius (xl) and explicit border-border
- **REVERT**: Change `rounded-xl` to `rounded-lg`

#### 18d: Switch — Slim Track, Blue Accent
- **Files**: `src/components/ui/switch.tsx`
- **BEFORE**:
  - Track: `h-6 w-11`, checked = primary (was purple), unchecked = input
  - Thumb: `h-5 w-5`, `bg-background`, `shadow-lg`
- **AFTER**:
  - Track: `h-5 w-9`, `border border-border`
  - Checked: `bg-accent` (#0099ff blue)
  - Unchecked: `bg-secondary` (#1c1c1c charcoal)
  - Thumb: `h-3.5 w-3.5`, `bg-foreground` (white), `shadow-sm`
  - Offset: `data-[state=checked]:translate-x-4` / `data-[state=unchecked]:translate-x-0.5`
- **REVERT**: Restore old switch dimensions and colors

#### 18e: Slider — Clean White Thumb
- **Files**: `src/components/ui/slider.tsx`
- **BEFORE**: Track `h-1.5`, primary color fill, thumb `w-4 h-4` `shadow-sm`
- **AFTER**: Track `h-1`, `bg-secondary`, white fill (`#ffffff`), thumb `w-3.5 h-3.5` `shadow-none`, clean
- **REVERT**: Restore old slider styles

#### 18f: Main Page — Poster Typography
- **Files**: `src/App.tsx`
- **BEFORE**:
  - Title: `text-5xl font-bold text-foreground text-balance`
  - Version badge: `rounded-full border border-border bg-card` pill
  - Subtitle: normal spacing
  - Cards: `bg-card border-border` (standard)
  - Capture buttons: all `variant="cta"` (gradient purple)
  - Error state: `bg-red-950/30 border border-red-800/50 rounded-lg`
- **AFTER**:
  - Title: `text-5xl font-medium leading-[0.95] tracking-[-0.04em] text-foreground text-balance` — Framer poster style
  - Version: plain `text-xs font-medium tracking-[-0.01em] text-muted-foreground` (no badge pill)
  - Subtitle: `text-muted-foreground text-sm text-pretty max-w-sm`
  - Cards: unchanged structure, inherits new Framer CSS variables
  - Capture buttons: Region = `variant="default"` (white pill, primary call), OCR/Screen/Window = `variant="secondary"` (charcoal pills)
  - Error state: `bg-[#1c0c0c] border border-[#3a1a1a] rounded-xl` — dark red on dark
  - Layout: `bg-canvas` instead of `bg-background`, `max-w-lg` instead of `max-w-2xl`, `space-y-8` instead of `space-y-6`
- **REVERT**: Restore old App.tsx layout (title styling, version badge, button variants, card sizing)

### Change 19: DESIGN.md
- **Files**: `DESIGN.md` (NEW, 544 lines)
- Generated by: `npx getdesign@latest add framer`
- Contains: Complete Framer design analysis — colors, typography, components, spacing, layout, responsive behavior
- Purpose: Reference for future UI work. All Framer spec values live here.
- **REVERT**: Delete the file

### Change 20: Linux Distro Hardening — cross-desktop capture fallbacks
- **Files**: `src-tauri/src/capture.rs` (NEW), `src-tauri/src/commands.rs`, `src-tauri/src/screenshot.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- **BEFORE**: Hard-coded per-tool capture: COSMIC → grim → gnome-screenshot → scrot. Modern GNOME (42+) has no `gnome-screenshot` binary and no grim (non-wlroots), so capture failed on the most common Linux desktop. KDE Wayland was never tried (spectacle only ran on X11). The Flatpak bundle contained NO capture tool, so it could not take screenshots at all.
- **AFTER**: New `capture.rs` module with universal fallback chains:
  - **Region**: cosmic-screenshot → spectacle (KDE) → grim+slurp (wlroots) → **org.gnome.Shell SelectArea/ScreenshotArea over D-Bus** → gnome-screenshot → maim/scrot
  - **Fullscreen**: cosmic-screenshot → spectacle → grim → **GNOME Shell Screenshot D-Bus** → **xdg-desktop-portal Screenshot D-Bus** → gnome-screenshot → scrot (portal works on every desktop, incl. inside Flatpak)
  - **Window**: cosmic → spectacle → GNOME Shell ScreenshotWindow → gnome-screenshot → scrot
  - Uses `zbus` (pure Rust, already in tree via xcap) + system-tool shell-outs. Linux-only deps: `zbus = "5"`, `url = "2"`.
  - `commands.rs` / `screenshot.rs` refactored to delegate to the chains instead of duplicating tool logic.
- **REVERT**: Delete capture.rs, restore the old per-tool blocks in commands.rs + screenshot.rs

### Change 21: GitHub Release CI + Flatpak Manifest Fixes
- **Files**: `.github/workflows/release.yml` (rewritten), `flatpak/com.framexshot.app.yml`, `src-tauri/tauri.conf.json`
- Root causes of failing Linux release builds, all fixed:
  1. **3 wrong sha256 checksums** in the flatpak manifest (tesseract 5.5.0, leptonica 1.85.0, `eng.traineddata` — the latter was a fake `e5e5e5...` placeholder) → flatpak-builder rejected every download
  2. **Invalid YAML**: `- name: tesseract` at column 0 (not an item of `modules:`) → flatpak-builder parse error
  3. **GNOME runtime 47** was EOL-adjacent → bumped to **48**
  4. **No build caches** → added `swatinem/rust-cache` (Rust + frontend), flatpak runtime cache + builder state cache, `--ccache` for flatpak-builder, `pnpm install --frozen-lockfile`
  5. **No rpm package**: rpm bundling now included (`sudo apt install rpm`, targets `appimage,deb,rpm`)
  6. **No macOS jobs** → added `macos-13` (x86_64) + `macos-14` (aarch64) DMG builds
  7. `includeUpdaterJson` removed (no updater configured); `concurrency` group added
  8. **`bundle.maintainer` removed** (invalid tauri-build schema field; would fail `cargo check --release`)
- **tauri.conf.json**: added rpm target + deb/rpm `depends`/`recommends` (appindicator alternatives, tesseract-ocr, grim/slurp/scrot/spectacle, xdg-desktop-portal, wl-clipboard etc.), `category`, `shortDescription`, `longDescription`, `homepage`
- **REVERT**: restore old release.yml, old flatpak yml, old tauri.conf.json

### Change 23: Dynamic shadcn Theme (light/dark)
- **Files**: `src/index.css`, `src/hooks/useTheme.ts`, all components with `bg-[#xxx]`
- **BEFORE**: Framer dark-only (`#090909`, `#141414`, `border #262626`), no light. Every surface hardcoded `bg-[#111]`/`bg-[#202]` so `border-border` flipping to light created white-on-black wireframe (sidebar, cards, dividers all traced). Shadows same in both modes.
- **AFTER**: Full shadcn oklch palette: `:root` light `oklch(1 0 0)` white/card, `.dark` dark `oklch(0.145)` near-black/card `oklch(0.205)`, `border oklch(0.922)` light vs `10%` dark, `ring oklch(0.708/0.556)`. `@theme inline` maps `--color-background: var(--background)` + alias `--color-canvas: var(--background)`. `@custom-variant dark (&:is(.dark *))` + `@layer base * { @apply border-border }`. `useTheme` toggles `html.dark` (light is default `:root`), persisted to `settings.json`. Every `bg-[#xxx]` replaced with `bg-canvas`/`bg-card`/`bg-sidebar`/`bg-secondary`/`bg-muted` + `ring-border`/`border-border` so surfaces flip. Light shadows `0.04-0.10`, dark `0.35-0.55`.
- **REVERT**: Restore old `index.css` Framer hex, remove `useTheme`, re-add hardcodes

### Change 24: Cursor System — specific per interaction
- **Files**: `src/index.css`, `src/components/editor/AnnotationCanvas.tsx:1211`, `src/components/editor/ImagePositionControl.tsx:125`, `src/components/ui/pill-slider.tsx:213`, `src/components/ui/slider.tsx:53`
- **BEFORE**: All buttons relied on browser default, canvas had no grab, sliders had `cursor-pointer`, pad had `cursor-crosshair`
- **AFTER**: `@layer base` sets `button,a,[role="button"]{cursor:pointer}`, `data-tauri-drag-region{cursor:default}`, `data-cursor="grab/grabbing/ew-resize/crosshair"`. Canvas `select` → `cursor-grab active:cursor-grabbing`, `text` → `cursor-text`, else `crosshair`. Pad `cursor-grab`. Pill/slider `cursor-ew-resize`. Switch `data-[state=checked]:bg-primary` + thumb `bg-background` (visible in both).
- **REVERT**: Remove `@layer base` cursor block, revert to generic

### Change 25: Loading Centered
- **Files**: `src/components/ImageEditor.tsx:445-472`
- **BEFORE**: `absolute inset-0` inside `relative w-full h-full` — parent `min-h-0` collapsed, `inset-0` anchored to wrong relative, spinner stuck left edge (see screenshot)
- **AFTER**: `flex items-center justify-center` (no absolute) inside `relative w-full h-full flex`, parent `flex-1 flex items-center justify-center` does centering. All three states (`Generating`, `Error`, `Loading`) are regular flex children, dead-center of preview area.
- **REVERT**: Add `absolute inset-0` back

### Change 26: Padding Default Fix — no random jumps
- **Files**: `src/components/ImageEditor.tsx:211-232`
- **BEFORE**: Every `img.onload` did `avgDimension*0.1 → setPaddingTopTransient` unconditionally, overwriting `Set as Default` saved in `settings.json` (`defaultPaddingTop`) on next capture, so after 2-3 captures padding drifted per image size
- **AFTER**: `img.onload` is `async`, loads `Store("settings.json").get("defaultPaddingTop")`, if `!= null` returns early (keeps saved 19% etc). Only auto 10% when no default saved. Added `Store` import.
- **REVERT**: Remove store check, always auto-set

### Change 27: Capture Screen Delay 400ms (only fullscreen)
- **Files**: `src/App.tsx:331`
- **BEFORE**: `await hide(); await delay(100)` for all modes — `Capture Screen` fired so fast tray menu was captured (see screenshot with open menu at top-right)
- **AFTER**: `const hideDelay = captureMode==="fullscreen"?400:100` — only `fullscreen` gets 400ms, `region`/`window`/`ocr` stay 100ms
- **REVERT**: Change back to fixed 100

### Change 28: Important Buttons Colored + Cancel Red
- **Files**: `src/components/ImageEditor.tsx:478`, `src/components/editor/RightSidebar.tsx:1244`, `src/components/preferences/PreferencesPage.tsx:230`
- **BEFORE**: Cancel `ghost text-muted-foreground`, Set as Default `bg-foreground/[0.06]` muted, Browse Folder `bg-secondary` — all low-contrast
- **AFTER**: Cancel `bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20` (subtle red, not solid on hover), Set as Default `bg-secondary text-secondary-foreground border` (was `bg-primary` solid, now visible in both), Browse Folder `variant="default" bg-primary` solid. Export stays `bg-primary`. Icons `text-muted-foreground` when inactive, `text-primary` when active (was `text-accent` invisible on light).
- **REVERT**: Restore ghost/muted

### Change 29: Icon Visibility in Light
- **Files**: `src/components/preferences/PreferencesPage.tsx:166`, `src/components/ui/switch.tsx:12,20`
- **BEFORE**: Active nav icon `text-accent` `oklch(0.97)` light gray on white card invisible; Switch track `bg-accent` gray + thumb `bg-foreground` swapped — thumb red in screenshot
- **AFTER**: Active icon `text-primary`, dot `bg-primary` (high contrast). Switch track `data-[state=checked]:bg-primary` / `unchecked:bg-input`, thumb `bg-background` (white in light, dark in dark) — visible both. Pill `bg-secondary`/`bg-foreground/[0.07]` already dynamic.
- **REVERT**: Restore `text-accent` / `bg-accent`

### Change 30: Sidebar Top Gap Fill + Detached Floating
- **Files**: `src/components/ImageEditor.tsx:504-518`, `src/index.css` shadows, `src/components/editor/RightSidebar.tsx:338`
- **BEFORE**: Sidebar `p-3` on all sides left 12px black strip above card (red box in screenshot), card `bg-popover shadow-2xl` heavy in light, inner grouped `bg-card` same as outer (no nested contrast), `overflow-hidden` + `sidebar-scroll` on same div clipped text (`"DEFAULT ST"`/`"Paddin"`)
- **AFTER**: Sidebar outer `p-3 -mt-8` (pulls 32px into TitleBar area, card top now at window top with 12px gap like bottom), `bg-canvas` outer / `bg-card` inner + `bg-background` for grouped rows (nested contrast), `shadow-sm dark:shadow-xl` minimal in light, split `overflow-hidden` (outer card) + `overflow-y-auto sidebar-scroll` (inner scroll) + `min-w-0` on flexes so `px-4`/`truncate` no longer clips (`"Paddin"` → `"Padding"`)
- **REVERT**: Remove `-mt-8`, restore `shadow-2xl` and single `overflow-hidden`

### Change 22: Quick Overlay — instant preview (no 5s white screen)
- **Files**: `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/image.rs`, `src/components/overlay/QuickOverlay.tsx`, `src/lib/auto-process.ts`
- **BEFORE**: After every auto-apply capture the overlay was unusably slow (~5-6s white screen):
  1. `QuickOverlay` called `win.close()` after 5s → the window + WebKit was destroyed after EVERY capture
  2. `show_quick_overlay` then created a brand-new window on demand (GTK/WebKit init = seconds), showed it, and only AFTER that emitted the payload → blank white first paint
  3. auto-process encoded the framed canvas as `image/png, quality 1.0` (multi-second for large canvases)
- **AFTER**:
  1. `lib.rs` pre-creates the hidden `quick-overlay` window at startup (`visible(false)` + `skip_taskbar(true)`) — the WebView/React listener is always warm by the time a capture happens
  2. `QuickOverlay` hides instead of closes → window reused forever after first init
  3. `show_quick_overlay` emits `overlay-show-capture` BEFORE `show()` → first paint already shows the image
  4. On a new payload the overlay clears the previous image immediately (no stale-flash on reused window)
  5. `auto-process.ts` renders `image/jpeg, 0.9` instead of PNG — ~5× faster encode, ~8× smaller payload; `save_base64_image` is now mime-aware (png/jpg extensions)
- **REVERT**: restore `win.close()`, emit-after-show, remove pre-creation, revert to PNG

---

### Change 31: Padding Drag — preview composited at preview resolution + fixed drag regen loop
- **Files**: `src/hooks/usePreviewGenerator.ts`, `src/lib/frame-presets.ts`
- **BEFORE**: Two problems made padding changes feel laggy:
  1. Every preview regen composited at the screenshot's FULL resolution (2+ full-res canvases, full-res `getImageData`/`putImageData` for adjustments) and only downscaled to ≤1400px afterwards — enormous per-tick pixel work.
  2. The drag regen loop was accidentally dead: the settings effect's cleanup ran on every per-pixel padding update and cleared the loop's timer (ref kept the stale id, so the loop never restarted), and the loop closure captured a stale `generatePreview` (padding from drag start). Net: preview rendered once at drag start, froze, jumped at release.
- **AFTER**:
  1. `renderFullCanvas` takes `options.maxDimension` — computes the full-res output size, derives a uniform scale `s = min(1, maxDimension / maxDim)`, then composites the whole frame directly in output space: image draw size, padding, layout extra, frame padding, mockup header (36px → 36·s), traffic lights / window X geometry, border radius, shadow blur/offset, pan offsets all × s. `scaleFrameStyle()` (frame-presets) scales frame chrome (padding/strokes/glow). Blur radius and noise amplitude also × s so the preview matches the downscaled export. Live preview calls it with `maxDimension: 1400`; export/auto-process call without it (full-res, unchanged).
  2. Drag regen loop moved out of the settings effect into a store subscription on `_isDragging` edges (rising edge starts a recursive 50ms `setTimeout` loop, falling edge stops it and renders once with effects). The loop calls `generatePreviewRef.current` (latest closure via a sync effect) so padding is never stale, and sets `renderEffectsRef = false` at drag start. Unmount clears the loop timer.
- **Impact**: ~4-8× less pixel work per preview regen; preview tracks the padding slider continuously instead of freezing mid-drag. Canvas size still grows with padding (output = screenshot + padding — required), but each step is now cheap.
- **REVERT**: remove `maxDimension`/`scaleFrameStyle`, restore full-res render + downscale, move drag loop back into the settings effect with a stale closure

---

### Change 32: Slider Drag Feel — handle tracks cursor 1:1
- **Files**: `src/lib/hooks/use-slider.ts`, `src/components/motion/range-slider.tsx`, `src/components/motion/range-slider-debounced.tsx`
- **BEFORE**: The thumb position was derived from the controlled store value, so every pointermove had to round-trip `onValueChange → store write → sidebar re-render` before the handle moved; on the busy editor sidebar that lagged visibly behind the cursor. On top, `useSpring(SPRING_GLIDE)` always chased the target — a spring is always a few frames behind a moving pointer, reading as extra lag. And `RangeSliderDebounced` pushed a transient store write per pointermove (mice poll faster than displays refresh), flooding the sidebar with re-renders.
- **AFTER**:
  1. `useSlider` keeps an optimistic `dragValue` state used for rendering while `draggingRef` is true (set in `commit`, cleared in `endDrag`) — the handle follows the cursor immediately; the controlled value catches up alongside for the preview.
  2. `RangeSlider` renders `pos = dragging ? target : smooth` — raw 1:1 tracking during drag, spring glide only for external jumps (presets, undo), where glide looks right. The spring keeps chasing `target` throughout, so the release handoff is seamless.
  3. `RangeSliderDebounced` coalesces transient updates to one per animation frame (first change of a gesture fires immediately; subsequent ones overwrite a pending ref flushed on rAF), and sets `_isDragging` true on the first change, false at commit — so at most ~60 store writes/sec instead of one per pointermove.
- **Impact**: Padding/quality/offset sliders track the cursor exactly; no visible lag between pointer and thumb; sidebar re-renders capped at display refresh rate.
- **REVERT**: remove `dragValue`, restore `pos = smooth`, remove rAF coalescing

---

### Change 33: Export Options — format, quality, filename template
- **Files**: `src/lib/export-settings.ts` (NEW), `src/lib/export-settings.test.ts` (NEW), `src-tauri/src/image.rs`, `src-tauri/src/commands.rs`, `src/components/ImageEditor.tsx`, `src/components/preferences/PreferencesPage.tsx`, `src/App.tsx`, `src/lib/auto-process.ts`
- **BEFORE**: Export was hard-coded PNG (editor `toBlob("image/png")`), filenames were always `framexshot_<timestamp>.png` from Rust `generate_filename`, and the quick-overlay auto-save was hard-coded JPEG 0.9. No user control.
- **AFTER**:
  - `export-settings.ts`: `ExportPrefs { format: png|jpeg|webp, quality 1-100, filenameTemplate }` persisted in `settings.json` (`saveFormat`/`saveQuality`/`filenameTemplate`), with `loadExportPrefs()`, `canvasToDataUrl()` (uses `toBlob` with the requested mime + quality; resolves with the mime the encoder ACTUALLY produced, since WebKitGTK silently falls back to PNG for unsupported types), `buildFilenameFromTemplate()` (tokens `%date` → `2026-10-01`, `%time` → `14-30-05`; strips `/\:*?"<>|` + control chars, collapses whitespace, trims dots, caps 120 chars, falls back to `framexshot`), and `buildExportFilename()` (returns `undefined` for the default template so Rust default naming stays).
  - Rust: `save_base64_image_named(image_data, save_dir, filename_base)` — extension always derived from the mime prefix (webp added to `decode_base64_image`), user extension stripped, never overwrites (appends `_1`…`_999`); `save_edited_image` gained optional `filename: Option<String>`; `sanitize_filename_base` mirrors the frontend sanitization as defense in depth.
  - Editor `handleSave` uses the user's format/quality/filename. Clipboard copies stay PNG regardless (the copy path encodes PNG itself). Auto-apply/overlay path (`auto-process.ts` + App.tsx `save_edited_image` calls) also uses format/quality + template filename. Editor `onSave` signature is now `(dataUrl, filename?) => void`.
  - Preferences → General: format pill picker (PNG/JPEG/WEBP), quality slider (lossy only), filename template input with live preview line.
- **Impact**: Users can save as JPEG/WebP at chosen quality with meaningful names (`%date %time` etc.); defaults preserve the exact old behavior (PNG + `framexshot_<timestamp>`).
- **Note**: Rust changed → needs `npm run tauri build` (or `cargo tauri dev`) to take effect in the packaged app; plain `npm run dev` picks it up automatically.
- **REVERT**: delete export-settings.ts(+test), restore hard-coded PNG saves, drop `filename` param and webp arm

---

### Change 34: Drag Frame Budget — cheaper per-frame preview renders
- **Files**: `src/hooks/usePreviewGenerator.ts`
- **BEFORE**: Drag frames rendered at the full 1400px preview size, JPEG 0.80, every 50ms, and flipped `isGenerating` twice per frame (two whole-editor host re-renders per drag frame). A pointer held still kept re-rendering the identical frame every tick.
- **AFTER**: Drag frames render at `DRAG_PREVIEW_DIM` 900px + JPEG 0.72 (cost scales with pixel area — a slightly softer frame that tracks the cursor beats a crisp one that stutters; the settle render restores 1400px + effects ~200ms after release). `isGenerating` flips are skipped while dragging (nothing reads the spinner mid-gesture). Drag cadence 50ms → 34ms (~30fps). The drag loop JSON-keys the pending settings and renders only on change — a held-still pointer costs zero renders. The 200ms effects idle timer bails if a drag started after it was armed (falling edge renders the settled frame anyway).
- **REVERT**: remove DRAG_PREVIEW_DIM/DRAG_JPEG_QUALITY, restore unconditional isGenerating flips and the 50ms unconditional regen

---

### Change 35: Stable Canvas Size — logical frame space for annotations + display
- **Files**: `src/hooks/usePreviewGenerator.ts`, `src/components/editor/AnnotationCanvas.tsx`, `src/components/ImageEditor.tsx`, `src/lib/annotation-utils.ts`
- **BEFORE**: Change 34's two-tier preview (900px drag / 1400px rest) leaked into layout: AnnotationCanvas derived display size and its annotation coordinate space from the rendered buffer (`width:auto` on the buffer size + `canvas.width`-mapped clicks), so the on-screen canvas visibly **shrank when a padding drag started** and grew on release. Annotations also lived in buffer px, so the tier swap would have scaled them.
- **AFTER**:
  1. `getFrameDimensions(image, settings, padding)` exported from usePreviewGenerator — the logical (pre-tier) composite size, same math as renderFullCanvas without `maxDimension`.
  2. ImageEditor computes `frameDimensions` (memoized on the primitive inputs) and passes it as `frameSize` to AnnotationCanvas.
  3. AnnotationCanvas: display size fits the container by the LOGICAL aspect + size (fallback to buffer size when `frameSize` absent), so the canvas keeps one constant on-screen size across tiers and while padding changes the frame grows in place within the viewport instead of zooming. `getCanvasCoordinates` maps display→logical directly (buffer resolution cancels out).
  4. Annotations now live in LOGICAL frame px. `redraw()` sets `ctx.setTransform(frameScale, …)` (buffer px per logical px) and all drawing runs in logical space; `frameScaleRef` + `uiScaleRef` (logical px per screen px) drive the rest. `drawAnnotationOnCanvas(ctx, ann, { frameScale, uiScale })`: the blur annotation drops to identity transform (getImageData/putImageData are device-space) converting its rect by `frameScale`, and its blur radius scales by `frameScale` so intensity is resolution-independent.
  5. UI chrome (resize handles, hit sizes, selection outlines, curved-line guide) scales by `uiScale` — constant physical size on screen for any frame size. New-annotation defaults (border 5, text 48px, number radius 32, blurs/margins) multiply by `uiScale` so they look identical on a 4000px frame and a 1000px frame.
  6. Export path (`renderHighQualityCanvas`): the old 1000px `exportScaleFactor` scale hack is gone — the export canvas IS the logical frame, so annotations draw 1:1 (`frameScale: 1`). Fixes annotations being drawn ~1.4× too large on export for big captures.
- **Impact**: Padding changes resize the composed image in place; the canvas viewport never zooms. Drag/settle tier swaps are invisible except for sharpness. Annotation chrome constant on screen. Export annotation scale now correct.
- **REVERT**: drop `frameSize`/`getFrameDimensions`, restore buffer-derived display size + annotation space and the export scale hack

---

### Change 36: Pen + Highlighter annotation tools
- **Files**: `src/types/annotations.ts`, `src/lib/annotation-utils.ts`, `src/components/editor/AnnotationCanvas.tsx`, `src/components/editor/AnnotationToolbar.tsx`, `src/components/editor/PropertiesPanel.tsx`
- **BEFORE**: Annotation set had no freehand tool — only circle/rect/line/arrow/text/number/blur.
- **AFTER**: `PenAnnotation { type: "pen"|"highlighter", points: Point[], strokeWidth }` in logical frame px. Drawing uses quadratic smoothing through segment midpoints (sampled point as control, midpoint as endpoint); highlighter clamps alpha to ≤0.45 and uses square line caps so translucent segment joins don't stack into dark dots, pen uses round caps. Freehand capture: mousedown seeds `penPointsRef`, mousemove samples points ≥2px apart, mouseup commits one annotation (toolbar returns to select). Hit-testing walks the segments with a stroke-scaled tolerance; selection outline is the path's bbox padded by half the stroke; drag translates the whole point list. Defaults (`strokeWidth` 5 pen / 20 highlighter) scale by `uiScale` like other tools. PropertiesPanel gains a Stroke section (Width 2–24 pen / 2–60 highlighter, Opacity 5–100%).
- **REVERT**: remove PenAnnotation + the two toolbar entries + the stroke section

---

### Change 37: Export scale (0.5× / 1× / 2×)
- **Files**: `src/lib/export-settings.ts`, `src/hooks/usePreviewGenerator.ts`, `src/components/ImageEditor.tsx`, `src/components/preferences/PreferencesPage.tsx`
- **BEFORE**: Exports were always 1:1 with the composed frame — retina captures produced huge files, and there was no way to ship a smaller or 2× image.
- **AFTER**: `ExportPrefs.scale` (0.5/1/2, persisted as `saveScale`) with `EXPORT_SCALES` const; `renderFullCanvas` gains `options.outputScale` applied by `maybeScaleOutput()` AFTER all compositing (internal geometry never knows about it), and `renderHighQualityCanvas(annotations, imagePath, { outputScale })` draws annotations under `ctx.scale(outputScale)` with `frameScale: outputScale` so blur stays correct at any scale. Editor Export renders at the pref; Copy stays 1× PNG. Preferences gains a 0.5×/1×/2× pill group under Export format.
- **REVERT**: remove `saveScale`/`EXPORT_SCALES`/`maybeScaleOutput`/`outputScale` plumbing

---

### Change 38: Tick dots off + capture delay on the home page
- **Files**: `src/components/motion/range-slider.tsx`, `src/App.tsx`
- **BEFORE**: `RangeSlider` rendered step tick dots whenever the range had ≤50 steps, so short-range sliders (Blur 0–50, Padding 0–400 by 5, Corner 0–50) showed dots while 0–100 sliders (Noise, Opacity) showed none — inconsistent by accident, and the dots fought the fill bar. No way to delay a capture, so dropdown menus/tooltips closed before the shutter fired.
- **AFTER**: `showTicks` now defaults to `false` (still opt-in via the prop; Preferences quality slider already passed it explicitly). New `captureDelay` state (0/3/5/10s, persisted as `captureDelay` in settings.json, loaded in both `loadSettings` and the init effect) with a pill stepper on the home page under the capture-mode grid. `handleCapture` reads it from `settingsRef` and, when the capture came from the UI (`activeCaptureSourceRef`), waits after `hide()` ticking a visible countdown badge; hotkeys bypass the delay deliberately (a 5s hang after a hotkey would read as the app freezing). Countdown resets in the `finally` alongside `isCapturing`.
- **REVERT**: restore `showTicks = true`, remove the delay state/stepper/countdown

---

### Change 39: Launch at login — opt-in toggle + start-hidden-to-tray
- **Files**: `src-tauri/src/utils.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/autostart.ts` (NEW), `src/components/preferences/PreferencesPage.tsx`
- **BEFORE**: `setup()` silently force-enabled autostart on every launch — `if !autolaunch().is_enabled() { enable() }` — registering FrameXShot with the OS behind the user's back with no UI anywhere to turn it off. There was also no way to choose whether a login launch opened the window: the registration always carried `--hidden`, and `--hidden` unconditionally decided `visible(false)`.
- **AFTER**:
  - **Force-enable removed.** Launch at login is opt-in, driven only from Settings → General.
  - **`utils.rs`**: `AutostartPrefs { start_hidden }` + `read_autostart_prefs` / `write_autostart_prefs` over `<app_config_dir>/autostart.json`. Deliberately its own file, not `settings.json` — the decision is read in `setup()` *before* the webview that owns the store has mounted. A missing file, malformed JSON, or unreadable dir all resolve to `start_hidden = true` (never an error): this runs on every launch, and failing to start because a prefs file is corrupt is far worse than showing the window.
  - **`Default` is hand-written, not derived.** `#[derive(Default)]` would zero `start_hidden` to `false`, silently overriding the `#[serde(default = "default_true")]` and turning "no prefs file" into "show the window at login". Covered by 4 tests (default, round-trip, corrupt file, missing key).
  - **`commands.rs`**: `get_autostart_state` / `set_autostart(enabled, start_hidden)` returning `AutostartState { enabled, start_hidden }`. `enabled` is read back from the OS after every write rather than echoing the request, so a desktop that refuses the registration snaps the toggle back instead of lying. `start_hidden` is persisted even while `enabled` is false, so toggling off and back on restores the previous choice.
  - **`lib.rs`**: `is_hidden = launched_hidden && start_hidden_on_login`. The plugin bakes its args in at `init()` and exposes no `update_args`, so `--hidden` is always in the registration — this flag is what makes it mean something.
  - **Preferences**: a `Startup` card (Power icon) under General with "Launch at login" and "Start hidden to tray" switches. `Start hidden` is dimmed and disabled while launch-at-login is off. If the platform won't report the state (locked-down desktop), both switches disable and the copy says "Unavailable" rather than showing a confident "off".
- **Impact**: Launch-at-login is now visible, reversible and configurable. Also fixes a consent bug — the app was registering itself as a startup app whether or not the user wanted it.
- **Note**: Rust changed → needs `npm run tauri build` (or `cargo tauri dev`) to take effect in the packaged app.
- **REVERT**: restore the force-enable block in `setup()`, drop the two commands + Startup card + `autostart.ts`, revert `is_hidden = launched_hidden`

---

### Change 40: Crop tool (DESTRUCTIVE — rewrites the source image)
- **Files**: `src/lib/crop-selection.ts` (NEW) + `.test.ts` (NEW), `src/hooks/usePreviewGenerator.ts`, `src/types/annotations.ts`, `src/stores/editorStore.ts`, `src/stores/index.ts`, `src/components/editor/AnnotationToolbar.tsx`, `src/components/editor/AnnotationCanvas.tsx`, `src/components/ImageEditor.tsx`
- **Flow**: pick the Crop tool → drag a selection over the screenshot → a **Crop button appears in the bottom bar** next to Cancel/Copy/Export → click it → the unselected pixels are **deleted from the source image**. The screenshot itself becomes the crop, and the frame, canvas, background, padding and every effect recompute around the smaller image. Confirmed with an explicit dialog stating it cannot be undone.
- **NOT a viewport.** The first attempt stored the crop as a view window into the composed frame (`renderFullCanvas` sampled it at the end; annotations were translated by `-crop.x/-crop.y`; the preview rendered *uncropped* while the tool was active). That was wrong: it hid the unselected part instead of deleting it, left the original pixels intact, and never resized anything. All of it is reverted — `applyCrop`, the `ignoreCrop` option, the export-path annotation translate and the crop-aware `getFrameDimensions` are gone. `crop` is no longer an `EditorSettings` field; there is no persistent crop state to reset.
- **How destructiveness is achieved**: the cropped canvas is encoded to a PNG data URL and becomes a local `sourcePath` shadow (`croppedImagePath ?? imagePath`). `imagePath` is a prop owned by App.tsx — Cancel must still discard the editor and return to the *untouched* capture — so the swap is local to ImageEditor. Because the load effect keys off the source path, every derived value follows automatically; nothing about the background or frame needed special-casing.
- **Coordinate mapping**: the selection is defined on the SOURCE IMAGE and stored in source px; the canvas draws in logical frame space. `getImageContentRect()` (in usePreviewGenerator) is the single source of truth for where the image sits in the frame — layout inset, frame padding, pan offset, and the **36px mockup header**, which is drawn *inside* the framed layer above the image and would otherwise shift every selection up by 36px whenever a window frame is on. The same helper is called with the CROPPED dimensions to predict where the new image will land, so renderer and crop logic cannot drift apart.
- **Annotations survive the crop** (`rebaseAnnotationsForCrop`, 17 tests): each is translated by the same delta the image origin moved, and any that fell entirely outside the surviving pixels is dropped. Partially-visible annotations are kept — freehand bounds are grown by half the stroke so a stroke that merely grazes the new edge isn't silently deleted. History is only pushed when something is actually dropped.
- **Interaction**: drag to draw, drag from inside the selection to move it (size preserved, kept inside the image), rule-of-thirds guides, corner brackets. The selection is hard-clamped to the screenshot's rect — cropping into the padding or background would delete pixels the source doesn't contain — and that rect is outlined with a dashed stroke so the actionable area is visible rather than discovered by dragging. Canvas re-renders from drag refs, never React state.
- **Undo after crop** (added after the first cut): the source image became part of undo/redo. `HistorySnapshot` gained `sourceIndex` and the store an `EditorState.sourceIndex`; `undo`/`redo` restore it alongside settings and annotations, so **one Ctrl+Z brings back both the un-cropped image and the annotations that belonged to it**. The images themselves live in ImageEditor as `sourcesByCapture` (index 0 = original, each crop appends), because copying a multi-megabyte data URL into 50 snapshots would be a memory leak — the store only holds the index. Keyed by capture rather than reset, so no reset effect is needed and the editor's keep-mounted behaviour (Change 13) can't leak a cropped image into the next capture; a stale index from a previous capture simply misses the shorter list and falls back to the original. Last 3 captures retained (`MAX_SOURCE_CAPTURES`). `setSourceIndex` clears `future` — redo snapshots describe images the user has since diverged from.
- **Crop pushes exactly ONE history entry.** `setAnnotations` pushes its own snapshot, so crop calls `pushHistory()` first (capturing the pre-crop index + annotations) and wraps `setAnnotations` in `pauseHistory`/`resumeHistory`. Without this, one Ctrl+Z landed mid-crop — annotations restored, image still cropped. Caught by a test.
- **Crop fixes after first-cut testing** (3 bugs, all reported from screenshots):
  1. **Index 0 must always be the ORIGINAL.** Crops were appended starting at index 0, so after the first crop `sourceIndex` was 0 both before and after — undo restored the same index, resolved to the same cropped image, and looked like undo was simply dead. Extracted `resolveSourcePath(crops, index, original)` with index 0 = original, index N = `crops[N-1]`; 6 tests. Crop now sets `(list.length ?? 0) + 1`.
  2. **Tool/selection reset after applying was silently deleted** by a bad edit, leaving Crop active and the bottom-bar Crop button showing with nothing to apply. Restored. (Lesson: several of these bugs came from hand-rolled python slice-and-replace on a 700-line file eating surrounding lines — verified with `tsc` each time, but the deletion was only caught later by re-reading the function.)
  3. **No full-frame dim when there is no selection.** Dimming everything on tool activation reads as a greyed-out/broken image rather than "drag to select". Now only the dashed croppable-bounds outline shows until a selection exists.
- **Confirm copy corrected** to "You can undo this with ⌘Z" now that undo actually works.
- **Crop drag is frame-coalesced.** `redraw()` re-blits the full-resolution screenshot, so calling it straight from `pointermove` queued one full composite per event; mice poll at 125–1000Hz against a 60Hz display, and the overlay visibly trailed the cursor. Now coalesced to one `requestAnimationFrame` (same treatment as Change 34's drag loop), which is what made moving an existing selection feel laggy.
- **REVERT**: delete `crop-selection.ts`(+test) + `getImageContentRect`, remove the Crop toolbar entry, `handleCropSelect`/`handleApplyCrop`, the bottom-bar button, and `sourceIndex` from the store history

---

### Change 41: In-app self-updater (CLI-driven, package-manager-aware)
- **Files**: `src-tauri/src/updater.rs` (NEW), `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `.github/workflows/release.yml`, `src/lib/updater.ts` (NEW), `src/components/preferences/PreferencesPage.tsx`
- **NOT** Tauri v2's built-in updater plugin. That plugin expects a `latest.json` layout and does the install itself, which fights FrameXShot shipping through Flatpak + deb + rpm + Arch + DMG + a `curl | sh` installer simultaneously.
- **BEFORE**: New releases only reached users by manually re-running `install.sh` or noticing a GitHub notification.
- **AFTER**:
  - **Install-method detection gates everything.** `detect_install_method()` returns `Portable` / `Flatpak` / `SystemPackage` / `Homebrew` (ordered most-specific first: a Flatpak build could match the Homebrew path check by accident). **Only `Portable` may self-update.** Self-updating over a package-managed install produces a split-brain state — the running app diverges from what the manager tracks, and the next `flatpak update` silently overwrites it. For those, the About card shows the exact command instead of a download button (`flatpak update com.framexshot.app`, etc.).
  - **SHA-256 verified before install.** `verify_checksum` fails on a *missing* checksum entry, not just a mismatch — an artifact the release never checksummed is not one to install.
  - **Checksums fetched before the artifact** (they're ~1KB) so an unchecksummed release fails in seconds rather than after a 100MB download. Artifact streamed to disk, never buffered in memory.
  - **Install hands off to `install.sh`** with `FXS_VERSION` pinned — it already knows the per-OS mechanics (DMG mount + `xattr -cr` for Gatekeeper on macOS). Deliberately not reimplemented.
  - **Windows returns an explicit "not supported"** rather than offering a download that 404s (there is no `install.sh` path for it).
  - `relaunch_app` uses Tauri core's `AppHandle::restart` — no `tauri-plugin-process` dependency.
  - **release.yml**: each build job hashes its own bundle output (`sha256sum -b`, run where the files already are rather than re-downloading hundreds of MB through the API) and uploads a fragment; `publish` merges them and attaches `checksums.txt` to the draft release **before** publishing it.
- **Bug caught by test**: `is_newer` originally split on every non-digit, which folded `1.3.0-beta.1` into `[1,3,0,1]` — comparing as NEWER than stable `1.3.0`, so a beta tag would push itself to users already on the release. The pre-release marker is now stripped from the numeric core and compared as a rank: stable beats its own pre-release, pre-release never replaces a release. Regression-guarded by 4 tests.
- **New deps**: `reqwest` (`default-features = false` + `rustls` — native-tls would add a `libssl-dev` build dep the Flatpak manifest and Arch package don't carry) and `sha2`. Note `reqwest` was already in `Cargo.lock` transitively but built with **no TLS backend at all**, so HTTPS required adding one.
- **Not covered**: real signing (minisign/GPG). SHA-256 over HTTPS catches corruption and truncation, not a compromised release account — which is also why the release pipeline already has a `GPG_PRIVATE_KEY` secret wired up for the Arch package, if this is ever worth escalating.
- **REVERT**: delete `updater.rs`, the 4 commands, `lib/updater.ts`, the About card section, and the 2 checksum steps in `release.yml`; drop the reqwest/sha2 deps

---

## CSS Variable Reference (shadcn oklch)

| Tailwind Class    | Light (`:root`) | Dark (`.dark`) | Usage |
|-------------------|-----------------|----------------|-------|
| `bg-background` / `bg-canvas` | `oklch(1 0 0)` white | `oklch(0.145)` near-black | App bg |
| `bg-card`         | `oklch(1 0 0)` white | `oklch(0.205)` `~#2a` | Cards, sidebar |
| `bg-popover`      | `oklch(1 0 0)` | `oklch(0.205)` | Popovers, toolbars |
| `bg-secondary`    | `oklch(0.97)` `#f4f4f5` | `oklch(0.269)` `#3a` | Muted pills, tracks |
| `bg-primary`      | `oklch(0.205)` dark | `oklch(0.922)` light | Primary CTA (flips) |
| `bg-accent`       | `oklch(0.97)` | `oklch(0.269)` | Hovers |
| `text-foreground` | `oklch(0.145)` dark | `oklch(0.985)` light | Ink |
| `text-muted-foreground` | `oklch(0.556)` gray | `oklch(0.708)` | Muted |
| `border-border`   | `oklch(0.922)` `#e4e4e7` | `oklch(1 0 0 /10%)` | Hairline |
| `ring-ring`       | `oklch(0.708)` | `oklch(0.556)` | Focus ring |
| `bg-destructive`  | `oklch(0.577)` | `oklch(0.704)` | Red |
| `bg-sidebar`      | `oklch(0.985)` | `oklch(0.205)` | Sidebar |

## Build Commands

```sh
npm run dev           # Vite dev server on port 1420
npm run build         # tsc --noEmit + vite build (frontend only, ~5s)
npm run lint:ci       # tsc --noEmit (typecheck only, ~5s)
npm run tauri dev     # Full Tauri dev (Rust + frontend HMR)
npm run tauri build   # Release build (Rust + frontend)
npm test              # vitest run
npm run test:rust     # cargo test in src-tauri
```

## Key Patterns

- **Refs for stale closures**: `handleCaptureRef`, `settingsRef`, `lastCaptureTimeRef` are updated via `useEffect` and used inside `listen()` callbacks to avoid re-registering event listeners when state changes.
- **Ref-based drag**: AnnotationCanvas stores drag coordinates in mutable refs. Zustand is only updated on `mouseup`. Canvas redraws itself via imperatively held canvas ref — no React re-renders.
- **200ms idle commit**: Slider changes are committed to the preview render only 200ms after the user stops dragging. Drag events update a "pending" value that is skipped by the render loop.
- **Granular Zustand selectors**: Each settings property (`blurAmount`, `paddingTop`, etc.) has its own selector exported from `stores/index.ts`. Components subscribe to only what they need.
- **Keep-mounted lazy loading**: Heavy pages (ImageEditor, Preferences, Onboarding) use `React.lazy()` + `Suspense` but are always present in the DOM tree. Inactive pages get `display: none` via `hidden` class. This avoids re-mount cost.
- **Tray lifecycle**: Close button `hide()`s to tray (doesn't quit). Tray menu items `show_main_window()` → `app.emit()` → frontend handles the event. Quit from tray exits.
- **Launch at login**: opt-in via Settings → General. `--hidden` is baked into the autostart registration at plugin init and cannot be rewritten, so whether it hides the window is a separate flag in `<app_config_dir>/autostart.json`, read in `setup()` before the window is built.
- **Window management**: 3 windows all with `decorations(false)`. Main window created in setup (hidden), shown on demand. Quick-overlay is a small floating window spawned for notifications.

## Known Issues

1. **Rust changes need full Tauri build**: `npm run build` only compiles frontend. Rust changes (decorations, tray) need `npm run tauri build` (or `cargo tauri build`). This takes minutes.
2. **Wayland event reliability**: On some Wayland compositors, hidden WebViews may not process IPC events. The tray capture fix (showing window first) mitigates this but doesn't guarantee it on all compositors.
3. **Sidebar contain:content**: `contain:content` on the editor sidebar prevents layout recalcs but may break sticky or absolute-positioned children inside it.
4. **Editor state persistence**: Because `imagePath` was removed from the init `useEffect` dependencies, the editor retains its previous state when a new capture is opened. Settings like background type, blur amount, and annotations persist. This is intentional but may surprise users expecting a fresh start each time.
5. **No AppImage on purpose**: The CI no longer builds an AppImage (`src-tauri/tauri.conf.json` `bundle.targets` is `["deb", "rpm", "dmg", "nsis"]`). AppImage's FUSE namespace breaks WebKitGTK's display init on COSMIC and other Wayland compositors — the WebKit WebProcess spins in an init retry loop (the user-visible 38% CPU) and the main window paints blank. `pnpm tauri dev` doesn't repro because it never enters the FUSE namespace. Symptom pattern "dev works, AppImage is blank" on a Wayland compositor is almost always this. We don't ship the broken artifact; the .deb / .rpm / native Arch `.pkg.tar.zst` paths don't hit FUSE. The AUR is not used (new account registrations are closed upstream) and there is no `packaging/aur/PKGBUILD` upload step — only the native Arch job in `release.yml` ships. If a user really wants an AppImage locally, they can run `cargo tauri build --bundles appimage` but it's not officially supported. The `lib.rs` env-var forcing block (`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `GDK_BACKEND=x11`, `LIBGL_ALWAYS_SOFTWARE=1`) is opt-in via `FXS_FORCE_SOFTWARE_GL=1` so it doesn't make things worse on machines where Wayland already works.
