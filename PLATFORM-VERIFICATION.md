# FrameXShot — Cross-Platform Verification Report

Date: 2026-09-18
Branch: `windows-support` (working tree only — **nothing committed**)
Scope: whether the app works on Windows, macOS and Linux.

> **This file replaces an earlier report dated 2026-09-17.** That version claimed
> "Windows — PASS, region capture code-complete". It was wrong: the region flow
> never made the selector overlay visible, so the app's primary feature did
> nothing on Windows *or* macOS. See §3. Treat the previous verdicts as void.

---

## 1. Method, and an honest statement of limits

Only the `x86_64-pc-windows-msvc` Rust target is installed on this machine, and
there is no macOS SDK or Linux sysroot. Therefore:

- ❌ Could **not compile** the Linux or macOS builds.
- ❌ Could **not run** the app on any platform. No GUI runtime testing at all.

What was done instead:

1. `cargo check --all-targets` on Windows MSVC.
2. `npx tsc --noEmit` and `npx vitest run`.
3. Full `cfg`-gate audit — every platform gate traced per platform.
4. **Verification against vendored dependency source**, not against docs or
   memory. Claims about window behaviour below cite `tao-0.35.3` directly; that
   is how the §3 blocker was found and how the DPI handling in §4 was derived.
5. Frontend/backend contract check on the region, OCR and fullscreen flows.

**So: static analysis plus a Windows compile. Runtime behaviour on all three
platforms remains unverified.**

### Evidence

```
$ cargo check --all-targets     → Finished, 0 errors, 0 warnings
$ cargo tree -f "{p} {f}" -p xcap --depth 0
                                → xcap v0.8.3 wgc      (WGC feature active)
$ npx tsc --noEmit              → exit 0
$ npx vitest run                → 19/19 passed
```

---

## 2. Verdict summary

| Feature | Windows | macOS | Linux |
|---|---|---|---|
| Region capture | ✅ fixed (was broken) | ✅ fixed (was broken) | ✅ unchanged |
| Fullscreen capture | ✅ | ✅ | ✅ unchanged |
| Window capture | ✅ via WGC | ✅ needs Screen Recording | ✅ unchanged |
| OCR region | ✅ needs Tesseract | ✅ needs Tesseract | ✅ |
| Clipboard | ✅ | ✅ | ✅ unchanged |
| Folder picker | ✅ | ✅ | ✅ unchanged |
| Shutter sound | ✅ | ✅ | ✅ unchanged |
| Cursor position | ✅ | ✅ fixed (was `(0,0)`) | ✅ unchanged |
| Multi-monitor region | ✅ fixed | ✅ fixed | ✅ unchanged |
| Editor / effects / annotations | ✅ | ✅ | ✅ |
| Signed installer | ⚠️ unsigned | ⚠️ needs Apple secrets | n/a |
| **Compile-verified here?** | **yes** | **shared `not(linux)` arm only** | **no** |
| **Runtime-tested here?** | **no** | **no** | **no** |

---

## 3. The blocker that the previous report missed

Region capture — the default action, bound to `Ctrl/Cmd+Shift+2` — did nothing
on Windows and macOS. The screen was captured into memory and no overlay ever
appeared; the UI then sat in its capturing state forever, waiting on a
`region-selected` event that could not be emitted.

The `region-selector` window is pre-created hidden (`.visible(false)`). Neither
the backend nor the frontend ever called `show()` on it:

- `native_capture_interactive`'s `not(linux)` arm stashed the image and returned
  `"ok"`.
- `App.tsx` then called only `setFullscreen(true)` and `setFocus()`.

`setFocus()` cannot substitute for `show()`. From the vendored tao source:

| File | Guard |
|---|---|
| `tao-0.35.3/src/platform_impl/windows/window.rs:179-185` | `if is_visible && !is_minimized && !is_foreground` |
| `tao-0.35.3/src/platform_impl/macos/window.rs:679-684` | `if !is_minimized && is_visible` |

Both bail out on a hidden window. `set_fullscreen` does not make a window
visible either.

The tell that this was an oversight rather than a design: the sibling command
`native_capture_ocr_region` *did* call `show()`. OCR-region worked; plain region
did not.

**Fixed** — placement and showing now live in `overlay::place_and_show_selector`,
called by both commands.

---

## 4. What changed

### Region overlay — replaces `fullscreen(true)`

New module `src-tauri/src/overlay.rs`. The overlay is now a borderless
always-on-top window moved and sized to cover exactly one monitor: the monitor
under the cursor, which is also the monitor that gets captured.

This fixes three things at once:

1. **The blocker** (§3) — it calls `show()`.
2. **macOS native fullscreen.** `fullscreen(true)` on macOS moves the window into
   its own Space behind a ~1s animation, and a transparent borderless window
   pushed into a Space renders against a black backdrop.
3. **Multi-monitor mismatch.** The backend used to capture the *primary* monitor
   while the overlay covered whichever display it happened to sit on. On a
   two-monitor setup the user was shown the primary monitor's pixels stretched
   over a secondary monitor, and every coordinate was wrong. One cursor read now
   feeds both `xcap::Monitor::from_point` and `WebviewWindow::monitor_from_point`.

**Mixed-DPI handling.** Position/size units are not interchangeable between
platforms, and passing the wrong one silently misplaces the overlay whenever it
moves between displays of different DPI. tao converts whatever it is given using
the scale factor of the monitor the window is *currently* on:

