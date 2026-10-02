use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub type AppResult<T> = Result<T, String>;

pub fn get_desktop_path() -> AppResult<String> {
    let desktop = dirs::desktop_dir().ok_or("Failed to get Desktop directory")?;
    Ok(desktop.to_string_lossy().into_owned())
}

pub fn get_timestamp() -> AppResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get timestamp: {}", e))
        .map(|d| d.as_millis() as u64)
}

pub fn ensure_dir(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))
}

pub fn generate_filename(prefix: &str, extension: &str) -> AppResult<String> {
    let timestamp = get_timestamp()?;
    Ok(format!("{}_{}.{}", prefix, timestamp, extension))
}

pub fn generate_filename_with_id(prefix: &str, id: u32, extension: &str) -> AppResult<String> {
    let timestamp = get_timestamp()?;
    Ok(format!("{}_{}_{}.{}", prefix, id, timestamp, extension))
}

pub fn file_to_data_uri(path: &str) -> AppResult<String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image file: {}", e))?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime_for_path(path), b64))
}

/// Matches on the lowercased extension rather than a case-sensitive
/// `ends_with(".jpg")`: extensions are routinely uppercase (`IMG_0001.JPG` from
/// cameras, `.PNG` on case-insensitive filesystems), and those were previously
/// all mislabelled `image/png`.
fn mime_for_path(path: &str) -> &'static str {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

// --- Launch-at-login preferences -------------------------------------------
//
// The autostart plugin bakes its launch arguments into the OS registration at
// plugin-init time and exposes no way to rewrite them afterwards, so the
// registration always carries `--hidden`. Whether that actually *hides* the
// window is therefore a separate, app-owned decision, persisted here and read
// back in `setup()` before the main window is built.
//
// It lives in its own JSON file rather than in the frontend's `settings.json`
// because the decision has to be made in Rust before the webview that owns that
// store has even mounted.

const AUTOSTART_FLAG_FILE: &str = "autostart.json";

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AutostartPrefs {
    /// Start hidden to the tray when launched at login. Defaults to `true`.
    #[serde(default = "default_true")]
    pub start_hidden: bool,
}

/// Hand-written rather than derived: `#[derive(Default)]` would zero the field
/// to `false`, silently overriding the `serde(default)` above and making a
/// missing prefs file mean "show the window at login" instead of "stay hidden".
impl Default for AutostartPrefs {
    fn default() -> Self {
        AutostartPrefs { start_hidden: true }
    }
}

fn default_true() -> bool {
    true
}

pub fn autostart_flag_path(config_dir: &Path) -> PathBuf {
    config_dir.join(AUTOSTART_FLAG_FILE)
}

