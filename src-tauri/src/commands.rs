use std::path::PathBuf;
// `Command`/`Stdio` are needed by the Linux arms (zenity/kdialog/python3,
// paplay/aplay, xdotool) and by the macOS `afplay` shutter sound. Windows uses
// no shell-outs (MessageBeep / GetCursorPos / tauri-plugin-dialog), so it is
// the only target that does not need them.
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::capture::{capture_fullscreen, capture_window};
#[cfg(target_os = "linux")]
use crate::capture::{capture_region as capture_region_tool, has_binary};
use crate::clipboard::{copy_image_to_clipboard, copy_text_to_clipboard};
use crate::image::{
    copy_screenshot_to_dir, crop_image, render_image_with_effects, save_base64_image, CropRegion,
    RenderSettings,
};
use crate::ocr::recognize_text_from_image;
#[cfg(not(target_os = "linux"))]
use crate::screenshot::capture_monitor_at_point;
use crate::screenshot::{
    capture_all_monitors as capture_monitors, capture_primary_monitor, MonitorShot,
};
use crate::utils::{file_to_data_uri, generate_filename, get_desktop_path};

static PENDING_SCREENSHOT_B64: Mutex<Option<String>> = Mutex::new(None);

static SCREENCAPTURE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

#[tauri::command]
pub async fn move_window_to_active_space(_app_handle: AppHandle) -> Result<(), String> {
    // No-op on Linux — spaces/virtual desktops are managed by the compositor
    Ok(())
}

