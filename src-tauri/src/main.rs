// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Apply Linux/wayland workarounds before any GTK / webkit2gtk init runs.
///
/// Two known issues that affect Tauri + WebKit2GTK-4.1 on wlroots-based
/// compositors (Hyprland, sway) and other pure-Wayland setups:
///
/// 1. **EGL display creation fails** with
///    "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting..."
///    because linuxdeploy-plugin-gtk's AppRun script unconditionally
///    exports `GDK_BACKEND=x11`, and on Hyprland XWayland does not
///    expose a working EGL stack. Fix: override to `wayland` when we are
///    running on a Wayland session.
///
/// 2. **WebView shows a blank window** even though the main process and
///    the WebKit web-process are alive. WebKit 4.1 prefers DMABuf
///    zero-copy rendering through `zwp_linux_dmabuf_feedback_v1`, which
///    several wlroots compositors don't fully implement. The fallback
///    to the shared-memory renderer fixes the blank-window symptom.
///    (Forcing `WEBKIT_DISABLE_COMPOSITING_MODE=1` as well covers
///    compositors that report DMABuf feedback but the surface is still
///    blank — i.e. the GpuProcess can't attach its rendering context.)
///
/// Both fixes are no-ops on X11 sessions and respect any explicit user
/// overrides via env vars.
#[cfg(target_os = "linux")]
fn apply_linux_wayland_workarounds() {
    let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|s| s.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false);
    if !on_wayland {
        return;
    }

    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "wayland");
    }

    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_linux_wayland_workarounds();

    framexshot_lib::run()
}
