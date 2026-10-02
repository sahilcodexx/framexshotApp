//! Launch-at-login and self-update support.
//!
//! The updater here is deliberately NOT Tauri v2's built-in updater plugin.
//! That plugin expects artifacts in a specific `latest.json` layout and does
//! the install itself, which fights the fact that FrameXShot ships through
//! several competing packaging systems (Flatpak, deb, rpm, Arch, DMG, and a
//! `curl | sh` installer). Instead this module:
//!
//!   1. Works out how this copy of the app was installed.
//!   2. Refuses to self-update when a package manager owns the install.
//!   3. Otherwise downloads the matching artifact, verifies its SHA-256
//!      against the checksums file published with the release, and hands off
//!      to `install.sh`, which already knows how to install per-OS.
//!
//! See AGENTS.md Change 41 for the reasoning.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::utils::AppResult;

/// How this copy of FrameXShot got onto the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallMethod {
    /// Copied into place by `install.sh`, or run from the build tree.
    /// Only this case may self-update.
    Portable,
    /// Installed with `flatpak install`.
    Flatpak,
    /// Installed from a .deb / .rpm by the system package manager.
    SystemPackage,
    /// Homebrew cask.
    Homebrew,
}

impl InstallMethod {
    /// Whether the app may replace its own binary.
    ///
    /// Self-updating over a package-managed install produces a split-brain
    /// state: the running app diverges from what the package manager tracks,
    /// and the next `flatpak update` / `apt upgrade` silently overwrites it.
    pub fn can_self_update(&self) -> bool {
        matches!(self, InstallMethod::Portable)
    }

    /// Human-readable instruction shown instead of a self-update button.
    pub fn manual_update_hint(&self) -> Option<&'static str> {
        match self {
            InstallMethod::Portable => None,
            InstallMethod::Flatpak => Some("flatpak update com.framexshot.app"),
            InstallMethod::SystemPackage => {
                Some("update with your package manager (apt / dnf / pacman -Syu)")
            }
            InstallMethod::Homebrew => Some("brew upgrade --cask framexshot"),
        }
    }
}

/// Which artifact to download for the running platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Dmg,
    Deb,
    Rpm,
    AppImage,
    FlatpakBundle,
    Unknown,
}

pub fn current_artifact_kind() -> ArtifactKind {
    if cfg!(target_os = "macos") {
        ArtifactKind::Dmg
    } else if cfg!(target_os = "linux") {
        // The CI publishes several Linux formats side by side. There is no
        // runtime way to tell which one owns this binary, so the updater
        // offers the .deb and points deb/rpm users at their package manager
        // via `install_method` instead.
        ArtifactKind::Deb
    } else {
        ArtifactKind::Unknown
    }
}

fn is_flatpak() -> bool {
    // FLATPAK_ID is exported into the sandbox; /.flatpak-info exists only
    // inside a Flatpak-installed app. Either alone is conclusive.
    std::env::var_os("FLATPAK_ID").is_some() || PathBuf::from("/.flatpak-info").exists()
}

fn is_homebrew() -> bool {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let path = exe.to_string_lossy();
    path.contains("/Cellar/")
        || path.contains("/homebrew/")
        || path.contains("/linuxbrew/")
        || path.contains("/.brew/")
}

/// Detect the install method.
///
/// Ordered most-specific first: a Flatpak build also lives under
/// `/app`-style paths and could match the Homebrew check by accident, and a
/// Homebrew cask install lives in `/Applications` on macOS, so the Portable
/// fallback must come last.
pub fn detect_install_method() -> InstallMethod {
    if is_flatpak() {
        return InstallMethod::Flatpak;
    }
    if is_homebrew() {
        return InstallMethod::Homebrew;
    }
    InstallMethod::Portable
}

#[derive(Serialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    /// Newer version tag (no leading `v`), or null when already up to date.
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub install_method: InstallMethod,
    /// False when a package manager owns this install — the UI shows the
    /// manual command instead of a download button.
    pub can_self_update: bool,
    pub manual_update_hint: Option<String>,
    pub artifact_kind: ArtifactKind,
}

/// Strip a leading `v` from a release tag.
fn normalize_version(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_string()
}

