import { Store } from "@tauri-apps/plugin-store";

/**
 * Export preferences shared by the editor export, the quick-overlay auto-save
 * and the preferences UI. Persisted in settings.json alongside the other
 * general settings (saveDir, copyToClipboard, …).
 */

export type SaveFormat = "png" | "jpeg" | "webp";

export interface ExportPrefs {
  /** Container format for saved files. Clipboard copies always stay PNG. */
  format: SaveFormat;
  /** Encoder quality 1-100 — only used for lossy formats (jpeg/webp). */
  quality: number;
  /** Output size multiplier applied to the composed frame (0.5 / 1 / 2). */
  scale: number;
  /**
   * Filename template. Tokens: %date → 2026-10-01, %time → 14-30-05.
   * The extension is appended by the Rust saver from the actual mime type.
   */
  filenameTemplate: string;
}

export const DEFAULT_FILENAME_TEMPLATE = "framexshot %date %time";
export const EXPORT_SCALES = [0.5, 1, 2] as const;

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  format: "png",
  quality: 90,
  scale: 1,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
};

const VALID_FORMATS: SaveFormat[] = ["png", "jpeg", "webp"];

export async function loadExportPrefs(): Promise<ExportPrefs> {
  try {
    const store = await Store.load("settings.json");
    const format = await store.get<SaveFormat>("saveFormat");
    const quality = await store.get<number>("saveQuality");
    const scale = await store.get<number>("saveScale");
    const filenameTemplate = await store.get<string>("filenameTemplate");
    return {
      format: format && VALID_FORMATS.includes(format) ? format : DEFAULT_EXPORT_PREFS.format,
      quality:
        typeof quality === "number" && quality >= 1 && quality <= 100
          ? Math.round(quality)
          : DEFAULT_EXPORT_PREFS.quality,
      scale:
        typeof scale === "number" && (EXPORT_SCALES as readonly number[]).includes(scale)
          ? scale
          : DEFAULT_EXPORT_PREFS.scale,
      filenameTemplate:
        typeof filenameTemplate === "string" && filenameTemplate.trim()
          ? filenameTemplate
          : DEFAULT_EXPORT_PREFS.filenameTemplate,
    };
  } catch (err) {
    console.warn("Failed to load export prefs, using defaults:", err);
    return { ...DEFAULT_EXPORT_PREFS };
  }
}

export function mimeForFormat(format: SaveFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

/** Resolve the template's tokens and sanitize into a safe base filename. */
export function buildFilenameFromTemplate(template: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const name = template
    .replace(/%date/g, date)
    .replace(/%time/g, time)
    // Strip filesystem-forbidden characters ( / \ : * ? " < > | ) and
    // control bytes — a char-code filter keeps the eslint no-control-regex
    // rule happy while doing the same job as a \x00-\x1f class would.
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(
      /./g,
      (ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch)
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();

  return name || "framexshot";
}

/**
 * Build the filename for the next save from the user's template.
 * Returns undefined when the template is still the default, so the Rust
 * saver keeps generating its timestamped default name (existing behavior).
 */
export async function buildExportFilename(): Promise<string | undefined> {
  const prefs = await loadExportPrefs();
  if (prefs.filenameTemplate.trim() === DEFAULT_FILENAME_TEMPLATE) {
    return undefined;
  }
  return buildFilenameFromTemplate(prefs.filenameTemplate);
}

/**
 * Encode a canvas to a data URL using the user's export format.
 * Returns the mime the encoder ACTUALLY produced — WebKitGTK may not support
 * every requested type and silently falls back to PNG, so callers should
 * trust this over the requested format.
 */
export function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  prefs: ExportPrefs
): Promise<{ dataUrl: string; mime: string }> {
  const requested = mimeForFormat(prefs.format);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas encoding failed"));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve({ dataUrl: reader.result as string, mime: blob.type || requested });
        reader.onerror = () => reject(new Error("Failed to read encoded image"));
        reader.readAsDataURL(blob);
      },
      requested,
      prefs.format === "png" ? undefined : prefs.quality / 100
    );
  });
}