#[tauri::command]
pub async fn copy_image_file_to_clipboard(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_image_to_clipboard(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn capture_once(
    app_handle: AppHandle,
    save_dir: String,
    copy_to_clip: bool,
) -> Result<String, String> {
    let screenshot_path = capture_primary_monitor(app_handle).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let screenshot_path_str = screenshot_path.to_string_lossy().to_string();
        let saved_path = copy_screenshot_to_dir(&screenshot_path_str, &save_dir)?;
        if copy_to_clip {
            copy_image_to_clipboard(&saved_path)?;
        }
        Ok(saved_path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn capture_all_monitors(
    _app_handle: AppHandle,
    save_dir: String,
) -> Result<Vec<MonitorShot>, String> {
    tauri::async_runtime::spawn_blocking(move || capture_monitors(&save_dir))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn capture_region(
    screenshot_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    save_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let region = CropRegion {
            x,
            y,
            width,
            height,
        };
        crop_image(&screenshot_path, region, &save_dir)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn render_image_with_effects_rust(
    image_path: String,
    settings: RenderSettings,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render_image_with_effects(&image_path, settings))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Save an edited image from base64 data
#[tauri::command]
pub async fn save_edited_image(
    image_data: String,
    save_dir: String,
    copy_to_clip: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved_path = save_base64_image(&image_data, &save_dir, "framexshot")?;
        if copy_to_clip {
            copy_image_to_clipboard(&saved_path)?;
        }
        Ok(saved_path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get the user's Desktop directory path
#[tauri::command]
pub async fn get_desktop_directory() -> Result<String, String> {
    get_desktop_path()
}

/// Get the directory FrameXShot writes temporary captures into.
///
/// This is an app-owned subdirectory of the system temp directory, not the
/// system temp directory itself — see `utils::app_temp_dir` for why.
#[tauri::command]
pub async fn get_temp_directory() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // NOTE: cleanup is intentionally NOT run here. It used to be, on every
        // invocation, which deleted screenshot_*.png files that were currently
        // open in the editor and produced 404 "Could not load image" errors.
        // Cleanup now only happens via the explicit `cleanup_old_screenshots`
        // command, and even then only for files past a minimum age.
        let temp_dir = crate::utils::app_temp_dir()?;
        // Do NOT canonicalize — canonicalize() on macOS turns /tmp → /private/tmp,
        // which then doesn't match the /tmp/** asset scope and causes 404s in the editor.
        // Return the path as-is so it matches what's in tauri.conf.json scope.
        temp_dir
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Failed to convert temp directory path to string".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// How old a temp file must be before cleanup will delete it.
///
/// Guards against removing a capture the editor still has open: a capture from
/// the current session is minutes old at most, and anything genuinely stale is
/// left over from a previous run.
const TEMP_FILE_MIN_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Delete stale FrameXShot temp captures from previous sessions.
///
/// Scoped to the app's own temp subdirectory, so it cannot touch files written
/// by anything else. Called explicitly at safe points, not on every startup.
#[tauri::command]
pub async fn cleanup_old_screenshots() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::utils::cleanup_temp_files(TEMP_FILE_MIN_AGE).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Capture screenshot with interactive region selection.
///
/// Linux: dispatches to the cross-desktop fallback chain in capture.rs
/// (COSMIC → KDE spectacle → grim+slurp (wlroots) → GNOME Shell D-Bus →
/// gnome-screenshot → maim/scrot) and returns the captured file path.
///
/// Windows/macOS: the interactive flow lives in the frontend region-selector
/// overlay. The backend captures the monitor under the cursor, stashes it as the
/// pending screenshot, moves the overlay to cover that same monitor and shows it,
/// then returns the literal `"ok"`.
#[tauri::command]
pub async fn native_capture_interactive(
    app_handle: AppHandle,
    save_dir: String,
) -> Result<String, String> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = &save_dir;

        // Read the cursor ONCE and use it for both halves: it picks the monitor
        // to capture and the monitor to cover. Reading it twice could straddle a
        // cursor move and put the overlay on a different display than the image.
        let point = crate::overlay::cursor_position();

        let screenshot_path = capture_monitor_at_point(point).await?;
        let path_str = screenshot_path.to_string_lossy().into_owned();

        let data_uri = tauri::async_runtime::spawn_blocking(move || {
            let data_uri = file_to_data_uri(&path_str)?;
            let _ = std::fs::remove_file(&path_str);
            Ok::<String, String>(data_uri)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

        // Stash BEFORE showing: `RegionSelector` calls `capture_screen_for_selector`
        // from its `onFocusChanged` / `visibilitychange` handlers, which fire as a
        // result of the show below. The pending image must already be there.
        {
            let mut lock = PENDING_SCREENSHOT_B64
                .lock()
                .map_err(|e| format!("Mutex: {}", e))?;
            *lock = Some(data_uri);
        }

        // The selector window is pre-created hidden (`visible(false)`) at startup,
        // so it MUST be shown here. `set_focus()` alone cannot do it: tao bails out
        // early on a window whose VISIBLE flag is unset, on both Windows
        // (`platform_impl/windows/window.rs` — `if is_visible && !is_minimized`) and
        // macOS (`platform_impl/macos/window.rs` — `if !is_minimized && is_visible`).
        // Without this the overlay never appears and the region flow dead-ends.
        crate::overlay::place_and_show_selector(&app_handle, point)?;

        return Ok("ok".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let _ = &app_handle;
        tauri::async_runtime::spawn_blocking(move || {
            let _lock = SCREENCAPTURE_LOCK
                .lock()
                .map_err(|e| format!("Failed to acquire lock: {}", e))?;

            let filename = generate_filename("screenshot", "png")?;
            let screenshot_path = std::path::PathBuf::from(&save_dir).join(&filename);

            capture_region_tool(&screenshot_path)?;
            Ok(screenshot_path.to_string_lossy().into_owned())
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
}

/// Capture full screen
/// Dispatches to the cross-desktop fallback chain in capture.rs:
/// cosmic-screenshot → spectacle → grim → GNOME Shell → xdg-desktop-portal → gnome-screenshot → scrot
#[tauri::command]
pub async fn native_capture_fullscreen(save_dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = SCREENCAPTURE_LOCK
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        let filename = generate_filename("screenshot", "png")?;
        let screenshot_path = std::path::PathBuf::from(&save_dir).join(&filename);

        capture_fullscreen(&screenshot_path)?;
        Ok(screenshot_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Capture a specific window
#[tauri::command]
pub async fn native_capture_window(save_dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = SCREENCAPTURE_LOCK
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        let filename = generate_filename("screenshot", "png")?;
        let screenshot_path = std::path::PathBuf::from(&save_dir).join(&filename);

        #[cfg(not(target_os = "linux"))]
        {
            // `capture_window` and `capture_fullscreen` dispatch to the xcap
            // implementations in `xcap_capture` on Windows and macOS.
            if capture_window(&screenshot_path).is_ok() {
                return Ok(screenshot_path.to_string_lossy().into_owned());
            }

            // There is no interactive region tool on Windows/macOS, so fall
            // back to a stitched full-desktop capture rather than the region
            // tool.
            capture_fullscreen(&screenshot_path)?;
            return Ok(screenshot_path.to_string_lossy().into_owned());
        }

        #[cfg(target_os = "linux")]
        {
            if capture_window(&screenshot_path).is_ok() {
                return Ok(screenshot_path.to_string_lossy().into_owned());
            }

            // Fall back to interactive region selection
            capture_region_tool(&screenshot_path)?;
            Ok(screenshot_path.to_string_lossy().into_owned())
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Play the platform screenshot sound.
/// Windows: `MessageBeep` (system sound).
/// macOS: `afplay` on a system sound.
/// Linux: paplay / aplay.
#[tauri::command]
pub async fn play_screenshot_sound() -> Result<(), String> {
    std::thread::spawn(|| {
        #[cfg(target_os = "windows")]
        {
            use winapi::um::winuser::{MessageBeep, MB_ICONASTERISK};
            // Fire-and-forget: MessageBeep returns as soon as the sound is
            // queued, and we don't care whether the user has sound muted.
            unsafe {
                MessageBeep(MB_ICONASTERISK);
            }
        }

        #[cfg(target_os = "macos")]
        {
            // Fire-and-forget: ignore all errors. Both sounds ship with macOS;
            // Glass is preferred, Ping is the fallback if it is missing.
            let sound_path = if std::path::Path::new("/System/Library/Sounds/Glass.aiff").exists() {
                "/System/Library/Sounds/Glass.aiff"
            } else {
                "/System/Library/Sounds/Ping.aiff"
            };
            let _ = Command::new("afplay")
                .arg(sound_path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        #[cfg(target_os = "linux")]
        {
            let sound_paths = [
                "/usr/share/sounds/freedesktop/stereo/screen-capture.oga",
                "/usr/share/sounds/gnome/default/alerts/glass.ogg",
                "/usr/share/sounds/ubuntu/stereo/screen-capture.ogg",
            ];

            for sound_path in &sound_paths {
                if std::path::Path::new(sound_path).exists() {
                    if Command::new("paplay")
                        .arg(sound_path)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false)
                    {
                        return;
                    }
                    let _ = Command::new("aplay")
                        .arg(sound_path)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn();
                    return;
                }
            }
        }
    });
    Ok(())
}

/// Get the current mouse cursor position.
/// Windows: `GetCursorPos` (physical virtual-desktop coordinates).
/// macOS: `CGEventGetLocation` (Quartz global points).
/// Linux: xdotool on X11, (0,0) on Wayland.
#[tauri::command]
pub async fn get_mouse_position() -> Result<(f64, f64), String> {
    // Both non-Linux arms return coordinates in the same space
    // `show_quick_overlay` compares against the physical positions from
    // `app.available_monitors()`.
    //
    // macOS used to hardcode (0,0) here, which silently pinned the quick overlay
    // to the first monitor. It now reads the real cursor via CoreGraphics — see
    // `overlay::cursor_position`.
    #[cfg(not(target_os = "linux"))]
    {
        crate::overlay::cursor_position()
            .ok_or_else(|| "Failed to read cursor position".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        if !is_wayland() && has_binary("xdotool") {
            let output = Command::new("xdotool")
                .arg("getmouselocation")
                .arg("--shell")
                .output()
                .map_err(|e| format!("Failed to get mouse position: {}", e))?;

            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut x = 0.0f64;
                let mut y = 0.0f64;
                for line in text.lines() {
                    if let Some(val) = line.strip_prefix("X=") {
                        x = val.trim().parse().unwrap_or(0.0);
                    }
                    if let Some(val) = line.strip_prefix("Y=") {
                        y = val.trim().parse().unwrap_or(0.0);
                    }
                }
                return Ok((x, y));
            }
        }

        // Wayland: no reliable cross-compositor way; return (0,0) — window will center
        Ok((0.0, 0.0))
    }
}

/// Capture region and perform OCR, copying text to clipboard.
///
/// Windows/macOS: there is no shell region tool, so the backend captures the
/// primary monitor, stashes it as the pending screenshot, shows and focuses the
/// `region-selector` window and returns `"REGION_SELECTOR_OPENED"`. The frontend
/// treats that as "the selector is already open — just return" and the OCR then
/// runs on the cropped file via `perform_ocr_on_file`.
#[tauri::command]
pub async fn native_capture_ocr_region(
    app_handle: AppHandle,
    save_dir: String,
) -> Result<String, String> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = &save_dir;

        // Same single cursor read as `native_capture_interactive` — capture and
        // cover the one monitor the user is pointing at.
        let point = crate::overlay::cursor_position();

        let screenshot_path = capture_monitor_at_point(point).await?;
        let path_str = screenshot_path.to_string_lossy().into_owned();

        let data_uri = tauri::async_runtime::spawn_blocking(move || {
            let data_uri = file_to_data_uri(&path_str)?;
            let _ = std::fs::remove_file(&path_str);
            Ok::<String, String>(data_uri)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

        {
            let mut lock = PENDING_SCREENSHOT_B64
                .lock()
                .map_err(|e| format!("Mutex: {}", e))?;
            *lock = Some(data_uri);
        }

        crate::overlay::place_and_show_selector(&app_handle, point)?;

        return Ok("REGION_SELECTOR_OPENED".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let _ = &app_handle;
        let screenshot_path = tauri::async_runtime::spawn_blocking(move || {
            let _lock = SCREENCAPTURE_LOCK
                .lock()
                .map_err(|e| format!("Failed to acquire lock: {}", e))?;

            let filename = generate_filename("ocr_temp", "png")?;
            let save_path = PathBuf::from(&save_dir);
            let path = save_path.join(&filename);
            let path_str = path.to_string_lossy().to_string();

            let captured = capture_interactive_inner(&path_str)?;
            if !std::path::Path::new(&captured).exists() {
                return Err("Screenshot was cancelled or failed".to_string());
            }
            Ok::<String, String>(captured)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

        play_screenshot_sound().await.ok();

        let path_clone = screenshot_path.clone();
        let recognized_text = tauri::async_runtime::spawn_blocking(move || {
            let recognized_text =
                recognize_text_from_image(&path_clone).map_err(|e| format!("OCR failed: {}", e))?;

            copy_text_to_clipboard(&recognized_text)
                .map_err(|e| format!("Failed to copy text to clipboard: {}", e))?;

            let _ = std::fs::remove_file(&path_clone);
            Ok::<String, String>(recognized_text)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

        Ok(recognized_text)
    }
}

/// Inner capture logic (no mutex, called when lock is already held)
#[cfg(target_os = "linux")]
fn capture_interactive_inner(path_str: &str) -> Result<String, String> {
    let path = std::path::Path::new(path_str);

    capture_region_tool(path)?;
    Ok(path_str.to_string())
}

#[derive(Clone, serde::Serialize)]
pub struct OverlayPayload {
    pub path: String,
    pub data_url: Option<String>,
}

#[tauri::command]
pub async fn show_quick_overlay(
    app: tauri::AppHandle,
    screenshot_path: String,
    data_url: Option<String>,
    mouse_x: Option<f64>,
    mouse_y: Option<f64>,
) -> Result<(), String> {
    use tauri::Emitter;

    // Get or create the quick-overlay window
    let overlay = if let Some(win) = app.get_webview_window("quick-overlay") {
        win
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "quick-overlay",
            tauri::WebviewUrl::App("index.html?overlay=1".into()),
        )
        .title("FrameXShot – Quick Overlay")
        .inner_size(360.0, 240.0)
        .resizable(true)
        .decorations(true)
        .background_color(tauri::window::Color(9, 9, 9, 255))
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?
    };

    // Calculate position
    let overlay_width = 360.0;
    let overlay_height = 240.0;
    let margin = 16.0;

    let mut target_x = 0.0;
    let mut target_y = 0.0;

    if let Ok(monitors) = app.available_monitors() {
        let mut target_monitor = monitors.first().cloned();

        if let (Some(mx), Some(my)) = (mouse_x, mouse_y) {
            if let Some(m) = monitors.iter().find(|m| {
                let pos = m.position();
                let size = m.size();
                mx >= pos.x as f64
                    && mx < (pos.x as f64 + size.width as f64)
                    && my >= pos.y as f64
                    && my < (pos.y as f64 + size.height as f64)
            }) {
                target_monitor = Some(m.clone());
            }
        }

        if let Some(monitor) = target_monitor {
            let scale_factor = monitor.scale_factor();
            let physical_width = overlay_width * scale_factor;
            let physical_height = overlay_height * scale_factor;
            let physical_margin = margin * scale_factor;

            target_x = monitor.position().x as f64 + monitor.size().width as f64
                - physical_width
                - physical_margin;

            target_y = monitor.position().y as f64 + monitor.size().height as f64
                - physical_height
                - physical_margin;
        }
    }

    let _ = overlay.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        overlay_width,
        overlay_height,
    )));
    let _ = overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        target_x as i32,
        target_y as i32,
    )));
    let _ = overlay.set_always_on_top(true);

    // Emit BEFORE showing — overlay receives data_url and renders screenshot instantly
    let _ = app.emit(
        "overlay-show-capture",
        OverlayPayload {
            path: screenshot_path,
            data_url,
        },
    );

    let _ = overlay.show();
    let _ = overlay.set_focus();

    Ok(())
}

/// Native folder selection dialog command.
///
/// Windows/macOS: uses `tauri-plugin-dialog`'s native picker.
/// Linux: keeps the zenity → kdialog → python3/tkinter chain.
#[tauri::command]
pub async fn select_folder_dialog(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        tauri::async_runtime::spawn_blocking(move || {
        // 1. Try zenity --file-selection --directory if available on Linux GTK/GNOME/Hyprland
        if has_binary("zenity") {
            let mut cmd = Command::new("zenity");
            cmd.arg("--file-selection")
                .arg("--directory")
                .arg("--title=Select Save Directory");

            if let Some(ref path) = default_path {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    cmd.arg(format!("--filename={}", trimmed));
                }
            }

            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !selected.is_empty() {
                        return Ok(Some(selected));
                    }
                }
            }
        }

        // 2. Try kdialog --getexistingdirectory on KDE Plasma
        if has_binary("kdialog") {
            let mut cmd = Command::new("kdialog");
            cmd.arg("--getexistingdirectory");

            if let Some(ref path) = default_path {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    cmd.arg(trimmed);
                }
            }

            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !selected.is_empty() {
                        return Ok(Some(selected));
                    }
                }
            }
        }

        // 3. Try python3 / tkinter dialog fallback
        if has_binary("python3") {
            // The script is a FIXED string and the directory is passed as argv[1].
            //
            // It previously interpolated the path into the source with
            // `format!("initialdir='{}'", p.replace('\'', "\\'"))`. That escaping
            // is wrong for Python — it handles `'` but not `\`, so a trailing
            // backslash escaped the closing quote and broke the script. The save
            // directory is free text the user types in Preferences, so this was
            // user input compiled as code. Passing it as an argument means there
            // is no quoting to get wrong.
            const PICKER_SCRIPT: &str = "\
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
kwargs = {}
if len(sys.argv) > 1 and sys.argv[1]:
    kwargs['initialdir'] = sys.argv[1]
path = filedialog.askdirectory(**kwargs)
print(path if path else '')
";

            let initial_dir = default_path
                .as_ref()
                .map(|p| p.trim().to_string())
                .unwrap_or_default();

            if let Ok(output) = Command::new("python3")
                .arg("-c")
                .arg(PICKER_SCRIPT)
                // Always passed, even when empty: the script checks for an empty
                // argv[1], and a fixed argument count keeps the two cases identical.
                .arg(&initial_dir)
                .output()
            {
                if output.status.success() {
                    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !selected.is_empty() {
                        return Ok(Some(selected));
                    }
                }
            }
        }

        Err("No native file dialog binary found (zenity, kdialog, or python3). Please install zenity.".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    }

    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_dialog::DialogExt;

        // `blocking_pick_folder` must not run on the main thread — the crate
        // docs are explicit about that — hence `spawn_blocking`.
        tauri::async_runtime::spawn_blocking(move || {
            let mut builder = app.dialog().file().set_title("Select Save Directory");

            if let Some(ref path) = default_path {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    builder = builder.set_directory(trimmed);
                }
            }

            match builder.blocking_pick_folder() {
                Some(folder) => {
                    let folder_path = folder
                        .into_path()
                        .map_err(|e| format!("Invalid folder path: {}", e))?;
                    Ok(Some(folder_path.to_string_lossy().into_owned()))
                }
                None => Ok(None),
            }
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
}

/// Reported state of an optional external dependency, so the UI can show a
/// specific "install X, here is how" message instead of a generic failure.
#[derive(serde::Serialize)]
pub struct DependencyStatus {
    /// Whether the feature can be used right now.
    pub available: bool,
    /// Empty when `available`; otherwise a user-facing explanation of what to do.
    pub hint: String,
}

/// Whether OCR can run (i.e. whether `tesseract` is installed and executable).
///
/// Tesseract is a hard package dependency on Linux, but nothing installs it
/// alongside the NSIS or DMG bundles, so on Windows and macOS this can legitimately
/// be `false`. See the `ocr` module docs for why it is not vendored.
#[tauri::command]
pub async fn check_ocr_available() -> Result<DependencyStatus, String> {
    let available = tauri::async_runtime::spawn_blocking(crate::ocr::is_available)
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    Ok(DependencyStatus {
        available,
        hint: if available {
            String::new()
        } else {
            format!(
                "OCR needs the Tesseract engine, which is not installed. {}",
                crate::ocr::INSTALL_HINT
            )
        },
    })
}

/// Whether screen capture is permitted by the OS.
///
/// Only macOS gates this (TCC "Screen Recording"). Windows and Linux always
/// report available, so the frontend can call this unconditionally.
#[tauri::command]
pub async fn check_screen_capture_permission() -> Result<DependencyStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let available = crate::mac_api::has_screen_recording_permission();
        return Ok(DependencyStatus {
            available,
            hint: if available {
                String::new()
            } else {
                crate::mac_api::SCREEN_RECORDING_DENIED_MESSAGE.to_string()
            },
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(DependencyStatus {
            available: true,
            hint: String::new(),
        })
    }
}

/// Open the OS screen-recording privacy settings, prompting first if macOS has
/// never asked.
///
/// No-op off macOS. Deliberately fire-and-forget: if System Settings cannot be
/// opened, the message from `check_screen_capture_permission` already tells the
/// user where to go by hand.
#[tauri::command]
pub async fn open_screen_capture_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Shows the system prompt if and only if this bundle has never asked.
        crate::mac_api::request_screen_recording_permission();

        Command::new("open")
            .arg(crate::mac_api::SCREEN_RECORDING_SETTINGS_URL)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("Failed to open System Settings: {}", e))?;
    }

    Ok(())
}

/// Largest file this command will inline as base64.
///
/// A data URI costs ~4/3 the file size as a UTF-8 string in the Rust process,
/// then again as a JS string in the webview, then again as decoded pixels. An
/// unbounded read of a multi-gigabyte file would take the app down; capture PNGs
/// at 8K are comfortably inside this.
const MAX_INLINE_FILE_BYTES: u64 = 256 * 1024 * 1024;

/// Read an **image** file and return it as a base64 data URI.
///
/// Exposed as a command so the frontend can load image files without going
/// through Tauri's asset protocol, whose scope cannot cover user-chosen save
/// directories on arbitrary drives.
///
/// Restricted to image extensions on purpose. The webview can pass any path it
/// likes here, so without the check this is "read any file on disk and hand it
/// to the frontend" — a much larger primitive than the feature needs. Every
/// caller (`ImageEditor`, `QuickOverlay`, `auto-process`) loads images, so the
/// restriction costs nothing. It is defence in depth, not the primary control:
/// the primary control is the CSP, which admits no remote content.
#[tauri::command]
pub async fn read_file_as_base64(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let extension = std::path::Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();

        // Must cover every format the app can actually hand to this command.
        // `avif` in particular is not optional: `src/assets/bg-images` ships two
        // .avif backgrounds, and omitting it would reject them — a regression on
        // all three platforms, not just the two this branch is about.
        // Deliberately excludes `svg`, which is script-capable and which nothing
        // loads through here.
        if !matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "webp" | "avif" | "gif" | "bmp"
        ) {
            return Err(format!(
                "Refusing to read '{}': only image files can be loaded this way",
                extension
            ));
        }

        let size = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to read image file: {}", e))?
            .len();
        if size > MAX_INLINE_FILE_BYTES {
            return Err(format!(
                "Image is too large to load ({} MB, limit {} MB)",
                size / (1024 * 1024),
                MAX_INLINE_FILE_BYTES / (1024 * 1024)
            ));
        }

        file_to_data_uri(&path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Returns a CLONE of the stored screenshot for the selector overlay to display.
#[tauri::command]
pub async fn capture_screen_for_selector(_app_handle: AppHandle) -> Result<String, String> {
    {
        let lock = PENDING_SCREENSHOT_B64
            .lock()
            .map_err(|e| format!("Mutex: {}", e))?;
        if let Some(ref data) = *lock {
            return Ok(data.clone());
        }
    }

    // Linux uses native tools (grim/slurp, spectacle, etc.) directly — the
    // region-selector overlay is only used on Windows/macOS where interactive
    // capture stores a pending fullscreen shot first. Never auto-capture here
    // on Linux: the hidden selector window mounts at startup and would trigger
    // a portal/grim call on every app launch.
    #[cfg(target_os = "linux")]
    {
        return Err("No pending screenshot — region selector is not used on Linux".to_string());
    }

    // Fallback if no stored screenshot (Windows/macOS only — see above).
    #[cfg(not(target_os = "linux"))]
    {
        let path = capture_primary_monitor(_app_handle).await?;
        return tauri::async_runtime::spawn_blocking(move || {
            let data_uri = file_to_data_uri(&path.to_string_lossy())?;
            let _ = std::fs::remove_file(&path);

            {
                let mut lock = PENDING_SCREENSHOT_B64
                    .lock()
                    .map_err(|e| format!("Mutex: {}", e))?;
                *lock = Some(data_uri.clone());
            }

            Ok(data_uri)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    }
}

/// Crops the stored screenshot and saves to disk.
/// Returns a data URI for the editor to display directly.
#[tauri::command]
pub async fn crop_and_save_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    save_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if width == 0 || height == 0 {
            return Err("Invalid region: width/height must be > 0".to_string());
        }

        let data_uri = {
            let mut lock = PENDING_SCREENSHOT_B64
                .lock()
                .map_err(|e| format!("Mutex: {}", e))?;
            lock.take()
                .ok_or("No pending screenshot — call interactive capture first")?
        };

        use crate::utils::ensure_dir;
        use base64::{engine::general_purpose, Engine as _};
        use std::io::Cursor;

        let raw = data_uri
            .split_once(',')
            .map(|(_header, payload)| payload)
            .ok_or("Malformed base64 data URI")?;
        let bytes = general_purpose::STANDARD
            .decode(raw)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        let iw = img.width();
        let ih = img.height();

        let cx = (x.max(0) as u32).min(iw.saturating_sub(1));
        let cy = (y.max(0) as u32).min(ih.saturating_sub(1));
        let cw = width.min(iw.saturating_sub(cx));
        let ch = height.min(ih.saturating_sub(cy));

        if cw == 0 || ch == 0 {
            return Err(format!(
                "Region ({},{} {}x{}) is outside bounds ({}x{})",
                x, y, width, height, iw, ih
            ));
        }

        let cropped = img.crop_imm(cx, cy, cw, ch);

        let dest_dir = PathBuf::from(&save_dir);
        ensure_dir(&dest_dir)?;
        let fname = generate_filename("screenshot", "png")?;
        let out = dest_dir.join(&fname);

        let mut bytes_buf = Vec::new();
        cropped
            .write_to(&mut Cursor::new(&mut bytes_buf), image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode cropped image: {}", e))?;

        std::fs::write(&out, &bytes_buf).map_err(|e| format!("Failed to save: {}", e))?;

        // Return the file path so App.tsx can pass it to processScreenshotWithDefaultBackground
        Ok(out.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Run OCR on a screenshot file, copy result to clipboard, then delete the temp file.
#[tauri::command]
pub async fn perform_ocr_on_file(path: String) -> Result<String, String> {
    play_screenshot_sound().await.ok();
    let recognized_text = tauri::async_runtime::spawn_blocking(move || {
        recognize_text_from_image(&path)
            .map_err(|e| format!("OCR failed: {}", e))
            .and_then(|text| {
                copy_text_to_clipboard(&text)
                    .map_err(|e| format!("Failed to copy text to clipboard: {}", e))?;
                let _ = std::fs::remove_file(&path);
                Ok(text)
            })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    Ok(recognized_text)
}
