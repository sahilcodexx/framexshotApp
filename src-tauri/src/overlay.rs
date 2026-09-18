//! Placement of the region-selector overlay on Windows and macOS.
//!
//! ## Why this is not `fullscreen(true)`
//!
//! The overlay used to be a `fullscreen(true)` window. That was wrong on both
//! platforms, for different reasons:
//!
//! - **macOS**: `fullscreen(true)` is *native* fullscreen. The window is moved
//!   into its own Space with a ~1s animation, and a borderless transparent
//!   window pushed into a Space renders against the Space's black backdrop. An
//!   overlay that takes a second to appear and paints black is not an overlay.
//! - **Both**: a fullscreen window covers whichever monitor it already happens
//!   to sit on, which is not necessarily the monitor that was captured. The
//!   backend captured the *primary* monitor, so on a multi-monitor setup the
//!   user was shown the primary monitor's pixels stretched over a secondary
//!   monitor, and every selection coordinate was wrong.
//!
//! Instead the overlay is an ordinary borderless always-on-top window moved and
//! sized to exactly cover one monitor — the monitor under the cursor, which is
//! also the monitor that gets captured. Same monitor for both halves, so the
//! coordinate mapping in `RegionSelector.tsx`
//! (`img.naturalWidth / window.innerWidth`) is correct on any display layout
//! and at any DPI scale.
//!
//! ## Known limitation on macOS
//!
//! `set_always_on_top` maps to `NSFloatingWindowLevel` (3), which sits *below*
//! `NSMainMenuWindowLevel` (24). The menu bar — and the Dock — therefore stay
//! drawn on top of the overlay. The captured image behind it still contains
//! those regions and the coordinate mapping is unaffected, but a drag that
//! starts on the menu bar strip goes to the menu bar rather than the overlay.
//! Raising the window level further is not expressible through Tauri's public
//! API, so this is accepted rather than worked around.
#![cfg(not(target_os = "linux"))]

use tauri::{AppHandle, Manager};

/// Window label of the pre-created selector overlay, as built in `lib.rs`.
pub const SELECTOR_LABEL: &str = "region-selector";

/// Current cursor position in the platform's global screen coordinate space.
///
/// Windows: physical virtual-desktop pixels (`GetCursorPos`).
/// macOS: Quartz global points, top-left origin (`CGEventGetLocation`).
///
/// In both cases this is the same space `monitor_from_point` and `xcap`'s
/// `Monitor::from_point` expect, so the value can be passed to either without
/// conversion.
///
/// `None` means the cursor could not be read; callers fall back to the primary
/// monitor rather than guessing at `(0, 0)`, which is a real coordinate.
pub fn cursor_position() -> Option<(f64, f64)> {
    #[cfg(target_os = "windows")]
    {
        use winapi::shared::windef::POINT;
        use winapi::um::winuser::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut point) } == 0 {
            return None;
        }
        Some((point.x as f64, point.y as f64))
    }

    #[cfg(target_os = "macos")]
    {
        crate::mac_api::cursor_position()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

/// Move the selector overlay to cover the monitor containing `point`, then show
/// and focus it.
///
/// `point` should be the same value that was used to pick the monitor to
/// capture, so that the image and the overlay describe the same screen.
pub fn place_and_show_selector(app: &AppHandle, point: Option<(f64, f64)>) -> Result<(), String> {
    let selector = app
        .get_webview_window(SELECTOR_LABEL)
        .ok_or_else(|| format!("Window '{}' does not exist", SELECTOR_LABEL))?;

    let monitor = point
        .and_then(|(x, y)| selector.monitor_from_point(x, y).ok().flatten())
        .or_else(|| selector.primary_monitor().ok().flatten())
        .ok_or_else(|| "Could not determine which monitor to cover".to_string())?;

    let position = *monitor.position();
    let size = *monitor.size();

    // Defensively clear native fullscreen. The window is no longer *created*
    // fullscreen, but a build that ran the old code path can leave the flag set,
    // and on macOS repositioning a window that is still in its fullscreen Space
    // silently does nothing.
    let _ = selector.set_fullscreen(false);

    // Physical on Windows, logical on macOS — this is not interchangeable.
    //
    // tao converts whatever it is given using the scale factor of the monitor
    // the window is *currently* on, which is the wrong monitor whenever the
    // overlay moves between displays of different DPI:
    //
    //   windows/window.rs  set_outer_position → position.to_physical(self.scale_factor())
    //   macos/window.rs    set_outer_position → position.to_logical(self.scale_factor())
    //
    // Passing the variant that makes that conversion a no-op sidesteps the
    // stale scale factor entirely. On Windows `Monitor::position()` is already
    // physical pixels, so `Physical` passes straight through. On macOS tao
    // builds `Monitor::position()` as `PhysicalPosition::from_logical(origin,
    // that monitor's scale)`, so dividing it back out recovers the original
    // Quartz point origin, and `Logical` then passes straight through.
    #[cfg(target_os = "windows")]
    {
        selector
            .set_position(tauri::PhysicalPosition::new(position.x, position.y))
            .map_err(|e| format!("Failed to position overlay: {}", e))?;
        selector
            .set_size(tauri::PhysicalSize::new(size.width, size.height))
            .map_err(|e| format!("Failed to size overlay: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let scale = monitor.scale_factor();
        if scale <= 0.0 {
            return Err("Monitor reported a non-positive scale factor".to_string());
        }
        selector
            .set_position(tauri::LogicalPosition::new(
                position.x as f64 / scale,
                position.y as f64 / scale,
            ))
            .map_err(|e| format!("Failed to position overlay: {}", e))?;
        selector
            .set_size(tauri::LogicalSize::new(
                size.width as f64 / scale,
                size.height as f64 / scale,
            ))
            .map_err(|e| format!("Failed to size overlay: {}", e))?;

        // Show on the Space the user is currently looking at instead of only
        // the Space the window was created on. Without this the overlay can be
        // "shown" onto a Space that is not on screen, i.e. invisibly.
        let _ = selector.set_visible_on_all_workspaces(true);
    }

    let _ = selector.set_always_on_top(true);

    selector
        .show()
        .map_err(|e| format!("Failed to show overlay: {}", e))?;
    selector
        .set_focus()
        .map_err(|e| format!("Failed to focus overlay: {}", e))?;

    Ok(())
}
