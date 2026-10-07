//! FrameXShot — desktop backend

// The backend dispatches per-platform with paired `#[cfg]` blocks:
//
//     #[cfg(not(target_os = "linux"))]
//     { ...; return Ok(value); }
//
//     #[cfg(target_os = "linux")]
//     { ... }
//
// Exactly one block survives compilation, so clippy sees the `return` in the
// surviving block as the function's tail and flags it as needless. Deleting it
// would make each arm's correctness depend on whether it happens to be the last
// block after cfg-stripping — which differs per target and is not visible when
// reading the file. The explicit `return` keeps every arm self-contained and
// symmetric, and it is the reason this codebase compiles the same way on three
// platforms that cannot all be checked here.
#![allow(clippy::needless_return)]

mod capture;
mod clipboard;
mod commands;
mod image;
#[cfg(target_os = "macos")]
mod mac_api;
mod ocr;
#[cfg(not(target_os = "linux"))]
mod overlay;
mod screenshot;
mod updater;
mod utils;
use std::path::PathBuf;
#[cfg(not(target_os = "linux"))]
mod xcap_capture;

use commands::{
    capture_all_monitors, capture_once, capture_region, capture_screen_for_selector,
    check_for_update, check_ocr_available, check_screen_capture_permission,
    cleanup_old_screenshots, copy_image_file_to_clipboard, crop_and_save_region, detect_install_method,
    get_autostart_state, get_desktop_directory, get_mouse_position, get_temp_directory, install_update,
    move_window_to_active_space, native_capture_fullscreen, native_capture_interactive,
    native_capture_ocr_region, native_capture_window, open_screen_capture_settings, perform_ocr_on_file,
    play_screenshot_sound, read_file_as_base64, relaunch_app, render_image_with_effects_rust,
    save_edited_image, select_folder_dialog, set_autostart, show_quick_overlay,
};

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn main_window_title() -> &'static str {
    if cfg!(debug_assertions) {
        "FrameXShot (dev)"
    } else {
        "FrameXShot"
    }
}

/// Close-to-tray plus focus tracking. On focus we drop the X11 global-hotkey
/// grab from a side thread (the plugin's `unregister_all` hops to the GTK
/// main thread and would deadlock if called from this callback).
fn wire_main_window_events(app: &tauri::AppHandle, window: &WebviewWindow) {
    let window_clone = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide window: {}", e);
            }
            api.prevent_close();
        }
        tauri::WindowEvent::Focused(focused) => {
            if *focused {
                let app_for_unreg = app_handle.clone();
                std::thread::spawn(move || {
                    let _ = app_for_unreg.global_shortcut().unregister_all();
                });
            }
            let _ = app_handle.emit("window-focus-changed", *focused);
        }
        _ => {}
    });

    #[cfg(target_os = "linux")]
    attach_linux_in_window_shortcuts(app, window);
}

/// GTK sees Ctrl+Shift+2 even when WebKitGTK does not dispatch it to JS.
#[cfg(target_os = "linux")]
fn attach_linux_in_window_shortcuts(app: &tauri::AppHandle, window: &WebviewWindow) {
    use gtk::gdk::ModifierType;
    use gtk::prelude::*;

    let gtk_win = match window.gtk_window() {
        Ok(w) => w,
        Err(e) => {
            eprintln!("gtk_window() failed, in-window shortcuts unavailable: {e}");
            return;
        }
    };

    fn is_region_shortcut(event: &gtk::gdk::EventKey) -> bool {
        let state = event.state();
        let ctrl = state.contains(ModifierType::CONTROL_MASK);
        let shift = state.contains(ModifierType::SHIFT_MASK);
        if !ctrl || !shift {
            return false;
        }
        let name = event
            .keyval()
            .name()
            .map(|s| s.as_str().to_string())
            .unwrap_or_default();
        matches!(name.as_str(), "2" | "at" | "quotedbl" | "dead_doubleacute")
    }

    fn emit_matching(app: &tauri::AppHandle, event: &gtk::gdk::EventKey) -> bool {
        if !is_region_shortcut(event) {
            return false;
        }
        let _ = app.emit("capture-triggered", ());
        true
    }

    fn attach_to_widget(widget: &gtk::Widget, app: &tauri::AppHandle) {
        let app_for_handler = app.clone();
        widget.connect_key_press_event(move |_, event| {
            if emit_matching(&app_for_handler, event) {
                gtk::glib::Propagation::Stop
            } else {
                gtk::glib::Propagation::Proceed
            }
        });
        if let Ok(container) = widget.clone().downcast::<gtk::Container>() {
            // WebKit is often added after the GtkWindow exists, so also
            // hook children that show up later.
            let app_for_add = app.clone();
            container.connect_add(move |_, child| {
                attach_to_widget(child, &app_for_add);
            });
            for child in container.children() {
                attach_to_widget(&child, app);
            }
        }
    }

    attach_to_widget(gtk_win.upcast_ref(), app);
}