/// Compare dotted numeric versions, handling a `-suffix` pre-release marker.
///
/// Returns true when `candidate` is strictly newer than `current`.
///
/// The pre-release marker is NOT simply ignored. Splitting on every non-digit
/// (the obvious approach) silently turns `1.3.0-beta.1` into `[1,3,0,1]`, which
/// compares as NEWER than the stable `1.3.0` — so a beta tag would push itself
/// to users who are already on the release. The suffix is therefore stripped
/// from the numeric core and compared as a rank instead: a plain release beats
/// its own pre-release, and a pre-release never replaces a release.
fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> (Vec<u64>, bool) {
        let is_pre = v.contains('-');
        let core = v.split('-').next().unwrap_or("");
        let segs = core
            .split('.')
            .filter(|s| !s.is_empty())
            // A non-numeric segment compares as 0 rather than erroring, so a
            // tag like `v1.3` or `release-1.3.0` cannot crash the check.
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect();
        (segs, is_pre)
    };

    let (c, c_pre) = parse(candidate);
    let (cur, cur_pre) = parse(current);

    let len = c.len().max(cur.len());
    for i in 0..len {
        let a = c.get(i).copied().unwrap_or(0);
        let b = cur.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }

    // Same numeric core: only a stable release supersedes its own pre-release.
    match (c_pre, cur_pre) {
        (false, true) => true,
        _ => false,
    }
}

/// Pull the tag out of the GitHub `releases/latest` payload.
///
/// Only `tag_name` is deserialized — the payload is large and the rest is
/// irrelevant, so pulling the whole release object into memory would be waste.
#[derive(Deserialize)]
struct LatestRelease {
    tag_name: String,
}

