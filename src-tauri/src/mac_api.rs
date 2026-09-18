//! Thin CoreGraphics FFI shim for the two macOS facilities the app needs and
//! that no existing dependency exposes: the global cursor location, and the
//! Screen Recording (TCC) permission gate.
//!
//! Declared by hand rather than pulling in `core-graphics` / `objc2` because
//! this is four symbols and the crate graph is already large.
//!
//! ## Deployment target
//!
//! `CGPreflightScreenCaptureAccess` and `CGRequestScreenCaptureAccess` were
//! introduced in macOS 10.15. They are referenced non-weakly here, so the app
//! would fail to launch on anything older — `bundle.macOS.minimumSystemVersion`
//! is pinned to `10.15` in `tauri.conf.json` to match. That is not a real
//! restriction: screen capture on 10.15+ *requires* this permission anyway, so
//! there is no version of macOS where the app both works and lacks these.
#![cfg(target_os = "macos")]

use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

type CFTypeRef = *mut c_void;
type CGEventRef = *mut c_void;
type CGEventSourceRef = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// A null source yields an event describing the current input state, which
    /// is the documented way to read the cursor without an event tap.
    fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: CFTypeRef);
}

/// Current cursor position in Quartz global display coordinates.
///
/// Origin is the top-left of the main display and y grows downward — the same
/// space `CGDisplayBounds` reports, which is what `xcap`'s macOS backend uses
/// for `Monitor::x()` / `Monitor::y()`. So this value can be handed straight to
/// `Monitor::from_point` without a flip.
///
/// Returns `None` if the event could not be created, rather than a bogus
/// `(0, 0)` that the caller cannot distinguish from a real top-left cursor.
pub fn cursor_position() -> Option<(f64, f64)> {
    unsafe {
        let event = CGEventCreate(std::ptr::null_mut());
        if event.is_null() {
            return None;
        }
        let point = CGEventGetLocation(event);
        CFRelease(event as CFTypeRef);
        Some((point.x, point.y))
    }
}

/// Whether this process currently holds Screen Recording permission.
///
/// Does not prompt. Note that the answer is cached by the OS for the lifetime
/// of the process: if the user grants permission in System Settings while the
/// app is running, this keeps returning `false` until the app is restarted.
/// Every user-facing message about this must therefore say "restart".
pub fn has_screen_recording_permission() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Ask the OS to show the Screen Recording permission prompt.
///
/// macOS shows the prompt only once per app bundle, ever. On every later call
/// this is a silent no-op returning the current state, which is why the callers
/// also point the user at System Settings instead of relying on the prompt.
pub fn request_screen_recording_permission() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Single source of truth for the denied-permission text, so the error returned
/// from a failed capture and the one surfaced by the explicit permission check
/// cannot drift apart.
///
/// Mentions the restart because `CGPreflightScreenCaptureAccess` caches its
/// answer for the process lifetime — granting permission genuinely does not
/// take effect until FrameXShot is relaunched.
pub const SCREEN_RECORDING_DENIED_MESSAGE: &str =
    "FrameXShot needs Screen Recording permission to capture your screen.\n\n\
     Open System Settings → Privacy & Security → Screen Recording, enable \
     FrameXShot, then quit and reopen the app (macOS only applies this on \
     restart).";

/// Deep-link to the Screen Recording pane of System Settings.
///
/// The `x-apple.systempreferences:` scheme is stable across Ventura/Sonoma and
/// the older System Preferences, so this is preferable to telling the user to
/// navigate there by hand.
pub const SCREEN_RECORDING_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
