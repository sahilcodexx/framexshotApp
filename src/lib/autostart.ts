import { invoke } from "@tauri-apps/api/core";

export interface AutostartState {
  /** Whether the OS will launch FrameXShot at login. */
  enabled: boolean;
  /** Whether a login launch starts hidden to the tray. */
  startHidden: boolean;
}

/**
 * Read the real launch-at-login state.
 *
 * `enabled` comes from the OS registration rather than our own settings, so a
 * user who revokes autostart in their desktop's startup apps list sees the
 * toggle reflect that. Rejects if the platform refuses to report it — callers
 * should surface that rather than silently defaulting to "off".
 */
export async function getAutostartState(): Promise<AutostartState> {
  const state = await invoke<{
    enabled: boolean;
    start_hidden: boolean;
  }>("get_autostart_state");

  return { enabled: state.enabled, startHidden: state.start_hidden };
}

/**
 * Enable or disable launching at login.
 *
 * Returns the state the OS actually ended up with, which is not always what
 * was asked for — enabling can fail on locked-down desktops.
 */
export async function setAutostart(
  enabled: boolean,
  startHidden: boolean
): Promise<AutostartState> {
  const state = await invoke<{
    enabled: boolean;
    start_hidden: boolean;
  }>("set_autostart", { enabled, startHidden });

  return { enabled: state.enabled, startHidden: state.start_hidden };
}