//! Screenshot capture module — Linux implementation
//!
//! Strategy:
//!   Wayland: use `grim` (via xdg-desktop-portal / PipeWire) for all fullscreen captures.
//!            Supports COSMIC, GNOME, KDE, Sway, Hyprland, etc.
//!            xcap uses wlr-screencopy which is NOT supported on COSMIC/GNOME Mutter.
//!   X11:     use xcap for monitor enumeration and capture.

use serde::Serialize;
use std::path::PathBuf;
use xcap::Monitor;

use crate::capture::host_command;
use crate::capture::has_binary;
use crate::utils::{ensure_dir, generate_filename, generate_filename_with_id, AppResult};

/// Check if we're on Wayland
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

#[derive(Serialize, Clone, Debug)]
pub struct MonitorShot {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub path: String,
}

/// Capture screenshots of all available monitors.
/// On Wayland: uses grim (one shot per monitor via -o output name).
/// On X11: uses xcap.
pub fn capture_all_monitors(save_dir: &str) -> AppResult<Vec<MonitorShot>> {
    let save_path = PathBuf::from(save_dir);
    ensure_dir(&save_path)?;

    if is_wayland() {
        return capture_all_monitors_wayland(&save_path);
    }

    // X11 path via xcap
    let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitors available".into());
    }
    let mut shots = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let shot = capture_single_monitor_xcap(&monitor, &save_path)?;
        shots.push(shot);
    }
    Ok(shots)
}

/// Wayland: enumerate outputs with `wlr-randr` or `wayland-info`, then grim -o <output>
/// Falls back to a single grim capture if output enumeration is unavailable.
fn capture_all_monitors_wayland(save_path: &PathBuf) -> AppResult<Vec<MonitorShot>> {
    if !has_binary("grim") {
        return Err("grim not found. Install grim for Wayland screen capture.".into());
    }

    // Try to enumerate Wayland outputs via wlr-randr
    let outputs = get_wayland_outputs();

    if outputs.is_empty() {
        // No output info — capture entire compositor (all monitors merged)
        let filename = generate_filename("monitor", "png")?;
        let path = save_path.join(&filename);
        let path_str = path.to_string_lossy().to_string();

        let status = host_command("grim")
            .arg(&path_str)
            .status()
            .map_err(|e| format!("grim failed: {}", e))?;

        if !status.success() || !path.exists() {
            return Err("grim failed to capture screen".into());
        }

        return Ok(vec![MonitorShot {
            id: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            scale_factor: 1.0,
            path: path_str,
        }]);
    }

    let mut shots = Vec::with_capacity(outputs.len());
    for (i, output_name) in outputs.iter().enumerate() {
        let filename = generate_filename_with_id("monitor", i as u32, "png")?;
        let path = save_path.join(&filename);
        let path_str = path.to_string_lossy().to_string();

        let status = host_command("grim")
            .arg("-o")
            .arg(output_name)
            .arg(&path_str)
            .status()
            .map_err(|e| format!("grim -o {} failed: {}", output_name, e))?;

        if status.success() && path.exists() {
            shots.push(MonitorShot {
                id: i as u32,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                scale_factor: 1.0,
                path: path_str,
            });
        }
    }

    if shots.is_empty() {
        // No per-output capture — fall back to a single fullscreen capture
        // (portal / GNOME Shell handle this on desktops without grim)
        let filename = generate_filename("monitor", "png")?;
        let path = save_path.join(&filename);
        let path_str = path.to_string_lossy().to_string();

        if crate::capture::capture_fullscreen(&path).is_ok() && path.exists() {
            return Ok(vec![MonitorShot {
                id: 0,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                scale_factor: 1.0,
                path: path_str,
            }]);
        }

        return Err("grim failed to capture any monitor output".into());
    }

    Ok(shots)
}

