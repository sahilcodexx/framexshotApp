/**
 * Platform detection helpers.
 *
 * `navigator.userAgent` is the technique already used inline across the app:
 * WebView2 on Windows reports `Windows NT`, WebKitGTK on Linux reports `Linux`,
 * and the WebKit macOS webview reports `Macintosh`. All values are computed
 * once at module load and are safe to read in an SSR/test environment where
 * `navigator` is undefined (they fall back to `false`).
 */

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = /Mac|iPod|iPhone|iPad/.test(ua);

export const isWindows = /Windows/.test(ua);

export const isLinux = /Linux/.test(ua) && !/Android/.test(ua);
