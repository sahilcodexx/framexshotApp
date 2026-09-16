//! Cross-desktop capture fallback chains (X11 + Wayland)
//!
//! Probe tools in priority order, fall through until one succeeds.
//!
//! Region:
//!   cosmic-screenshot → spectacle (KDE) → grim+slurp (wlroots/Hyprland) →
//!   grimblast area (Hyprland alternative) → hyprshot region (Hyprland) →
//!   GNOME Shell SelectArea D-Bus → gnome-screenshot → maim → scrot
//!
//! Fullscreen:
//!   cosmic-screenshot → spectacle → grim (wlroots/Hyprland) →
//!   grimblast screen → hyprshot output → GNOME Shell Screenshot D-Bus →
//!   xdg-desktop-portal Screenshot (fixed, universal) → gnome-screenshot → scrot
//!
//! Window:
//!   COSMIC → spectacle → grimblast active (Hyprland) → hyprshot window →
//!   hyprctl+grim (Hyprland — always available) → GNOME Shell ScreenshotWindow →
//!   gnome-screenshot -w → scrot -u → fallback to region
//!
//! D-Bus paths use zbus (pure-Rust, already in the tree via xcap) and are the
//! only fallbacks that work inside the Flatpak sandbox.

use std::path::Path;
use std::process::{Command, Stdio};

// ── Environment helpers ────────────────────────────────────────────────────

/// True when running under Wayland.
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

/// True when running inside a Flatpak sandbox.
/// `/.flatpak-info` is always present inside a Flatpak and never outside it.
pub fn is_flatpak() -> bool {
    Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some()
}

/// Build a Command for a host binary.
/// Inside a Flatpak we wrap in `flatpak-spawn --host` so the host's
/// grim/slurp/spectacle etc. are reachable. Outside a Flatpak it's a
/// plain Command (inheriting the full env, including WAYLAND_DISPLAY).
pub fn host_command(name: &str) -> Command {
    if is_flatpak() {
        let mut c = Command::new("flatpak-spawn");
        c.arg("--host").arg(name);
        c
    } else {
        Command::new(name)
    }
}

