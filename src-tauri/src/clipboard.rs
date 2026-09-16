//! Clipboard operations module

use crate::utils::AppResult;

#[cfg(target_os = "linux")]
use std::io::Write;
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};

#[cfg(target_os = "linux")]
fn has_binary(name: &str) -> bool {
    Command::new("which")
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Copy an image file to the system clipboard (Linux implementation).
/// Tries xclip, then xsel, then wl-copy (Wayland).
#[cfg(target_os = "linux")]
pub fn copy_image_to_clipboard(image_path: &str) -> AppResult<()> {
    let image_bytes =
        std::fs::read(image_path).map_err(|e| format!("Failed to read image: {}", e))?;

    // wl-copy (Wayland)
    if has_binary("wl-copy") {
        let mut child = Command::new("wl-copy")
            .arg("--type")
            .arg("image/png")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn wl-copy: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(&image_bytes)
                .map_err(|e| format!("Failed to write to wl-copy: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for wl-copy: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }

    // xclip (X11)
    if has_binary("xclip") {
        let mut child = Command::new("xclip")
            .arg("-selection")
            .arg("clipboard")
            .arg("-t")
            .arg("image/png")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn xclip: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(&image_bytes)
                .map_err(|e| format!("Failed to write to xclip: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for xclip: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }

    // xsel (X11 fallback)
    if has_binary("xsel") {
        let mut child = Command::new("xsel")
            .arg("--clipboard")
            .arg("--input")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn xsel: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(&image_bytes)
                .map_err(|e| format!("Failed to write to xsel: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for xsel: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }

    Err("No clipboard tool found. Please install xclip, xsel, or wl-clipboard.".to_string())
}

/// Copy text to the system clipboard (Linux implementation).
#[cfg(target_os = "linux")]
pub fn copy_text_to_clipboard(text: &str) -> AppResult<()> {
    let bytes = text.as_bytes();

    if has_binary("wl-copy") {
        let mut child = Command::new("wl-copy")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn wl-copy: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(bytes)
                .map_err(|e| format!("Failed to write to wl-copy: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for wl-copy: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }

    if has_binary("xclip") {
        let mut child = Command::new("xclip")
            .arg("-selection")
            .arg("clipboard")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn xclip: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(bytes)
                .map_err(|e| format!("Failed to write to xclip: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for xclip: {}", e))?;
        if status.success() {
            return Ok(());
        }
    }

    Err("No clipboard tool found. Please install xclip or wl-clipboard.".to_string())
}

/// Copy an image file to the system clipboard (Windows/macOS/fallback using arboard).
#[cfg(not(target_os = "linux"))]
pub fn copy_image_to_clipboard(image_path: &str) -> AppResult<()> {
    use arboard::Clipboard;
    use std::path::Path;

    let path = Path::new(image_path);
    let img =
        image::open(path).map_err(|e| format!("Failed to open image for clipboard: {}", e))?;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let image_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: rgba.into_raw().into(),
    };

    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;

    clipboard
        .set_image(image_data)
        .map_err(|e| format!("Failed to copy image to clipboard: {}", e))?;

    Ok(())
}

/// Copy text to the system clipboard (Windows/macOS/fallback using arboard).
#[cfg(not(target_os = "linux"))]
pub fn copy_text_to_clipboard(text: &str) -> AppResult<()> {
    use arboard::Clipboard;

    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;

    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to copy text to clipboard: {}", e))?;

    Ok(())
}
