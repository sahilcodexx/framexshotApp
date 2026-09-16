//! OCR module — shells out to the `tesseract` CLI on all three platforms.
//!
//! Tesseract is **not bundled**. The Linux packages declare it as a hard
//! dependency (`tesseract-ocr` in the deb/rpm `depends` lists), so it is always
//! present there. The NSIS and DMG bundles cannot do the same — Windows and
//! macOS have no dependency resolver — and vendoring the binary plus its
//! `tessdata` language models would add roughly 15 MB of third-party
//! Apache-2.0 payload to every download for a secondary feature.
//!
//! So on Windows and macOS OCR is opt-in: `ocr_status()` reports whether it is
//! installed and what to run to install it, and the frontend surfaces that
//! instead of letting the feature fail with a raw "program not found".

use crate::utils::AppResult;
use std::process::Command;

/// Per-platform install instruction, used both in the error path and in the
/// up-front availability check so the two cannot drift.
pub const INSTALL_HINT: &str = if cfg!(target_os = "linux") {
    "Install it with: sudo apt install tesseract-ocr  (or your distro's equivalent)"
} else if cfg!(target_os = "macos") {
    "Install it with: brew install tesseract"
} else if cfg!(target_os = "windows") {
    "Install it from https://github.com/UB-Mannheim/tesseract/wiki, then restart FrameXShot."
} else {
    "Please ensure Tesseract is installed and in your PATH."
};

/// On Windows the installer does not add itself to `PATH` by default, so the
/// well-known install locations are probed before falling back to a bare
/// `tesseract` (which works if the user did tick the PATH box). Elsewhere the
/// package manager always puts it on `PATH`.
pub fn tesseract_command() -> String {
    #[cfg(target_os = "windows")]
    {
        let mut paths = vec![
            "C:\\Program Files\\Tesseract-OCR\\tesseract.exe".to_string(),
            "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe".to_string(),
        ];
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            paths.push(format!(
                "{}\\Programs\\Tesseract-OCR\\tesseract.exe",
                local_app_data
            ));
            paths.push(format!("{}\\Tesseract-OCR\\tesseract.exe", local_app_data));
        }
        if let Ok(prog_files) = std::env::var("ProgramFiles") {
            paths.push(format!("{}\\Tesseract-OCR\\tesseract.exe", prog_files));
        }
        if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
            paths.push(format!("{}\\Tesseract-OCR\\tesseract.exe", prog_files_x86));
        }
        paths
            .into_iter()
            .find(|p| std::path::Path::new(p).exists())
            .unwrap_or_else(|| "tesseract".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        "tesseract".to_string()
    }
}

/// Runs `tesseract --version`, which is the only reliable probe: on Windows the
/// resolved path may be the bare `tesseract` fallback that is not on `PATH`, and
/// on macOS a Homebrew install can exist for a different architecture.
pub fn is_available() -> bool {
    Command::new(tesseract_command())
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn recognize_text_from_image(image_path: &str) -> AppResult<String> {
    let output = Command::new(tesseract_command())
        .arg(image_path)
        .arg("stdout")
        .arg("--psm")
        .arg("3") // fully automatic page segmentation
        .output()
        .map_err(|e| format!("Failed to run tesseract: {}. {}", e, INSTALL_HINT))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tesseract failed: {}", stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if text.is_empty() {
        return Err("No text recognized in image".to_string());
    }

    Ok(text)
}
