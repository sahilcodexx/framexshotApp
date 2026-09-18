//! Windows **and macOS** capture backend (xcap).
//!
//! The Linux chain in `capture.rs` shells out to grim / slurp / spectacle /
//! cosmic-screenshot / scrot / maim / hyprshot / grimblast and talks to
//! xdg-desktop-portal + GNOME Shell over D-Bus. None of those exist on
//! Windows or macOS, so on those targets every capture goes through `xcap`
//! instead. Only Linux uses the shell-out chain.
//!
//! On Windows `xcap` is built with the `wgc` feature, so capture goes through
//! Windows.Graphics.Capture instead of the GDI screen-DC blit — see the comment
//! on the Windows dependency in `Cargo.toml` for why. The macOS backend uses
//! CoreGraphics (`CGWindowListCreateImage`), which requires Screen Recording
//! permission; every entry point here gates on `ensure_capture_permission`.
//!
//! Note that `capture_image()` returns an `image::RgbaImage` (not a
//! `DynamicImage`) — the same `image` crate version the rest of the app uses,
//! so the values can be written straight to disk or blitted onto one another.
#![cfg(not(target_os = "linux"))]

use std::path::Path;

use image::{imageops, RgbaImage};

/// Capture every monitor and stitch them into one virtual-desktop image.
///
/// Monitor origins can be negative when a secondary display sits left of or
/// above the primary one, so the canvas is offset by the minimum origin across
/// all monitors and each screen is blitted at `(x - min_x, y - min_y)`.
///
/// This mirrors the Linux behaviour, where `grim <path>` without `-o`
/// composites every output into a single image.
pub fn capture_fullscreen(path: &Path) -> Result<(), String> {
    ensure_capture_permission()?;

    let monitors =
        xcap::Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitors available".to_string());
    }

    // Gather geometry first (monitor index, x, y, width, height). Monitors that
    // report unusable geometry are skipped so one bad display can't fail the
    // whole capture.
    let mut placements: Vec<(usize, i32, i32, u32, u32)> = Vec::with_capacity(monitors.len());
    for (index, monitor) in monitors.iter().enumerate() {
        let (x, y, width, height) =
            match (monitor.x(), monitor.y(), monitor.width(), monitor.height()) {
                (Ok(x), Ok(y), Ok(width), Ok(height)) => (x, y, width, height),
                _ => continue,
            };
        if width == 0 || height == 0 {
            continue;
        }
        placements.push((index, x, y, width, height));
    }
    if placements.is_empty() {
        return Err("No monitor reported usable geometry".to_string());
    }

    let min_x = placements.iter().map(|p| p.1).min().unwrap_or(0);
    let min_y = placements.iter().map(|p| p.2).min().unwrap_or(0);
    let max_x = placements
        .iter()
        .map(|p| p.1.saturating_add(p.3 as i32))
        .max()
        .unwrap_or(0);
    let max_y = placements
        .iter()
        .map(|p| p.2.saturating_add(p.4 as i32))
        .max()
        .unwrap_or(0);

    let total_width = u32::try_from(max_x - min_x).unwrap_or(0);
    let total_height = u32::try_from(max_y - min_y).unwrap_or(0);
    if total_width == 0 || total_height == 0 {
        return Err("Virtual desktop has zero area".to_string());
    }

    let mut canvas = RgbaImage::new(total_width, total_height);
    let mut captured = 0usize;
    for (index, x, y, _width, _height) in &placements {
        let image = match monitors[*index].capture_image() {
            Ok(image) => image,
            // Skip displays that fail to capture — as long as at least one
            // succeeds we still return a usable image.
            Err(_) => continue,
        };
        imageops::replace(
            &mut canvas,
            &image,
            (*x - min_x) as i64,
            (*y - min_y) as i64,
        );
        captured += 1;
    }

    if captured == 0 {
        return Err("Failed to capture any monitor".to_string());
    }

    canvas
        .save(path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))
}