/// Get Wayland output names via wlr-randr, swaymsg, or hyprctl
fn get_wayland_outputs() -> Vec<String> {
    // Try wlr-randr
    if has_binary("wlr-randr") {
        if let Ok(out) = host_command("wlr-randr").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            let names: Vec<String> = text
                .lines()
                .filter(|l| !l.starts_with(' ') && !l.starts_with('\t') && !l.is_empty())
                .map(|l| l.split_whitespace().next().unwrap_or("").to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }

    // Try swaymsg -t get_outputs
    if has_binary("swaymsg") {
        if let Ok(out) = host_command("swaymsg").args(["-t", "get_outputs"]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            // parse "name" fields from JSON
            let names: Vec<String> = text
                .split('{')
                .skip(1)
                .filter_map(|chunk| {
                    chunk
                        .split('"')
                        .enumerate()
                        .find_map(|(i, s)| if s == "name" { Some(i) } else { None })
                        .and_then(|name_idx| {
                            chunk.split('"').nth(name_idx + 2).map(|s| s.to_string())
                        })
                })
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }

    // Try hyprctl monitors
    if has_binary("hyprctl") {
        if let Ok(out) = host_command("hyprctl").args(["monitors", "-j"]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            let names: Vec<String> = text
                .split('"')
                .enumerate()
                .filter_map(|(i, s)| if s == "name" { Some(i) } else { None })
                .filter_map(|name_idx| text.split('"').nth(name_idx + 2).map(|s| s.to_string()))
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }

    Vec::new()
}

/// Capture a single monitor using xcap (X11 only)
fn capture_single_monitor_xcap(monitor: &Monitor, save_path: &PathBuf) -> AppResult<MonitorShot> {
    let monitor_id = monitor
        .id()
        .map_err(|e| format!("Failed to get monitor id: {}", e))?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("Failed to capture monitor {}: {}", monitor_id, e))?;

    let filename = generate_filename_with_id("monitor", monitor_id, "png")?;
    let screenshot_path = save_path.join(&filename);

    image
        .save(&screenshot_path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))?;

    let x = monitor
        .x()
        .map_err(|e| format!("Failed to get monitor x: {}", e))?;
    let y = monitor
        .y()
        .map_err(|e| format!("Failed to get monitor y: {}", e))?;
    let width = monitor
        .width()
        .map_err(|e| format!("Failed to get monitor width: {}", e))?;
    let height = monitor
        .height()
        .map_err(|e| format!("Failed to get monitor height: {}", e))?;
    let scale_factor = monitor
        .scale_factor()
        .map_err(|e| format!("Failed to get scale factor: {}", e))?;

    Ok(MonitorShot {
        id: monitor_id,
        x,
        y,
        width,
        height,
        scale_factor,
        path: screenshot_path.to_string_lossy().into_owned(),
    })
}

/// Capture primary monitor.
/// Uses the cross-desktop fallback chain in capture.rs (cosmic-screenshot,
/// spectacle, grim, GNOME Shell D-Bus, xdg-desktop-portal, gnome-screenshot,
/// scrot) and only falls back to xcap on X11 when no native tool exists.
pub async fn capture_primary_monitor(_app_handle: tauri::AppHandle) -> AppResult<PathBuf> {
    let temp_dir = std::env::temp_dir();
    ensure_dir(&temp_dir)?;
    let filename = generate_filename("screenshot", "png")?;
    let screenshot_path = temp_dir.join(&filename);

    // Native tool chain — works on every desktop (incl. GNOME/KDE Wayland and Flatpak)
    if crate::capture::capture_fullscreen(&screenshot_path).is_ok() {
        return Ok(screenshot_path);
    }

    // X11 fallback via xcap
    if !is_wayland() {
        let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
        if monitors.is_empty() {
            return Err("No monitors available".into());
        }
        let primary = monitors
            .iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| monitors.first())
            .ok_or("No monitor found")?;

        let image = primary
            .capture_image()
            .map_err(|e| format!("Failed to capture primary monitor: {}", e))?;

        image
            .save(&screenshot_path)
            .map_err(|e| format!("Failed to save screenshot: {}", e))?;

        return Ok(screenshot_path);
    }

    Err("No supported screen capture method found on this desktop. Install grim, spectacle, cosmic-screenshot, or scrot.".into())
}