| Platform | tao `set_outer_position` | Correct unit to pass |
|---|---|---|
| Windows | `position.to_physical(self.scale_factor())` | `Physical` (pass-through) |
| macOS | `position.to_logical(self.scale_factor())` | `Logical` (pass-through) |

`overlay.rs` `cfg`-splits on exactly this, so the stale scale factor never
applies. On macOS the logical value is recovered by dividing Tauri's physical
monitor position by that monitor's own scale factor — tao builds it as
`PhysicalPosition::from_logical(CGDisplayBounds.origin, scale)`.

The window is also created `.shadow(false)`. tao applies a hidden-offset size
correction to undecorated windows **that have shadows**
(`window_state.rs:466` — `undecorated_with_shadows()`), which would have left the
overlay a few pixels off the monitor bounds and skewed every selection.

### macOS Screen Recording permission

New `src-tauri/src/mac_api.rs` — a four-symbol CoreGraphics FFI shim.

Every capture entry point gates on `ensure_capture_permission()`. This matters
because the failure is otherwise **silent**: without permission
`CGWindowListCreateImage` does not error, it returns desktop wallpaper with no
windows on it, which is indistinguishable from a successful capture of an empty
desktop.

The frontend preflights `check_screen_capture_permission` *before* hiding the
main window (there is nowhere to render an error once it is hidden) and offers an
**Open Settings** button that deep-links to the Screen Recording pane.

All user-facing copy says "restart the app", because
`CGPreflightScreenCaptureAccess` caches its answer for the process lifetime —
granting permission genuinely does not take effect until relaunch.

`bundle.macOS.minimumSystemVersion` is now `10.15`, matching the availability of
the two permission symbols, which are linked non-weakly.

### macOS cursor position

`get_mouse_position` returned a hardcoded `(0,0)` on macOS, which silently pinned
the quick overlay to the first monitor. It now reads the real cursor via
`CGEventGetLocation`.

### Windows black window captures

`xcap` on Windows now builds with the **`wgc`** feature — Windows.Graphics.Capture
instead of the GDI screen-DC blit. The GDI path cannot read hardware-overlay /
flip-model surfaces, so GPU-composited windows (browsers, Electron apps, video
players, games) captured as solid black.

Cost: WGC needs Windows 10 1903+; on Windows 10 the OS draws a yellow border
around the surface while capturing.

### macOS signing and notarization

`.github/workflows/release.yml` now passes the six `APPLE_*` secrets to
`tauri-action`, and `tauri.conf.json` enables the hardened runtime with a new
`src-tauri/entitlements.plist`.

The entitlements are load-bearing, not boilerplate: the hardened runtime blocks
JIT, and a notarized Tauri app without `com.apple.security.cs.allow-jit` launches
to a blank window because the WebKit subprocess dies immediately.

All six values come from `secrets.*`, so with the secrets unset they expand to
empty strings, signing is skipped, and the build behaves exactly as before.
Linux and Windows jobs are untouched.

### Tesseract

`ocr.rs` now exposes `tesseract_command()` and `is_available()`, and a
`check_ocr_available` command preflights the OCR action with a per-platform
install hint.

---

## 5. Linux — unchanged

Every edit is inside a `cfg(not(target_os = "linux"))` arm or is
platform-neutral frontend code. The shell-out chain (grim / slurp / spectacle /
cosmic-screenshot / scrot / maim / hyprshot / grimblast), the zenity/kdialog
folder picker, the paplay/aplay sound, the xdotool cursor and the
xclip/xsel/wl-copy clipboard are all untouched, as `CONTRIBUTING.md` requires.

`ocr.rs` is shared, and its refactor is behaviour-preserving on Linux: the same
bare `tesseract` command, the same arguments, the same install hint text.

**Not verified:** the Linux build does not compile-check here.

---

## 6. Known limitations that remain

| Limitation | Platform | Why not fixed |
|---|---|---|
| Menu bar / Dock draw over the region overlay | macOS | Tauri's always-on-top is `NSFloatingWindowLevel` (3), below `NSMainMenuWindowLevel` (24). A higher level is not reachable through Tauri's public API. Coordinates are unaffected. |
| Region cannot span two monitors | Windows, macOS | One overlay covers one monitor. Any single display works; a cross-monitor drag does not. Fullscreen capture does cover the whole virtual desktop. |
| Tesseract not bundled | Windows, macOS | Vendoring the binary plus `tessdata` adds ~15 MB of third-party payload to every download for a secondary feature. Detected and explained at runtime instead. |
| Installers unsigned | Windows, macOS | Requires paid certificates. macOS is wired up and activates when the secrets are set; Windows Authenticode is not wired up. |
| Yellow capture border | Windows 10 only | Imposed by the OS on WGC captures. Windows 11 suppresses it. |

---

## 7. Bottom line

- **Windows** — the blocker is fixed, multi-monitor region works, window capture
  no longer returns black. Compile-verified. **Runtime untested.**
- **macOS** — the blocker is fixed, the overlay no longer uses native fullscreen,
  Screen Recording is handled, the cursor is real, and signing is wired up. The
  shared `not(linux)` arm is compile-verified *as Windows code*; the
  `cfg(target_os = "macos")` arms — including all of `mac_api.rs` — have **never
  been compiled anywhere**. **macOS has never been built or run.**
- **Linux** — unchanged and still the best-supported platform. Not compiled here.

**Recommendation.** Before calling macOS supported, build it on a real Mac. In
particular `mac_api.rs` is new hand-written FFI that no compiler has yet seen,
and the overlay's logical-coordinate placement has not been exercised on a real
mixed-DPI display arrangement.