/// Check whether `name` is executable on the effective PATH.
/// Inside a Flatpak this tests the *host* PATH via `flatpak-spawn --host`.
pub fn has_binary(name: &str) -> bool {
    if is_flatpak() {
        return Command::new("flatpak-spawn")
            .args([
                "--host",
                "sh",
                "-c",
                &format!("command -v {} >/dev/null 2>&1", name),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }
    let Ok(path_var) = std::env::var("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(name);
        if !candidate.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            candidate
                .metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        true
    })
}

// ── Public capture entry-points ────────────────────────────────────────────

/// Interactively capture a user-selected region.
pub fn capture_region(path: &Path) -> Result<(), String> {
    if is_wayland() {
        // COSMIC Desktop
        if has_binary("cosmic-screenshot") && cosmic_region(path).is_ok() {
            return Ok(());
        }
        // KDE Plasma (Wayland and X11)
        if has_binary("spectacle") && spectacle_region(path).is_ok() {
            return Ok(());
        }
        // wlroots / Hyprland: grim + slurp
        if has_binary("grim") && has_binary("slurp") && grim_slurp_region(path).is_ok() {
            return Ok(());
        }
        // Hyprland alternative: grimblast (wraps grim+slurp, often installed)
        if has_binary("grimblast") && grimblast(path, "area").is_ok() {
            return Ok(());
        }
        // Hyprland alternative: hyprshot
        if has_binary("hyprshot") && hyprshot(path, "region").is_ok() {
            return Ok(());
        }
        // Modern GNOME (42+): interactive area picker over D-Bus
        #[cfg(target_os = "linux")]
        if gnome_shell_region(path).is_ok() {
            return Ok(());
        }
        // Legacy GNOME
        if has_binary("gnome-screenshot") && gnome_screenshot(path, &["-a"]).is_ok() {
            return Ok(());
        }
        return Err("No screenshot tool found for Wayland region capture. \
             Install grim+slurp (wlroots/Hyprland), spectacle (KDE), \
             or cosmic-screenshot (COSMIC)."
            .to_string());
    }

    // X11
    if has_binary("spectacle") && spectacle_region(path).is_ok() {
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    if gnome_shell_region(path).is_ok() {
        return Ok(());
    }
    for tool in &[("maim", &["-s"][..]), ("scrot", &["-s"][..])] {
        if has_binary(tool.0) {
            let mut cmd = host_command(tool.0);
            for arg in tool.1 {
                cmd.arg(arg);
            }
            cmd.arg(path);
            if cmd.status().map(|s| s.success()).unwrap_or(false) && path.exists() {
                return Ok(());
            }
        }
    }
    Err(
        "No screenshot tool found for X11 region capture. Install scrot, maim, or spectacle."
            .to_string(),
    )
}

/// Capture the full screen (all outputs or primary monitor).
pub fn capture_fullscreen(path: &Path) -> Result<(), String> {
    if is_wayland() {
        // COSMIC
        if has_binary("cosmic-screenshot") && cosmic_fullscreen(path).is_ok() {
            return Ok(());
        }
        // KDE
        if has_binary("spectacle") && spectacle_fullscreen(path).is_ok() {
            return Ok(());
        }
        // wlroots / Hyprland: bare grim (captures all outputs)
        if has_binary("grim") && grim_fullscreen(path).is_ok() {
            return Ok(());
        }
        // Hyprland: grimblast
        if has_binary("grimblast") && grimblast(path, "screen").is_ok() {
            return Ok(());
        }
        // Hyprland: hyprshot
        if has_binary("hyprshot") && hyprshot(path, "output").is_ok() {
            return Ok(());
        }
        // Modern GNOME (42+)
        #[cfg(target_os = "linux")]
        if gnome_shell_fullscreen(path).is_ok() {
            return Ok(());
        }
        // Universal: xdg-desktop-portal (works on every desktop, incl. Flatpak)
        // This is the last Wayland resort — grim should already have succeeded.
        //
        // SKIP inside a Flatpak: flatpak-spawn --host always reaches the user's
        // grim/slurp (verified end-to-end). The portal is unreliable on some
        // backends (xdg-desktop-portal-hyprland returns NotAllowed for
        // non-interactive calls) and adds nothing the host tools don't already
        // give us. Outside a Flatpak the portal remains a useful fallback for
        // systems that don't have grim/slurp installed.
        #[cfg(target_os = "linux")]
        if !is_flatpak() {
            if portal_fullscreen(path).is_ok() {
                return Ok(());
            }
        }
        if has_binary("gnome-screenshot") && gnome_screenshot(path, &[]).is_ok() {
            return Ok(());
        }
        return Err("No screenshot tool found for Wayland fullscreen capture. \
             Install grim (wlroots/Hyprland), spectacle (KDE), or \
             cosmic-screenshot (COSMIC)."
            .to_string());
    }

    // X11
    if has_binary("spectacle") && spectacle_fullscreen(path).is_ok() {
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    if gnome_shell_fullscreen(path).is_ok() {
        return Ok(());
    }
    if has_binary("scrot") {
        let status = host_command("scrot")
            .arg(path)
            .status()
            .map_err(|e| format!("scrot failed: {}", e))?;
        if status.success() && path.exists() {
            return Ok(());
        }
    }
    // Skip the portal inside a flatpak — see comment in capture_fullscreen().
    #[cfg(target_os = "linux")]
    if !is_flatpak() {
        if portal_fullscreen(path).is_ok() {
            return Ok(());
        }
    }
    if has_binary("gnome-screenshot") && gnome_screenshot(path, &[]).is_ok() {
        return Ok(());
    }
    Err(
        "No screenshot tool found for X11 fullscreen capture. Install scrot or spectacle."
            .to_string(),
    )
}

/// Capture the focused/active window.
pub fn capture_window(path: &Path) -> Result<(), String> {
    if is_wayland() {
        // COSMIC has no dedicated window mode — use region picker
        if has_binary("cosmic-screenshot") {
            return capture_region(path);
        }
        // KDE
        if has_binary("spectacle") && spectacle_window(path).is_ok() {
            return Ok(());
        }
        // Hyprland: grimblast active (focused window)
        if has_binary("grimblast") && grimblast(path, "active").is_ok() {
            return Ok(());
        }
        // Hyprland: hyprshot -m window
        if has_binary("hyprshot") && hyprshot(path, "window").is_ok() {
            return Ok(());
        }
        // Hyprland (always available): hyprctl activewindow + grim -g
        // hyprctl is always installed when Hyprland is running.
        if has_binary("hyprctl") && has_binary("grim") && hyprctl_grim_window(path).is_ok() {
            return Ok(());
        }
        // Modern GNOME (42+)
        #[cfg(target_os = "linux")]
        if gnome_shell_window(path).is_ok() {
            return Ok(());
        }
        if has_binary("gnome-screenshot") && gnome_screenshot(path, &["-w"]).is_ok() {
            return Ok(());
        }
        return Err("No window capture tool found for Wayland. \
             Install grimblast or hyprshot (Hyprland), spectacle (KDE), \
             or cosmic-screenshot (COSMIC)."
            .to_string());
    }

    // X11
    if has_binary("spectacle") && spectacle_window(path).is_ok() {
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    if gnome_shell_window(path).is_ok() {
        return Ok(());
    }
    if has_binary("scrot") {
        let status = host_command("scrot")
            .arg("-u") // focused window
            .arg(path)
            .status()
            .map_err(|e| format!("scrot failed: {}", e))?;
        if status.success() && path.exists() {
            return Ok(());
        }
    }
    Err("No window capture tool found for X11. Install scrot or spectacle.".to_string())
}

// ── Per-tool helpers ───────────────────────────────────────────────────────

fn cosmic_region(path: &Path) -> Result<(), String> {
    let save_dir = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp".to_string());

    let output = host_command("cosmic-screenshot")
        .args([
            "--interactive=true",
            "--modal=false",
            "--notify=false",
            "-s",
        ])
        .arg(&save_dir)
        .output()
        .map_err(|e| format!("cosmic-screenshot: {}", e))?;

    if !output.status.success() {
        return Err("cosmic-screenshot failed".to_string());
    }
    let out_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !out_path.is_empty() && Path::new(&out_path).exists() {
        return std::fs::copy(&out_path, path)
            .map(|_| ())
            .map_err(|e| format!("cosmic copy failed: {}", e));
    }
    find_newest_png(&save_dir, path)
}

fn cosmic_fullscreen(path: &Path) -> Result<(), String> {
    let save_dir = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp".to_string());

    let output = host_command("cosmic-screenshot")
        .args(["--interactive=false", "--notify=false", "-s"])
        .arg(&save_dir)
        .output()
        .map_err(|e| format!("cosmic-screenshot: {}", e))?;

    if !output.status.success() {
        return Err("cosmic-screenshot failed".to_string());
    }
    let out_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !out_path.is_empty() && Path::new(&out_path).exists() {
        return std::fs::copy(&out_path, path)
            .map(|_| ())
            .map_err(|e| format!("cosmic copy failed: {}", e));
    }
    find_newest_png(&save_dir, path)
}

fn spectacle_region(path: &Path) -> Result<(), String> {
    let s = host_command("spectacle")
        .args(["--region", "-b", "-n", "-o"])
        .arg(path)
        .status()
        .map_err(|e| format!("spectacle: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("spectacle region failed".to_string())
    }
}

fn spectacle_fullscreen(path: &Path) -> Result<(), String> {
    let s = host_command("spectacle")
        .args(["--fullscreen", "-b", "-n", "-o"])
        .arg(path)
        .status()
        .map_err(|e| format!("spectacle: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("spectacle fullscreen failed".to_string())
    }
}

fn spectacle_window(path: &Path) -> Result<(), String> {
    let s = host_command("spectacle")
        .args(["--window", "-b", "-n", "-o"])
        .arg(path)
        .status()
        .map_err(|e| format!("spectacle: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("spectacle window failed".to_string())
    }
}

fn grim_slurp_region(path: &Path) -> Result<(), String> {
    let slurp = host_command("slurp")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("slurp: {}", e))?;

    if !slurp.status.success() {
        return Err("Screenshot was cancelled".to_string());
    }
    let region = String::from_utf8_lossy(&slurp.stdout).trim().to_string();
    if region.is_empty() {
        return Err("Screenshot was cancelled".to_string());
    }
    let s = host_command("grim")
        .arg("-g")
        .arg(&region)
        .arg(path)
        .status()
        .map_err(|e| format!("grim: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("grim region failed".to_string())
    }
}

fn grim_fullscreen(path: &Path) -> Result<(), String> {
    // `grim <path>` without -o captures a composite of all outputs.
    // This is the standard invocation on Hyprland / wlroots for fullscreen.
    let s = host_command("grim")
        .arg(path)
        .status()
        .map_err(|e| format!("grim: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("grim fullscreen failed".to_string())
    }
}

/// grimblast: Hyprland-contrib wrapper around grim.
/// mode: "area" (region+slurp), "screen" (all outputs), "active" (focused window)
fn grimblast(path: &Path, mode: &str) -> Result<(), String> {
    let s = host_command("grimblast")
        .arg("save")
        .arg(mode)
        .arg(path)
        .status()
        .map_err(|e| format!("grimblast: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err(format!("grimblast {} failed or was cancelled", mode))
    }
}

/// hyprshot: common Hyprland screenshot tool.
/// mode: "region", "output", "window"
fn hyprshot(path: &Path, mode: &str) -> Result<(), String> {
    let dir = path.parent().unwrap_or_else(|| Path::new("/tmp"));
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "hyprshot: invalid filename".to_string())?;

    // hyprshot -m <mode> -o <dir> -f <filename> -s (silent — no notifications)
    let s = host_command("hyprshot")
        .arg("-m")
        .arg(mode)
        .arg("-o")
        .arg(dir)
        .arg("-f")
        .arg(filename)
        .arg("-s")
        .status()
        .map_err(|e| format!("hyprshot: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err(format!("hyprshot {} failed or was cancelled", mode))
    }
}

/// Hyprland window capture via `hyprctl activewindow -j` + `grim -g`.
/// hyprctl is always present on a running Hyprland system.
/// The output JSON contains `at: [x, y]` and `size: [w, h]`.
fn hyprctl_grim_window(path: &Path) -> Result<(), String> {
    let output = host_command("hyprctl")
        .args(["activewindow", "-j"])
        .output()
        .map_err(|e| format!("hyprctl: {}", e))?;

    if !output.status.success() {
        return Err("hyprctl activewindow failed".to_string());
    }

    // Parse the minimal fields we need; avoid pulling in a heavy JSON dep.
    // The JSON looks like: {"at":[x,y],"size":[w,h],...}
    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("hyprctl JSON parse error: {}", e))?;

    let x = json["at"][0].as_i64().ok_or("hyprctl: missing 'at[0]'")?;
    let y = json["at"][1].as_i64().ok_or("hyprctl: missing 'at[1]'")?;
    let w = json["size"][0]
        .as_i64()
        .ok_or("hyprctl: missing 'size[0]'")?;
    let h = json["size"][1]
        .as_i64()
        .ok_or("hyprctl: missing 'size[1]'")?;

    if w <= 0 || h <= 0 {
        return Err(format!("hyprctl: degenerate window geometry {}x{}", w, h));
    }

    // grim geometry format: "x,y wxh"
    let geometry = format!("{},{} {}x{}", x, y, w, h);
    let s = host_command("grim")
        .arg("-g")
        .arg(&geometry)
        .arg(path)
        .status()
        .map_err(|e| format!("grim (window): {}", e))?;

    if s.success() && path.exists() {
        Ok(())
    } else {
        Err(format!(
            "grim window capture failed (geometry: {})",
            geometry
        ))
    }
}

fn gnome_screenshot(path: &Path, extra_args: &[&str]) -> Result<(), String> {
    let mut cmd = host_command("gnome-screenshot");
    for arg in extra_args {
        cmd.arg(arg);
    }
    cmd.arg("-f").arg(path);
    let s = cmd
        .status()
        .map_err(|e| format!("gnome-screenshot: {}", e))?;
    if s.success() && path.exists() {
        Ok(())
    } else {
        Err("gnome-screenshot failed".to_string())
    }
}

// ── D-Bus fallbacks (pure-Rust zbus) ──────────────────────────────────────

/// xdg-desktop-portal Screenshot — universal fallback for fullscreen.
///
/// Bugs in the old implementation that caused `NotAllowed` on Hyprland:
///
/// 1. Missing `parent_window` argument.
///    The correct D-Bus signature is:
///      Screenshot(IN s parent_window, IN a{sv} options) → OUT o handle
///    The old code called `call_method("Screenshot", &options)` — passing
///    ONLY the options dict, omitting the mandatory parent_window string.
///
/// 2. Invalid `filename` option.
///    The portal spec has no `filename` option. The portal chooses its own
///    save location and returns it in the response. Passing it was a no-op.
///
/// 3. Response URI completely ignored.
///    The old code checked `if !path.exists()` after a successful response.
///    The file is NEVER at `path` — the portal writes to its own URI
///    (returned in `results["uri"]`). So the old code always returned an
///    error even when the portal succeeded.
///
/// 4. `interactive=false` not supported by xdg-desktop-portal-hyprland.
///    xdph requires user interaction (`interactive=true`) and returns
///    response code 2 (`NotAllowed`) for non-interactive calls.
///    Fix: try `interactive=false` first, retry with `interactive=true`
///    when the portal returns NotAllowed (code 2).
#[cfg(target_os = "linux")]
fn portal_fullscreen(path: &Path) -> Result<(), String> {
    // Try non-interactive first (no dialog — preferred when supported).
    // On GNOME this captures immediately; on xdph this will return NotAllowed.
    match portal_screenshot_call(path, false) {
        Ok(()) => return Ok(()),
        Err(PortalError::NotAllowed) => {
            // xdg-desktop-portal-hyprland (and some other backends) reject
            // interactive=false. Fall through to interactive mode.
        }
        Err(PortalError::Cancelled) => return Err("Screenshot was cancelled".to_string()),
        Err(PortalError::Other(msg)) => {
            // Non-fatal: the portal might simply not be running (common on
            // minimal Hyprland setups without xdg-desktop-portal installed).
            return Err(msg);
        }
    }

    // interactive=true — shows the portal's built-in picker (e.g.
    // hyprland-share-picker on Hyprland). The user selects a monitor.
    match portal_screenshot_call(path, true) {
        Ok(()) => Ok(()),
        Err(PortalError::Cancelled) => Err("Screenshot was cancelled".to_string()),
        Err(PortalError::NotAllowed) => {
            Err("xdg-desktop-portal denied screenshot permission".to_string())
        }
        Err(PortalError::Other(msg)) => Err(msg),
    }
}

#[cfg(target_os = "linux")]
enum PortalError {
    Cancelled,  // response code 1
    NotAllowed, // response code 2
    Other(String),
}

/// Make a single `org.freedesktop.portal.Screenshot.Screenshot` call.
///
/// Correct D-Bus call:
///   destination:  org.freedesktop.portal.Desktop
///   path:         /org/freedesktop/portal/desktop
///   interface:    org.freedesktop.portal.Screenshot
///   method:       Screenshot
///   args:         (parent_window: s = "", options: a{sv})
///
/// Response signal on the returned handle object:
///   interface:  org.freedesktop.portal.Request
///   signal:     Response
///   args:       (response: u, results: a{sv})
///   results["uri"] (s): the file:// URI of the saved screenshot
#[cfg(target_os = "linux")]
fn portal_screenshot_call(path: &Path, interactive: bool) -> Result<(), PortalError> {
    use std::collections::HashMap;
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    let conn = Connection::session()
        .map_err(|e| PortalError::Other(format!("D-Bus session unavailable: {}", e)))?;

    let portal = Proxy::new(
        &conn,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
    )
    .map_err(|e| PortalError::Other(format!("Cannot reach xdg-desktop-portal: {}", e)))?;

    // options: only the options specified in the portal spec.
    // "filename" is NOT a valid option and was erroneously included before.
    let mut options: HashMap<&str, Value> = HashMap::new();
    options.insert("interactive", Value::from(interactive));
    options.insert("modal", Value::from(false));

    // Correct call: (parent_window: s, options: a{sv})
    // parent_window = "" is valid; it means "no parent window / take focus".
    let reply = portal
        .call_method("Screenshot", &("", &options))
        .map_err(|e| {
            // xdg-desktop-portal-hyprland (xdph) returns a D-Bus *error reply*
            // (not a Response signal with code 2) when a sandboxed Flatpak app
            // calls Screenshot with interactive=false.  The error name is
            // org.freedesktop.portal.Error.NotAllowed and the message contains
            // "not available inside the sandbox".
            //
            // Without this check the error is mapped to PortalError::Other and
            // we return immediately — the interactive=true retry never happens.
            // Map it to NotAllowed so the caller falls through to the retry.
            if e.to_string().contains("NotAllowed") {
                PortalError::NotAllowed
            } else {
                PortalError::Other(format!("Portal Screenshot call failed: {}", e))
            }
        })?;

    let request_path: OwnedObjectPath = reply
        .body()
        .deserialize()
        .map_err(|e| PortalError::Other(format!("Bad portal reply body: {}", e)))?;

    // Subscribe to the Response signal on the request handle object.
    let request = Proxy::new(
        &conn,
        "org.freedesktop.portal.Desktop",
        request_path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .map_err(|e| PortalError::Other(format!("Cannot subscribe to portal request: {}", e)))?;

    let mut signals = request
        .receive_signal("Response")
        .map_err(|e| PortalError::Other(format!("Cannot receive portal response: {}", e)))?;

    let msg = signals
        .next()
        .ok_or_else(|| PortalError::Other("Portal closed without responding".to_string()))?;

    let (response, results): (u32, HashMap<String, OwnedValue>) = msg
        .body()
        .deserialize()
        .map_err(|e| PortalError::Other(format!("Bad Response signal body: {}", e)))?;

    match response {
        0 => { /* success, handled below */ }
        1 => return Err(PortalError::Cancelled),
        2 => return Err(PortalError::NotAllowed),
        n => {
            return Err(PortalError::Other(format!(
                "Portal returned error code {}",
                n
            )))
        }
    }

    // Extract the URI from results["uri"].
    // The portal NEVER writes to `path` — it picks its own save location.
    // We must read results["uri"] and copy the file to where we want it.
    let uri_val = results
        .get("uri")
        .ok_or_else(|| PortalError::Other("Portal success but no 'uri' in response".to_string()))?;

    // OwnedValue derefs to Value<'static>; match on the inner Str variant.
    let uri_str: String = match &**uri_val {
        Value::Str(s) => s.as_str().to_string(),
        other => {
            return Err(PortalError::Other(format!(
                "Portal URI has unexpected type: {:?}",
                other
            )));
        }
    };

    // Parse the file:// URI → filesystem path
    let src = url::Url::parse(&uri_str)
        .map_err(|e| PortalError::Other(format!("Invalid portal URI '{}': {}", uri_str, e)))?
        .to_file_path()
        .map_err(|_| {
            PortalError::Other(format!("Portal URI '{}' is not a file:// URI", uri_str))
        })?;

    // Copy from the portal's chosen location to the path the caller requested.
    std::fs::copy(&src, path).map(|_| ()).map_err(|e| {
        PortalError::Other(format!(
            "Failed to copy portal screenshot from {} to {}: {}",
            src.display(),
            path.display(),
            e
        ))
    })
}

/// GNOME Shell interactive area picker over D-Bus (GNOME 42+, sandbox-friendly).
#[cfg(target_os = "linux")]
fn gnome_shell_region(path: &Path) -> Result<(), String> {
    use zbus::blocking::{Connection, Proxy};

    let conn = Connection::session().map_err(|e| format!("D-Bus unavailable: {}", e))?;
    let shell = Proxy::new(
        &conn,
        "org.gnome.Shell",
        "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot",
    )
    .map_err(|e| format!("GNOME Shell not reachable: {}", e))?;

    let reply = shell
        .call_method("SelectArea", &())
        .map_err(|e| format!("GNOME Shell SelectArea: {}", e))?;
    let (x, y, width, height): (i32, i32, i32, i32) = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Bad SelectArea reply: {}", e))?;

    if width <= 0 || height <= 0 {
        return Err("Screenshot was cancelled".to_string());
    }

    let filename = path.to_string_lossy().to_string();
    let reply = shell
        .call_method("ScreenshotArea", &(x, y, width, height, false, filename))
        .map_err(|e| format!("GNOME Shell ScreenshotArea: {}", e))?;
    let (ok, _): (bool, String) = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Bad ScreenshotArea reply: {}", e))?;

    if !ok || !path.exists() {
        return Err("GNOME Shell failed to capture the area".to_string());
    }
    Ok(())
}

/// GNOME Shell fullscreen capture over D-Bus (GNOME 42+).
#[cfg(target_os = "linux")]
fn gnome_shell_fullscreen(path: &Path) -> Result<(), String> {
    use zbus::blocking::{Connection, Proxy};

    let conn = Connection::session().map_err(|e| format!("D-Bus unavailable: {}", e))?;
    let shell = Proxy::new(
        &conn,
        "org.gnome.Shell",
        "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot",
    )
    .map_err(|e| format!("GNOME Shell not reachable: {}", e))?;

    let filename = path.to_string_lossy().to_string();
    let reply = shell
        .call_method("Screenshot", &(true, false, filename))
        .map_err(|e| format!("GNOME Shell Screenshot: {}", e))?;
    let (ok, _): (bool, String) = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Bad Screenshot reply: {}", e))?;

    if !ok || !path.exists() {
        return Err("GNOME Shell failed to capture the screen".to_string());
    }
    Ok(())
}

/// GNOME Shell focused-window capture over D-Bus (GNOME 42+).
#[cfg(target_os = "linux")]
fn gnome_shell_window(path: &Path) -> Result<(), String> {
    use zbus::blocking::{Connection, Proxy};

    let conn = Connection::session().map_err(|e| format!("D-Bus unavailable: {}", e))?;
    let shell = Proxy::new(
        &conn,
        "org.gnome.Shell",
        "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot",
    )
    .map_err(|e| format!("GNOME Shell not reachable: {}", e))?;

    let filename = path.to_string_lossy().to_string();
    let reply = shell
        .call_method("ScreenshotWindow", &(true, true, false, filename))
        .map_err(|e| format!("GNOME Shell ScreenshotWindow: {}", e))?;
    let (ok, _): (bool, String) = reply
        .body()
        .deserialize()
        .map_err(|e| format!("Bad ScreenshotWindow reply: {}", e))?;

    if !ok || !path.exists() {
        return Err("GNOME Shell failed to capture the window".to_string());
    }
    Ok(())
}

// ── Non-Linux stubs ────────────────────────────────────────────────────────
#[cfg(not(target_os = "linux"))]
fn portal_fullscreen(_path: &Path) -> Result<(), String> {
    Err("portal capture is Linux-only".to_string())
}

#[cfg(not(target_os = "linux"))]
fn gnome_shell_region(_path: &Path) -> Result<(), String> {
    Err("GNOME Shell capture is Linux-only".to_string())
}

#[cfg(not(target_os = "linux"))]
fn gnome_shell_fullscreen(_path: &Path) -> Result<(), String> {
    Err("GNOME Shell capture is Linux-only".to_string())
}

#[cfg(not(target_os = "linux"))]
fn gnome_shell_window(_path: &Path) -> Result<(), String> {
    Err("GNOME Shell capture is Linux-only".to_string())
}

// ── Utilities ──────────────────────────────────────────────────────────────

/// Copy the most recently modified PNG in `dir` to `dest`.
/// Used as a fallback when a tool doesn't print its output path.
fn find_newest_png(dir: &str, dest: &Path) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut files: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "png").unwrap_or(false))
            .collect();
        files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        if let Some(last) = files.last() {
            return std::fs::copy(last.path(), dest)
                .map(|_| ())
                .map_err(|e| format!("Failed to copy screenshot: {}", e));
        }
    }
    Err("No PNG found in output directory".to_string())
}
