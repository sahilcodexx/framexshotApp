//! FrameXShot — Linux backend

mod capture;
mod clipboard;
mod commands;
mod image;
mod ocr;
mod screenshot;
mod utils;

use commands::{
    capture_all_monitors, capture_once, capture_region, capture_screen_for_selector,
    cleanup_old_screenshots, copy_image_file_to_clipboard, crop_and_save_region,
    get_desktop_directory, get_mouse_position, get_temp_directory, move_window_to_active_space,
    native_capture_fullscreen, native_capture_interactive, native_capture_ocr_region,
    native_capture_window, perform_ocr_on_file, play_screenshot_sound, read_file_as_base64,
    render_image_with_effects_rust, save_edited_image, select_folder_dialog, show_quick_overlay,
};

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn show_main_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("FrameXShot")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .resizable(true)
            .decorations(false)
            .build()?;

        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Err(e) = window_clone.hide() {
                    eprintln!("Failed to hide window: {}", e);
                }
                api.prevent_close();
            }
        });
    }
    Ok(())
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            // Enable autostart by default
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart_manager = app.autolaunch();
                if !autostart_manager.is_enabled().unwrap_or(false) {
                    let _ = autostart_manager.enable();
                }
            }

            // Check CLI arguments for Hyprland / Wayland native keybindings
            let args: Vec<String> = std::env::args().collect();
            let app_handle = app.handle().clone();
            let is_hidden = args.iter().any(|arg| arg == "--hidden");

            // Create main window FIRST — must exist before we emit events into it.
            // (PR #3 fix: CLI capture flags were previously processed before window
            //  creation, causing "no window to receive event" race conditions.)
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("FrameXShot")
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

            // Now CLI capture flags - window exists, events will be received.
            if args
                .iter()
                .any(|arg| arg == "--capture-region" || arg == "-r")
            {
                let _ = show_main_window(&app_handle);
                let _ = app_handle.emit("capture-triggered", ());
            } else if args
                .iter()
                .any(|arg| arg == "--capture-screen" || arg == "-s")
            {
                let _ = show_main_window(&app_handle);
                let _ = app_handle.emit("capture-fullscreen", ());
            } else if args
                .iter()
                .any(|arg| arg == "--capture-window" || arg == "-w")
            {
                let _ = show_main_window(&app_handle);
                let _ = app_handle.emit("capture-window", ());
            } else if args.iter().any(|arg| arg == "--capture-ocr" || arg == "-o") {
                let _ = show_main_window(&app_handle);
                let _ = app_handle.emit("capture-ocr", ());
            }

            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window_clone.hide();
                    api.prevent_close();
                }
            });

            // Region selector — fullscreen transparent overlay
            let selector = WebviewWindowBuilder::new(
                app,
                "region-selector",
                WebviewUrl::App("index.html?selector=1".into()),
            )
            .title("Select Region")
            .fullscreen(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
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
            cleanup_old_screenshots
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
