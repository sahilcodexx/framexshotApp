//! OCR module — Linux implementation using tesseract CLI

use crate::utils::AppResult;
use std::process::Command;

/// Recognize text from an image using tesseract OCR.
/// Requires `tesseract` to be installed: apt install tesseract-ocr
pub fn recognize_text_from_image(image_path: &str) -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let tesseract_cmd = {
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
    };

    #[cfg(not(target_os = "windows"))]
    let tesseract_cmd = "tesseract";

    let output = Command::new(tesseract_cmd)
        .arg(image_path)
        .arg("stdout")
        .arg("--psm")
        .arg("3") // fully automatic page segmentation
        .output()
        .map_err(|e| {
            #[cfg(target_os = "linux")]
            let install_msg = "Please install it with: sudo apt install tesseract-ocr";
            #[cfg(target_os = "macos")]
            let install_msg = "Please install it with: brew install tesseract";
            #[cfg(target_os = "windows")]
            let install_msg =
                "Please download and install Tesseract for Windows and add it to your PATH.";
            #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
            let install_msg = "Please ensure Tesseract is installed and in your PATH.";

            format!("Failed to run tesseract: {}. {}", e, install_msg)
        })?;

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