fn extract_tag(body: &str) -> Option<String> {
    let parsed: LatestRelease = serde_json::from_str(body).ok()?;
    let tag = parsed.tag_name.trim().to_string();
    if tag.is_empty() {
        None
    } else {
        Some(tag)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_version_strips_leading_v() {
        assert_eq!(normalize_version("v1.3.0"), "1.3.0");
        assert_eq!(normalize_version("1.3.0"), "1.3.0");
        assert_eq!(normalize_version("  v1.3.0\n"), "1.3.0");
    }

    #[test]
    fn test_is_newer_compares_numerically_not_lexically() {
        // The bug this guards: "1.10.0" < "1.9.0" as a string compare.
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(!is_newer("1.2.0", "1.2.0"));
        assert!(!is_newer("1.1.0", "1.2.0"));
    }

    #[test]
    fn test_is_newer_handles_unequal_segment_counts() {
        assert!(is_newer("1.2.1", "1.2"));
        assert!(!is_newer("1.2", "1.2.0"));
        assert!(is_newer("1.3", "1.2.9"));
    }

    #[test]
    fn test_is_newer_tolerates_prerelease_suffixes() {
        // A beta must never be pushed to someone already on the release.
        // This is the regression guard: splitting on non-digits used to fold
        // "beta.1" into an extra segment and call the beta NEWER.
        assert!(!is_newer("1.3.0-beta.1", "1.3.0"));
        assert!(!is_newer("1.3.0-beta", "1.3.0"));
        // A higher core version is still an upgrade even if it is a pre-release.
        assert!(is_newer("1.3.1-beta.1", "1.3.0"));
        assert!(is_newer("2.0.0-rc.1", "1.9.9"));
    }

    #[test]
    fn test_stable_release_supersedes_its_own_prerelease() {
        // The inverse case: someone on the beta should be offered the release.
        assert!(is_newer("1.3.0", "1.3.0-beta.1"));
        assert!(!is_newer("1.3.0-beta.1", "1.3.0-beta.2"));
    }

    #[test]
    fn test_extract_tag_finds_field() {
        let body = r#"{"url":"x","tag_name":"v1.4.0","draft":false}"#;
        assert_eq!(extract_tag(body).as_deref(), Some("v1.4.0"));
    }

    #[test]
    fn test_extract_tag_handles_missing_or_malformed() {
        assert_eq!(extract_tag(r#"{"draft":true}"#), None);
        assert_eq!(extract_tag("not json at all"), None);
        assert_eq!(extract_tag(r#"{"tag_name":""}"#), None);
    }

    #[test]
    fn test_extract_tag_tolerates_extra_fields() {
        // The real payload has ~20 fields; deserializing a subset must not
        // fail on the ones we do not declare.
        let body = r#"{"url":"https://api.github.com/x","assets_url":"y","tag_name":"v2.0.0","draft":false,"prerelease":false}"#;
        assert_eq!(extract_tag(body).as_deref(), Some("v2.0.0"));
    }

    #[test]
    fn test_only_portable_may_self_update() {
        assert!(InstallMethod::Portable.can_self_update());
        assert!(!InstallMethod::Flatpak.can_self_update());
        assert!(!InstallMethod::SystemPackage.can_self_update());
        assert!(!InstallMethod::Homebrew.can_self_update());
    }

    #[test]
    fn test_portable_has_no_manual_hint() {
        assert_eq!(InstallMethod::Portable.manual_update_hint(), None);
        assert!(InstallMethod::Flatpak
            .manual_update_hint()
            .unwrap()
            .contains("flatpak update"));
    }
}
// --- IPC surface ------------------------------------------------------------

/// Ask GitHub for the newest published release and compare it with this build.
///
/// Fails rather than reporting "up to date" when the network is unavailable —
/// a silent false negative would read as "nothing to do" and hide a real
/// update, so the caller must be able to tell the two apart.
pub fn check_for_update(
    current_version: &str,
    timeout_secs: u64,
) -> AppResult<UpdateCheckResult> {
    let url = "https://api.github.com/repos/sahilcodexx/framexshotApp/releases/latest";

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("FrameXShot-Updater")
        .build()
        .map_err(|e| format!("Could not create HTTP client: {}", e))?;

    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Could not reach GitHub: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub returned HTTP {}", response.status()));
    }

    let body = response
        .text()
        .map_err(|e| format!("Could not read release info: {}", e))?;

    let tag = extract_tag(&body)
        .ok_or_else(|| "GitHub returned no release tag".to_string())?;
    let latest = normalize_version(&tag);

    let method = detect_install_method();
    let update_available = is_newer(&latest, current_version);

    Ok(UpdateCheckResult {
        current_version: current_version.to_string(),
        latest_version: if update_available {
            Some(latest)
        } else {
            None
        },
        update_available,
        install_method: method,
        can_self_update: method.can_self_update(),
        manual_update_hint: method.manual_update_hint().map(|s| s.to_string()),
        artifact_kind: current_artifact_kind(),
    })
}

/// Lines of a `sha256sum`-style file: a 64-hex digest, whitespace, then the
/// artifact file name.
///
/// The release workflow emits one of these per artifact, hashed in place, so
/// the name arrives as a relative path (`dmg/framexshot_1.3.0_aarch64.dmg`,
/// often with a `./` and binary-mode `*` prefix). Only the final segment is
/// kept: it is what `verify_checksum` is asked about, and matching on the full
/// path would depend on which directory the hashing happened to run in.
pub fn parse_checksums(body: &str) -> Vec<(String, String)> {
    body.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let hash = parts.next()?;
            let name = parts.next()?;
            if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
                let name = name.trim_start_matches('*');
                let file_name = name.rsplit('/').next().unwrap_or(name);
                Some((hash.to_ascii_lowercase(), file_name.to_string()))
            } else {
                None
            }
        })
        .collect()
}

/// Verify a downloaded file against the published checksums.
///
/// Returns the expected hash on success. A missing entry is an error rather
/// than a pass — an artifact the release never checksummed is not one we should
/// install.
pub fn verify_checksum(
    file: &std::path::Path,
    file_name: &str,
    checksums: &str,
) -> AppResult<String> {
    let table = parse_checksums(checksums);
    let expected = table
        .iter()
        .find(|(_, name)| name == file_name)
        .map(|(hash, _)| hash.clone())
        .ok_or_else(|| format!("Release has no published checksum for {}", file_name))?;

    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(file)
        .map_err(|e| format!("Failed to read downloaded file: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    if actual != expected {
        return Err(format!(
            "Checksum mismatch for {} — the download is corrupt or tampered with",
            file_name
        ));
    }
    Ok(expected)
}

#[cfg(test)]
mod checksum_tests {
    use super::*;

    #[test]
    fn test_parse_checksums_reads_standard_format() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let body = format!("{}  framexshot_1.0.0_aarch64.dmg\n{} *framexshot_1.0.0_x64.deb\n", a, b);
        let parsed = parse_checksums(&body);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0], (a, "framexshot_1.0.0_aarch64.dmg".to_string()));
        // Binary-mode `*` prefix is how sha256sum marks text mode; must be stripped.
        assert_eq!(parsed[1].1, "framexshot_1.0.0_x64.deb");
    }

    #[test]
    fn test_parse_checksums_strips_the_hashed_directory_prefix() {
        let a = "d".repeat(64);
        // Exactly what the release workflow writes: binary-mode `*`, a `./`
        // prefix and the bundle subdirectory the artifact lives in.
        let body = format!(
            "{} *./dmg/framexshot_1.3.0_aarch64.dmg\n{} *./deb/framexshot_1.3.0_amd64.deb\n",
            a,
            "e".repeat(64)
        );
        let parsed = parse_checksums(&body);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].1, "framexshot_1.3.0_aarch64.dmg");
        assert_eq!(parsed[1].1, "framexshot_1.3.0_amd64.deb");
    }

    #[test]
    fn test_parse_checksums_skips_junk_lines() {
        let a = "c".repeat(64);
        let body = format!(
            "# comment\n\nnot-a-hash  file.dmg\n{}  good.dmg\n",
            a
        );
        let parsed = parse_checksums(&body);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].1, "good.dmg");
    }

    #[test]
    fn test_verify_checksum_rejects_a_missing_entry() {
        let dir = std::env::temp_dir().join("fxs_verify_missing");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("artifact.dmg");
        std::fs::write(&file, b"payload").unwrap();

        // The checksums list an UNRELATED artifact, so `artifact.dmg` has no
        // published hash. Installing it anyway would mean trusting an
        // unchecksummed download.
        let err = verify_checksum(
            &file,
            "artifact.dmg",
            &format!("{}  other.dmg\n", "a".repeat(64)),
        )
        .unwrap_err();
        assert!(err.contains("no published checksum"), "got: {}", err);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_verify_checksum_rejects_mismatched_payload() {
        let dir = std::env::temp_dir().join("fxs_verify_mismatch");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("artifact.dmg");
        std::fs::write(&file, b"payload").unwrap();

        let err =
            verify_checksum(&file, "artifact.dmg", &format!("{}  artifact.dmg\n", "a".repeat(64)))
                .unwrap_err();
        assert!(err.contains("Checksum mismatch"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_verify_checksum_accepts_matching_payload() {
        use sha2::{Digest, Sha256};
        let dir = std::env::temp_dir().join("fxs_verify_ok");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("artifact.dmg");
        let payload = b"the real payload";
        std::fs::write(&file, payload).unwrap();

        let digest = Sha256::digest(payload);
        let hash: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
        let ok = verify_checksum(&file, "artifact.dmg", &format!("{}  artifact.dmg\n", hash));
        assert!(ok.is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Download the release artifact and the published checksums, verify, and
/// install. Returns once the new version has been put in place.
///
/// Refuses outright when a package manager owns the install (see
/// [`InstallMethod::can_self_update`]) — this is the check that stops Flatpak
/// and deb/rpm installs from being silently clobbered.
pub fn download_and_install(
    version: &str,
    timeout_secs: u64,
) -> AppResult<String> {
    let method = detect_install_method();
    if !method.can_self_update() {
        return Err(format!(
            "This copy was installed by a package manager; update it there instead ({})",
            method
                .manual_update_hint()
                .unwrap_or("see the FrameXShot README")
        ));
    }

    let kind = current_artifact_kind();
    let arch = current_arch_suffix()?;
    let file_name = artifact_file_name(version, kind, &arch)?;
    let base = format!(
        "https://github.com/sahilcodexx/framexshotApp/releases/download/v{}",
        version
    );

    let dir = std::env::temp_dir().join("framexshot-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let artifact_path = dir.join(&file_name);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("FrameXShot-Updater")
        .build()
        .map_err(|e| format!("Could not create HTTP client: {}", e))?;

    // Checksums first and small: fetch them BEFORE the artifact so a release
    // that does not publish a checksum for this file fails in seconds rather
    // than after a 100MB download.
    let checksums = download_text(&client, &format!("{}/checksums.txt", base))?;

    download_to(&client, &format!("{}/{}", base, file_name), &artifact_path)?;

    verify_checksum(&artifact_path, &file_name, &checksums)?;

    run_installer(version)
}

/// Architecture suffix matching the release asset names.
fn current_arch_suffix() -> AppResult<String> {
    Ok(match std::env::consts::ARCH {
        "aarch64" | "arm64" => "aarch64".to_string(),
        "x86_64" | "x64" => "x64".to_string(),
        other => return Err(format!("Unsupported architecture: {}", other)),
    })
}

fn artifact_file_name(version: &str, kind: ArtifactKind, arch: &str) -> AppResult<String> {
    Ok(match kind {
        ArtifactKind::Dmg => format!("framexshot_{}_{}.dmg", version, arch),
        ArtifactKind::Deb => format!("framexshot_{}_{}.deb", version, arch),
        ArtifactKind::Rpm => format!("framexshot_{}_{}.rpm", version, arch),
        // Built but not published (see AGENTS.md Known Issues #5) — listing it
        // here would produce a 404 the user cannot act on.
        ArtifactKind::AppImage => {
            return Err(
                "AppImage builds are not published — use the .deb or the Flatpak bundle".to_string(),
            )
        }
        ArtifactKind::FlatpakBundle => format!("framexshot_{}_{}.flatpak", version, arch),
        ArtifactKind::Unknown => return Err("No update artifact for this platform".to_string()),
    })
}

fn download_text(client: &reqwest::blocking::Client, url: &str) -> AppResult<String> {
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Could not reach {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, response.status()));
    }
    response
        .text()
        .map_err(|e| format!("Could not read {}: {}", url, e))
}

fn download_to(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &std::path::Path,
) -> AppResult<()> {
    use std::io::Write;

    let mut response = client
        .get(url)
        .send()
        .map_err(|e| format!("Could not reach {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, response.status()));
    }

    // Stream to disk rather than buffering the whole artifact in memory — a
    // DMG is hundreds of MB.
    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create {}: {}", dest.display(), e))?;
    std::io::copy(&mut response, &mut file)
        .map_err(|e| format!("Download failed: {}", e))?;
    file.flush().ok();
    Ok(())
}

/// Run the verified artifact's installer.
///
/// `install.sh` already handles the per-OS mechanics (DMG mount + Gatekeeper
/// quarantine on macOS, package install on Linux), so this deliberately does
/// not reimplement them — it just hands off, with the version pinned.
#[cfg(not(target_os = "windows"))]
fn run_installer(version: &str) -> AppResult<String> {
    use std::process::{Command, Stdio};

    // install.sh is not vendored into the binary, so it is fetched from the
    // repo the running build came from — the same trust domain as the release.
    let script = std::env::temp_dir().join("framexshot-update").join("install.sh");
    if !script.exists() {
        let client = reqwest::blocking::Client::builder()
            .user_agent("FrameXShot-Updater")
            .build()
            .map_err(|e| format!("Could not create HTTP client: {}", e))?;
        let url = "https://raw.githubusercontent.com/sahilcodexx/framexshotApp/main/install.sh";
        download_to(&client, url, &script)?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let status = Command::new("sh")
        .arg(&script)
        .env("FXS_VERSION", version)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run installer: {}", e))?;

    if !status.success() {
        return Err(format!("Installer exited with {}", status));
    }

    Ok(format!(
        "FrameXShot {} installed — restart the app to use it",
        version
    ))
}

#[cfg(target_os = "windows")]
fn run_installer(_version: &str) -> AppResult<String> {
    Err("Self-update is not supported on Windows yet — download the installer from the releases page".to_string())
}

#[cfg(test)]
mod artifact_tests {
    use super::*;

    #[test]
    fn test_artifact_file_name_matches_release_assets() {
        // These strings must match release.yml's asset names exactly or the
        // download 404s — they are asserted here because nothing else catches
        // a rename on either side.
        assert_eq!(
            artifact_file_name("1.2.0", ArtifactKind::Dmg, "aarch64").unwrap(),
            "framexshot_1.2.0_aarch64.dmg"
        );
        assert_eq!(
            artifact_file_name("1.2.0", ArtifactKind::Deb, "x64").unwrap(),
            "framexshot_1.2.0_x64.deb"
        );
    }

    #[test]
    fn test_appimage_is_refused_because_it_is_not_published() {
        // Shipping an updater that offers a download which always 404s is
        // worse than not offering it.
        let err = artifact_file_name("1.2.0", ArtifactKind::AppImage, "x64").unwrap_err();
        assert!(err.contains("not published"));
    }

    #[test]
    fn test_windows_has_no_update_artifact() {
        let err = artifact_file_name("1.2.0", ArtifactKind::Unknown, "x64").unwrap_err();
        assert!(err.contains("No update artifact"));
    }

    #[test]
    fn test_current_arch_suffix_is_recognized() {
        assert!(matches!(current_arch_suffix().unwrap().as_str(), "x64" | "aarch64"));
    }
}