/// Read the launch-at-login preferences, falling back to the defaults.
///
/// A missing file, malformed JSON or an unreadable directory all resolve to
/// "start hidden" rather than an error: this runs on every app launch, before
/// any window exists, and failing to start the app because a preferences file
/// is corrupt would be far worse than showing the window.
pub fn read_autostart_prefs(config_dir: &Path) -> AutostartPrefs {
    fs::read_to_string(autostart_flag_path(config_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<AutostartPrefs>(&raw).ok())
        .unwrap_or_default()
}

pub fn write_autostart_prefs(config_dir: &Path, prefs: &AutostartPrefs) -> AppResult<()> {
    ensure_dir(config_dir)?;
    let json = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Failed to serialize autostart prefs: {}", e))?;
    fs::write(autostart_flag_path(config_dir), json)
        .map_err(|e| format!("Failed to write autostart prefs: {}", e))
}

const APP_TEMP_SUBDIR: &str = "framexshot";

/// The directory FrameXShot writes all of its temporary images into.
///
/// This is deliberately a **subdirectory** of the system temp directory rather
/// than the system temp directory itself. Everything the app writes is scratch
/// data it later deletes, and the previous version scanned the shared temp
/// directory and deleted any file matching prefixes like `shot_`, `monitor_`,
/// `cropped_` or `rendered_` with an image extension. Those names are not
/// specific to this app, and on Linux `std::env::temp_dir()` is `/tmp` — shared
/// by every user and process on the machine — so the cleanup could delete other
/// programs' files. Owning a subdirectory makes "delete everything in here"
/// safe by construction.
///
/// The directory is created on demand; callers can rely on it existing.
pub fn app_temp_dir() -> AppResult<PathBuf> {
    let dir = std::env::temp_dir().join(APP_TEMP_SUBDIR);
    ensure_dir(&dir)?;
    Ok(dir)
}

/// Delete FrameXShot's own temporary images.
///
/// Scoped to [`app_temp_dir`], so it can only ever remove files this app wrote.
///
/// Files younger than `min_age` are preserved: cleanup runs while the editor may
/// still be displaying a capture from the current session, and deleting one out
/// from under it produced "Could not load image" errors.
pub fn cleanup_temp_files(min_age: Duration) -> AppResult<usize> {
    cleanup_images_in_dir(&app_temp_dir()?, min_age)
}

/// Remove image files older than `min_age` from a single directory.
///
/// Split out from [`cleanup_temp_files`] so the deletion rules can be tested
/// against a directory the test owns. Testing them against the real app temp
/// directory makes the tests race each other — one deleting the fixture another
/// just wrote — and, worse, couples the test suite to global state that a
/// developer's running app is also using.
///
/// Subdirectories are left alone, and the extension check is a second layer of
/// defence rather than the primary one — the primary one is the caller only ever
/// passing a directory this app owns.
fn cleanup_images_in_dir(dir: &PathBuf, min_age: Duration) -> AppResult<usize> {
    let now = SystemTime::now();
    let mut removed_count = 0;

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let is_image = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| {
                    let e = e.to_ascii_lowercase();
                    e == "png" || e == "jpg" || e == "jpeg" || e == "webp"
                })
                .unwrap_or(false);
            if !is_image {
                continue;
            }

            // Treat an unreadable timestamp as "old enough" — an mtime we cannot
            // read is far more likely to be a stale file from a previous session
            // than one written seconds ago by the running editor.
            let old_enough = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|modified| {
                    now.duration_since(modified)
                        .map(|age| age >= min_age)
                        .unwrap_or(false)
                })
                .unwrap_or(true);

            if old_enough && fs::remove_file(&path).is_ok() {
                removed_count += 1;
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

        assert_ne!(filename1, filename2);
    }

    #[test]
    fn test_ensure_dir_creates_nested_directories() {
        let temp_dir = std::env::temp_dir();
        let test_path = temp_dir.join("framexshot_test").join("nested").join("dir");

        let result = ensure_dir(&test_path);
        assert!(result.is_ok());
        assert!(test_path.exists());

        let _ = std::fs::remove_dir_all(temp_dir.join("framexshot_test"));
    }

    #[test]
    fn test_app_temp_dir_is_a_subdirectory_of_system_temp() {
        let dir = app_temp_dir().unwrap();
        assert!(dir.exists(), "app_temp_dir should create the directory");
        assert!(
            dir.starts_with(std::env::temp_dir()),
            "app temp dir must live inside the system temp dir"
        );
        assert_ne!(
            dir,
            std::env::temp_dir(),
            "app temp dir must NOT be the shared system temp dir itself"
        );
    }

    /// A directory unique to one test, removed on drop.
    ///
    /// Tests run in parallel threads, so they must not share a directory — an
    /// earlier version of these tests pointed at the real `app_temp_dir()` and
    /// the zero-age case deleted the fixture the max-age case had just written.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("framexshot_test_{}", name));
            let _ = std::fs::remove_dir_all(&dir);
            ensure_dir(&dir).unwrap();
            TestDir(dir)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn test_cleanup_removes_old_images_but_not_other_files() {
        let dir = TestDir::new("cleanup_old");
        let image = dir.join("screenshot_1.png");
        let other = dir.join("notes.txt");
        let nested = dir.join("subdir");

        std::fs::write(&image, b"dummy png").unwrap();
        std::fs::write(&other, b"dummy text").unwrap();
        ensure_dir(&nested).unwrap();

        let removed = cleanup_images_in_dir(&dir.0, Duration::from_secs(0)).unwrap();

        assert_eq!(removed, 1);
        assert!(!image.exists(), "Stale image should have been removed");
        assert!(other.exists(), "Non-image files must be left alone");
        assert!(nested.exists(), "Subdirectories must be left alone");
    }

    #[test]
    fn test_cleanup_preserves_recent_images() {
        let dir = TestDir::new("cleanup_recent");
        let fresh = dir.join("screenshot_2.png");
        std::fs::write(&fresh, b"dummy png").unwrap();

        // A just-written file must survive a one-hour threshold — this is the
        // regression guard for deleting a capture the editor still has open.
        let removed = cleanup_images_in_dir(&dir.0, Duration::from_secs(3600)).unwrap();

        assert_eq!(removed, 0);
        assert!(
            fresh.exists(),
            "A file younger than min_age must not be deleted"
        );
    }

    #[test]
    fn test_cleanup_temp_files_cannot_touch_the_shared_temp_dir() {
        // The old implementation scanned std::env::temp_dir() directly and would
        // have deleted this file, which is named exactly like another program's
        // scratch output. This exercises the real public entry point, not the
        // directory-scoped helper, because the scoping is what is under test.
        let bystander = std::env::temp_dir().join("rendered_someone_elses_file.png");
        std::fs::write(&bystander, b"not ours").unwrap();

        cleanup_temp_files(Duration::from_secs(0)).unwrap();

        assert!(
            bystander.exists(),
            "cleanup must never reach outside the app's own temp subdirectory"
        );

        let _ = std::fs::remove_file(&bystander);
    }

    #[test]
    fn test_autostart_prefs_default_to_starting_hidden() {
        let dir = TestDir::new("autostart_default");
        let prefs = read_autostart_prefs(&dir.0);

        assert!(
            prefs.start_hidden,
            "with no prefs file the app must start hidden, matching the --hidden arg"
        );
    }

    #[test]
    fn test_autostart_prefs_round_trip() {
        let dir = TestDir::new("autostart_round_trip");
        write_autostart_prefs(
            &dir.0,
            &AutostartPrefs {
                start_hidden: false,
            },
        )
        .unwrap();

        assert!(!read_autostart_prefs(&dir.0).start_hidden);
    }

    #[test]
    fn test_autostart_prefs_survive_a_corrupt_file() {
        let dir = TestDir::new("autostart_corrupt");
        // A truncated write (app killed mid-save) must not stop the app from
        // launching, and must not silently flip to "show the window on login".
        fs::write(autostart_flag_path(&dir.0), b"{\"start_hidden\"").unwrap();

        assert!(read_autostart_prefs(&dir.0).start_hidden);
    }

    #[test]
    fn test_autostart_prefs_missing_key_defaults_to_hidden() {
        let dir = TestDir::new("autostart_missing_key");
        // An older version wrote `{}`-shaped objects; serde's `default` must
        // fill the field in rather than zeroing it to false.
        fs::write(autostart_flag_path(&dir.0), b"{}").unwrap();

        assert!(read_autostart_prefs(&dir.0).start_hidden);
    }

    #[test]
    fn test_mime_for_path_is_case_insensitive() {
        assert_eq!(mime_for_path("a.jpg"), "image/jpeg");
        assert_eq!(mime_for_path("a.JPG"), "image/jpeg");
        assert_eq!(mime_for_path("a.JPEG"), "image/jpeg");
        assert_eq!(mime_for_path("a.WebP"), "image/webp");
        assert_eq!(mime_for_path("a.png"), "image/png");
        assert_eq!(mime_for_path("a.PNG"), "image/png");
        // Unknown and extension-less paths fall back to PNG, which is what the
        // app writes by default.
        assert_eq!(mime_for_path("a.tiff"), "image/png");
        assert_eq!(mime_for_path("noextension"), "image/png");
        // A dot in a directory name must not be mistaken for the extension.
        assert_eq!(mime_for_path("/home/user/v1.2/shot"), "image/png");
    }
}
