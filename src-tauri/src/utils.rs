//! Utility functions for common operations

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Custom error type for better error handling
pub type AppResult<T> = Result<T, String>;

/// Get the user's Desktop directory path (cross-platform)
pub fn get_desktop_path() -> AppResult<String> {
    let desktop = dirs::desktop_dir().ok_or("Failed to get Desktop directory")?;
    Ok(desktop.to_string_lossy().into_owned())
}

/// Get current timestamp in milliseconds
pub fn get_timestamp() -> AppResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get timestamp: {}", e))
        .map(|d| d.as_millis() as u64)
}

/// Ensure a directory exists, creating it if necessary
pub fn ensure_dir(path: &PathBuf) -> AppResult<()> {
    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))
}

/// Generate a unique filename with a prefix and timestamp
pub fn generate_filename(prefix: &str, extension: &str) -> AppResult<String> {
    let timestamp = get_timestamp()?;
    Ok(format!("{}_{}.{}", prefix, timestamp, extension))
}

/// Generate a unique filename with prefix, id, and timestamp
pub fn generate_filename_with_id(prefix: &str, id: u32, extension: &str) -> AppResult<String> {
    let timestamp = get_timestamp()?;
    Ok(format!("{}_{}_{}.{}", prefix, id, timestamp, extension))
}

/// Helper: Convert an image file on disk into a base64 data URI (data:image/png;base64,...)
pub fn file_to_data_uri(path: &str) -> AppResult<String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image file: {}", e))?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    let mime = if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Cleanup temporary screenshot files in system temp directory on startup
pub fn cleanup_temp_files() -> AppResult<usize> {
    let temp_dir = std::env::temp_dir();
    let mut removed_count = 0;
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let is_temp_screenshot = (name.starts_with("screenshot_")
                        || name.starts_with("monitor_")
                        || name.starts_with("ocr_temp_")
                        || name.starts_with("shot_")
                        || name.starts_with("cropped_")
                        || name.starts_with("rendered_"))
                        && (name.ends_with(".png")
                            || name.ends_with(".jpg")
                            || name.ends_with(".jpeg")
                            || name.ends_with(".webp"));
                    if is_temp_screenshot {
                        if fs::remove_file(&path).is_ok() {
                            removed_count += 1;
                        }
                    }
                }
            }
        }
    }
    Ok(removed_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_timestamp_returns_valid_value() {
        let result = get_timestamp();
        assert!(result.is_ok());

        let timestamp = result.unwrap();
        assert!(timestamp > 0);
    }

    #[test]
    fn test_generate_filename_format() {
        let result = generate_filename("screenshot", "png");
        assert!(result.is_ok());

        let filename = result.unwrap();
        assert!(filename.starts_with("screenshot_"));
        assert!(filename.ends_with(".png"));
    }

    #[test]
    fn test_generate_filename_with_id_format() {
        let result = generate_filename_with_id("monitor", 1, "png");
        assert!(result.is_ok());

        let filename = result.unwrap();
        assert!(filename.starts_with("monitor_1_"));
        assert!(filename.ends_with(".png"));
    }

    #[test]
    fn test_generate_filename_uniqueness() {
        let filename1 = generate_filename("test", "png").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let filename2 = generate_filename("test", "png").unwrap();

        // Filenames should be different due to timestamp
        assert_ne!(filename1, filename2);
    }

    #[test]
    fn test_ensure_dir_creates_nested_directories() {
        let temp_dir = std::env::temp_dir();
        let test_path = temp_dir.join("framexshot_test").join("nested").join("dir");

        let result = ensure_dir(&test_path);
        assert!(result.is_ok());
        assert!(test_path.exists());

        // Cleanup
        let _ = std::fs::remove_dir_all(temp_dir.join("framexshot_test"));
    }

    #[test]
    fn test_cleanup_temp_files() {
        let temp_dir = std::env::temp_dir();
        let dummy_screenshot = temp_dir.join("screenshot_test_cleanup_unit.png");
        let dummy_other = temp_dir.join("other_file_test_cleanup_unit.txt");

        let _ = std::fs::write(&dummy_screenshot, b"dummy png");
        let _ = std::fs::write(&dummy_other, b"dummy text");

        let result = cleanup_temp_files();
        assert!(result.is_ok());

        assert!(
            !dummy_screenshot.exists(),
            "Temporary screenshot should have been cleaned up"
        );
        assert!(
            dummy_other.exists(),
            "Non-screenshot file should be preserved"
        );

        let _ = std::fs::remove_file(&dummy_other);
    }
}