/// Capture the focused window.
///
/// Windows belonging to our own process are excluded, as are minimised windows
/// and windows with degenerate geometry.
pub fn capture_window(path: &Path) -> Result<(), String> {
    ensure_capture_permission()?;

    let own_pid = std::process::id();
    let windows = xcap::Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let mut candidates = Vec::new();
    for window in windows {
        // Never target our own windows (the app is hidden while capturing, but
        // the tray and pre-created overlay windows can still be listed).
        // `unwrap_or(true)` drops windows whose pid can't be read.
        if window.pid().map(|pid| pid == own_pid).unwrap_or(true) {
            continue;
        }
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        if window.width().unwrap_or(0) == 0 || window.height().unwrap_or(0) == 0 {
            continue;
        }
        candidates.push(window);
    }

    let focused = candidates
        .into_iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .ok_or_else(|| "No focused window found to capture".to_string())?;

    // Windows builds enable xcap's `wgc` feature (see Cargo.toml), so this goes
    // through Windows.Graphics.Capture rather than the GDI screen-DC blit. The
    // GDI path returned an all-black image for GPU-composited windows —
    // browsers, Electron apps, video players, games — because it cannot read
    // hardware-overlay / flip-model surfaces. WGC reads the composition surface.
    let image = focused
        .capture_image()
        .map_err(|e| format!("Failed to capture window: {}", e))?;

    image
        .save(path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))
}

/// Interactive region capture.
///
/// On Windows and macOS the region flow is driven entirely by the
/// region-selector overlay in the frontend: the backend captures the primary
/// monitor, stashes it as a pending screenshot, and the overlay reports the
/// selected rectangle back. Reaching this function means something bypassed
/// that flow, so it fails loudly instead of silently doing the wrong thing.
pub fn capture_region(_path: &Path) -> Result<(), String> {
    Err(
        "Interactive region capture on Windows and macOS is handled by the \
         region-selector overlay, not by a shell tool."
            .to_string(),
    )
}

/// Capture just the primary monitor.
///
/// Exactly one monitor must be captured (not the stitched virtual desktop),
/// because `RegionSelector.tsx` maps the selection with
/// `naturalWidth / window.innerWidth` against an overlay covering one monitor.
/// A multi-monitor image would be squashed onto a single monitor and break
/// every coordinate.
pub fn capture_primary_monitor(path: &Path) -> Result<(), String> {
    capture_monitor_at_point(None, path)
}

/// Capture the single monitor containing `point`, falling back to the primary
/// monitor when no point is given or the point is off every display.
///
/// `point` is in the same global screen space `overlay::cursor_position()`
/// returns, and the caller passes that same point to
/// `overlay::place_and_show_selector`. Capturing and covering the *same*
/// monitor is what makes region selection correct on multi-monitor setups —
/// previously the primary monitor was always captured while the overlay landed
/// on whichever display it happened to be on.
pub fn capture_monitor_at_point(point: Option<(f64, f64)>, path: &Path) -> Result<(), String> {
    ensure_capture_permission()?;

    // `from_point` errors when the point is outside every monitor (e.g. the
    // cursor read failed, or a display was unplugged between the two calls), so
    // fall through to the primary monitor rather than failing the capture.
    let target = point.and_then(|(x, y)| xcap::Monitor::from_point(x as i32, y as i32).ok());

    let image = match target {
        Some(monitor) => monitor
            .capture_image()
            .map_err(|e| format!("Failed to capture monitor: {}", e))?,
        None => {
            let monitors =
                xcap::Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {}", e))?;
            let primary = monitors
                .iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .or_else(|| monitors.first())
                .ok_or_else(|| "No monitors available".to_string())?;
            primary
                .capture_image()
                .map_err(|e| format!("Failed to capture primary monitor: {}", e))?
        }
    };

    image
        .save(path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))
}

/// Gate every capture on macOS Screen Recording permission.
///
/// Without it `CGWindowListCreateImage` does not fail — it succeeds and returns
/// desktop wallpaper with no windows on it, which is indistinguishable from a
/// working capture of an empty desktop. Checking up front turns that silent
/// wrong result into an actionable message.
///
/// No-op everywhere except macOS.
pub fn ensure_capture_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !crate::mac_api::has_screen_recording_permission() {
            // Only ever shows the system prompt the first time; afterwards it is
            // a silent no-op, which is why the message below also spells out the
            // manual route.
            crate::mac_api::request_screen_recording_permission();

            return Err(crate::mac_api::SCREEN_RECORDING_DENIED_MESSAGE.to_string());
        }
    }
    Ok(())
}
