import { invoke } from "@tauri-apps/api/core";

/**
 * How this copy of FrameXShot was installed. Only `portable` may self-update;
 * the others belong to a package manager that would silently undo it.
 */
export type InstallMethod =
  | "portable"
  | "flatpak"
  | "system_package"
  | "homebrew";

export interface UpdateCheck {
  currentVersion: string;
  /** Newer version, or null when already current. */
  latestVersion: string | null;
  updateAvailable: boolean;
  installMethod: InstallMethod;
  canSelfUpdate: boolean;
  /** Shell command to run instead, when a package manager owns the install. */
  manualUpdateHint: string | null;
  artifactKind: string;
}

function fromSnake(raw: {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  install_method: string;
  can_self_update: boolean;
  manual_update_hint: string | null;
  artifact_kind: string;
}): UpdateCheck {
  return {
    currentVersion: raw.current_version,
    latestVersion: raw.latest_version,
    updateAvailable: raw.update_available,
    installMethod: raw.install_method as InstallMethod,
    canSelfUpdate: raw.can_self_update,
    manualUpdateHint: raw.manual_update_hint,
    artifactKind: raw.artifact_kind,
  };
}

/**
 * Ask GitHub for the newest release.
 *
 * Rejects when the network is unavailable rather than returning
 * `updateAvailable: false` — the caller must be able to tell "up to date" from
 * "could not check", otherwise an offline user is shown a false reassurance.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  return fromSnake(await invoke<Parameters<typeof fromSnake>[0]>("check_for_update"));
}

/**
 * Download, verify and install a release.
 *
 * Refuses when a package manager owns this install. The caller is expected to
 * have relaunched only on success.
 */
export async function installUpdate(version: string): Promise<string> {
  return invoke<string>("install_update", { version });
}

/** Restart the app onto the newly installed binary. */
export async function relaunchApp(): Promise<void> {
  await invoke("relaunch_app");
}