fn show_main_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title(main_window_title())
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .resizable(true)
            .decorations(false)
            .build()?;

        wire_main_window_events(app, &window);
    }
    Ok(())
}

/// Capture action requested via CLI (`--capture-region` / `-r`, etc.).
/// Priority matches the original `if / else if` chain: region, then screen,
/// then window, then OCR — independent of argv order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliCaptureAction {
    Region,
    Fullscreen,
    Window,
    Ocr,
}

fn parse_cli_capture_action<S: AsRef<str>>(args: &[S]) -> Option<CliCaptureAction> {
    let has = |flag: &str, short: &str| {
        args.iter()
            .any(|arg| arg.as_ref() == flag || arg.as_ref() == short)
    };

    if has("--capture-region", "-r") {
        Some(CliCaptureAction::Region)
    } else if has("--capture-screen", "-s") {
        Some(CliCaptureAction::Fullscreen)
    } else if has("--capture-window", "-w") {
        Some(CliCaptureAction::Window)
    } else if has("--capture-ocr", "-o") {
        Some(CliCaptureAction::Ocr)
    } else {
        None
    }
}

/// Show the main window then emit the same events the tray menu uses.
/// Hidden WebViews on some Wayland compositors drop IPC until shown.
fn emit_cli_capture(app: &tauri::AppHandle, action: CliCaptureAction) {
    let _ = show_main_window(app);
    let event = match action {
        CliCaptureAction::Region => "capture-triggered",
        CliCaptureAction::Fullscreen => "capture-fullscreen",
        CliCaptureAction::Window => "capture-window",
        CliCaptureAction::Ocr => "capture-ocr",
    };
    let _ = app.emit(event, ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Linux WebKitGTK environment tuning for AppImage / sandboxed contexts.
        //
        // IMPORTANT: these are only set when FXS_FORCE_SOFTWARE_GL=1 is in the
        // environment. Reason: the previous unconditional forcing of
        // GDK_BACKEND=x11 + LIBGL_ALWAYS_SOFTWARE broke the AppImage on
        // Wayland-native compositors (COSMIC, recent GNOME, KDE Plasma 6) where
        // XWayland was unstable or where the GLX path was unavailable, producing
        // a blank white window with 38% CPU on the WebKit subprocess. The dev
        // binary (run from a normal Wayland session) was unaffected because
        // these env vars only ran in release builds that picked up the new
        // run() prologue, masking the regression.
        //
        // Opt-in with:
        //   FXS_FORCE_SOFTWARE_GL=1 ./framexshot-x86_64.AppImage
        // or uncomment the env-var block below for a permanent return.
        let force_software_gl = std::env::var_os("FXS_FORCE_SOFTWARE_GL")
            .map(|v| v != "0" && v.as_os_str() != "false")
            .unwrap_or(false);

        if force_software_gl {
            // Disable DMABuf renderer — prevents blank screen on many Linux GPUs/AppImage
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            // Disable GPU compositing — skip hardware compositing path entirely
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            // Disable WebKit subprocess sandbox for unrestricted Linux rendering & hardware access.
            std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
            // Force Mesa software GL renderer.
            // Even with compositing disabled, WebKit's GPU process still calls
            // eglGetDisplay(EGL_DEFAULT_DISPLAY) to enumerate capabilities. On systems where
            // the EGL platform doesn't match (Wayland/X11 mismatch, AppImage namespace, etc.)
            // this returns EGL_BAD_PARAMETER and the subprocess aborts → blank window.
            // llvmpipe (CPU Mesa) always succeeds and the UI performance impact is negligible.
            if std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
                std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
            }
            // Prefer X11/XWayland so WebKit uses the GLX EGL path rather than the Wayland
            // EGL platform, which is less reliable in AppImage/sandboxed contexts.
            if std::env::var_os("GDK_BACKEND").is_none() {
                std::env::set_var("GDK_BACKEND", "x11");
            }
        }
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Second launches (Hyprland bind, `framexshot --capture-region`,
            // etc.) used to drop `_args` and only focus the main window.
            match parse_cli_capture_action(&args) {
                Some(action) => emit_cli_capture(app, action),
                None => {
                    let _ = show_main_window(app);
                }
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ));

    // Native folder picker for `select_folder_dialog`. Serves Windows and
    // macOS; Linux keeps using the zenity/kdialog/python3 chain, so the plugin
    // is not compiled there.
    #[cfg(not(target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    builder
        .setup(|app| {
            // Launch at login is opt-in and driven from Settings → General
            // (`set_autostart`). This used to force-enable it on every launch,
            // which registered the app with the OS behind the user's back and
            // left no way to turn it off from inside the app.

            // Check CLI arguments for Hyprland / Wayland native keybindings
            let args: Vec<String> = std::env::args().collect();
            let app_handle = app.handle().clone();
            let launched_hidden = args.iter().any(|arg| arg == "--hidden");
            // The autostart registration always carries `--hidden` because the
            // plugin bakes its args in at init and cannot rewrite them. Whether
            // that hides the window is the user's choice, persisted alongside
            // the toggle and read here — before the window is built, since
            // `.visible()` is fixed at construction.
            let start_hidden_on_login = crate::utils::read_autostart_prefs(
                &app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")),
            )
            .start_hidden;
            let is_hidden = launched_hidden && start_hidden_on_login;

            // Create main window FIRST — must exist before we emit events into it.
            // (PR #3 fix: CLI capture flags were previously processed before window
            //  creation, causing "no window to receive event" race conditions.)
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title(main_window_title())
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .center()
                    .resizable(true)
                    .decorations(false)
                    .visible(!is_hidden)
                    .build()?;

            // Pre-create the quick-overlay window (hidden) so the first capture
            // with auto-apply is instant. Creating a WebKit window on demand
            // costs seconds and paints a blank white window until React mounts.
            let _ = WebviewWindowBuilder::new(
                app,
                "quick-overlay",
                WebviewUrl::App("index.html?overlay=1".into()),
            )
            .title("FrameXShot – Quick Overlay")
            .inner_size(360.0, 240.0)
            .resizable(true)
            .skip_taskbar(true)
            .decorations(true)
            .visible(false)
            .build();

            // Now CLI capture flags — window exists, events will be received.
            if let Some(action) = parse_cli_capture_action(&args) {
                emit_cli_capture(&app_handle, action);
            }

            wire_main_window_events(&app_handle, &window);

            // Region selector — borderless transparent overlay, moved and sized
            // to cover exactly one monitor at capture time by
            // `overlay::place_and_show_selector`.
            //
            // Deliberately NOT `.fullscreen(true)`: on macOS that is *native*
            // fullscreen, which exiles the window to its own Space behind a ~1s
            // animation and renders a transparent window against a black
            // backdrop. It also always covers whichever monitor the window
            // already sat on, which is not necessarily the monitor that was
            // captured. See the `overlay` module docs.
            //
            // `.shadow(false)` matters on Windows: tao applies a hidden-offset
            // size correction to undecorated windows *that have shadows*, which
            // would leave the overlay a few pixels off the monitor bounds and
            // skew every selection coordinate. A drop shadow on a fullscreen
            // transparent overlay is meaningless anyway.
            let selector = WebviewWindowBuilder::new(
                app,
                "region-selector",
                WebviewUrl::App("index.html?selector=1".into()),
            )
            .title("Select Region")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()?;

            let selector_clone = selector.clone();
            selector.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = selector_clone.hide();
                    api.prevent_close();
                }
            });

            // Tray menu
            use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
            let open_item = MenuItemBuilder::with_id("open", "Open FrameXShot").build(app)?;
            let capture_region_item =
                MenuItemBuilder::with_id("capture_region", "Capture Region").build(app)?;
            let capture_screen_item =
                MenuItemBuilder::with_id("capture_screen", "Capture Screen").build(app)?;
            let capture_window_item =
                MenuItemBuilder::with_id("capture_window", "Capture Window").build(app)?;
            let capture_ocr_item =
                MenuItemBuilder::with_id("capture_ocr", "OCR Region").build(app)?;
            let preferences_item = MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("CommandOrControl+,")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CommandOrControl+Q")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &open_item,
                    &PredefinedMenuItem::separator(app)?,
                    &capture_region_item,
                    &capture_screen_item,
                    &capture_window_item,
                    &capture_ocr_item,
                    &PredefinedMenuItem::separator(app)?,
                    &preferences_item,
                    &PredefinedMenuItem::separator(app)?,
                    &quit_item,
                ])
                .build()?;

            let mut tray_builder = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("FrameXShot")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                    }
                    "capture_region" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                        let _ = app.emit("capture-triggered", ());
                    }
                    "capture_screen" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                        let _ = app.emit("capture-fullscreen", ());
                    }
                    "capture_window" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                        let _ = app.emit("capture-window", ());
                    }
                    "capture_ocr" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        }
                        let _ = app.emit("capture-ocr", ());
                    }
                    "preferences" => {
                        if let Err(e) = show_main_window(app) {
                            eprintln!("Failed to show window: {}", e);
                        } else {
                            let _ = app.emit("open-preferences", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_once,
            capture_all_monitors,
            capture_region,
            save_edited_image,
            render_image_with_effects_rust,
            get_desktop_directory,
            get_temp_directory,
            native_capture_interactive,
            native_capture_fullscreen,
            native_capture_window,
            native_capture_ocr_region,
            play_screenshot_sound,
            get_mouse_position,
            move_window_to_active_space,
            copy_image_file_to_clipboard,
            show_quick_overlay,
            select_folder_dialog,
            read_file_as_base64,
            capture_screen_for_selector,
            crop_and_save_region,
            perform_ocr_on_file,
            cleanup_old_screenshots,
            check_ocr_available,
            check_screen_capture_permission,
            open_screen_capture_settings,
            get_autostart_state,
            set_autostart,
            check_for_update,
            install_update,
            relaunch_app,
            detect_install_method
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_cli_capture_action, CliCaptureAction};

    #[test]
    fn parse_ignores_argv0_and_unrelated_flags() {
        let args = ["framexshot", "--hidden"];
        assert_eq!(parse_cli_capture_action(&args), None);
    }

    #[test]
    fn parse_long_and_short_flags() {
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "--capture-region"]),
            Some(CliCaptureAction::Region)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "-r"]),
            Some(CliCaptureAction::Region)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "--capture-screen"]),
            Some(CliCaptureAction::Fullscreen)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "-s"]),
            Some(CliCaptureAction::Fullscreen)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "--capture-window"]),
            Some(CliCaptureAction::Window)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "-w"]),
            Some(CliCaptureAction::Window)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "--capture-ocr"]),
            Some(CliCaptureAction::Ocr)
        );
        assert_eq!(
            parse_cli_capture_action(&["framexshot", "-o"]),
            Some(CliCaptureAction::Ocr)
        );
    }

    #[test]
    fn parse_priority_is_region_then_screen_then_window_then_ocr() {
        // Matches the original if/else-if chain, not argv order.
        assert_eq!(
            parse_cli_capture_action(&["--capture-ocr", "--capture-region"]),
            Some(CliCaptureAction::Region)
        );
        assert_eq!(
            parse_cli_capture_action(&["-s", "-w"]),
            Some(CliCaptureAction::Fullscreen)
        );
        assert_eq!(
            parse_cli_capture_action(&["-o", "--capture-window"]),
            Some(CliCaptureAction::Window)
        );
    }
}
