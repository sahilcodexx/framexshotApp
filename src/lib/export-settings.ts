import { Channel, invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";

/**
 * Export preferences shared by the editor export, the quick-overlay auto-save
 * and the preferences UI. Persisted in settings.json alongside the other
 * general settings (saveDir, copyToClipboard, …).
 */

export type SaveFormat = "png" | "jpeg" | "webp" | "avif";

export interface ExportPrefs {
  /** Container format for saved files. Clipboard copies always stay PNG. */
  format: SaveFormat;
  /** Encoder quality 1-100 — only used for lossy formats (jpeg/webp). */
  quality: number;
  /** Output size multiplier applied to the composed frame (0.5 / 1 / 2 / 3 / 4). */
  scale: number;
  /**
   * Filename template. Tokens: %date → 2026-10-01, %time → 14-30-05.
   * The extension is appended by the Rust saver from the actual mime type.
   */
  filenameTemplate: string;
}

export const DEFAULT_FILENAME_TEMPLATE = "framexshot %date %time";
export const EXPORT_SCALES = [0.5, 1, 2, 3, 4] as const;
export const MAX_EXPORT_PIXELS = 100_000_000;
export type ExportStage = "rendering" | "preparing" | "resizing" | "estimating" | "encoding" | "saving" | "clipboard";

export function exportDimensions(width: number, height: number, scale: number) {
  const output = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (![width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0
    || !(EXPORT_SCALES as readonly number[]).includes(scale)
    || output.width < 1 || output.height < 1 || output.width * output.height > MAX_EXPORT_PIXELS) {
    throw new Error("This export is too large (maximum 100 megapixels). Choose a smaller scale or crop the screenshot.");
  }
  return output;
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  format: "png",
  quality: 90,
  scale: 1,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
};

const VALID_FORMATS: SaveFormat[] = ["png", "jpeg", "webp", "avif"];

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
    case "avif":
      return "image/avif";
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
 * Reject unsupported browser encoders so a file always matches the selection.
 * AVIF uses the native encoder.
 */
export async function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  prefs: ExportPrefs,
  onProgress?: (stage: ExportStage) => void,
  onEstimate?: (seconds: number) => void
): Promise<{ dataUrl: string; mime: string; sourcePng?: string }> {
  const size = exportDimensions(canvas.width, canvas.height, prefs.scale);
  const requested = mimeForFormat(prefs.format);
  if (prefs.format === "avif") {
    onProgress?.("preparing");
    const { dataUrl: sourcePng } = await canvasToDataUrl(canvas, { ...prefs, format: "png", scale: 1 });
    const channel = new Channel<{ stage: ExportStage; estimatedSeconds?: number }>();
    channel.onmessage = ({ stage, estimatedSeconds }) => {
      onProgress?.(stage);
      if (typeof estimatedSeconds === "number" && Number.isFinite(estimatedSeconds) && estimatedSeconds > 0) onEstimate?.(estimatedSeconds);
    };
    const dataUrl = await invoke<string>("encode_avif", {
      imageData: sourcePng, quality: prefs.quality, scale: prefs.scale, onProgress: channel,
    });
    return { dataUrl, mime: requested, sourcePng };
  }
  let output = canvas;
  try {
    if (prefs.scale !== 1) {
      onProgress?.("resizing");
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      output = document.createElement("canvas");
      output.width = size.width;
      output.height = size.height;
      const ctx = output.getContext("2d");
      if (!ctx) throw new Error("Failed to create export canvas");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, 0, 0, size.width, size.height);
    }
    if (onEstimate && output.width * output.height > 4_000_000) {
      onProgress?.("estimating");
      const sample = document.createElement("canvas");
      sample.width = Math.min(768, output.width);
      sample.height = Math.min(768, output.height);
      try {
        const sampleCtx = sample.getContext("2d");
        if (sampleCtx) {
          sampleCtx.drawImage(output, (output.width - sample.width) / 2, (output.height - sample.height) / 2,
            sample.width, sample.height, 0, 0, sample.width, sample.height);
          const started = performance.now();
          await new Promise<void>((resolve, reject) => sample.toBlob((blob) => {
            if (blob) resolve(); else reject(new Error("Image encoding failed"));
          }, requested, prefs.format === "png" ? undefined : prefs.quality / 100));
          onEstimate(Math.max(0.005, (performance.now() - started) / 1000) * output.width * output.height / (sample.width * sample.height) * 1.2);
        }
      } finally { sample.width = 1; sample.height = 1; }
    }
    onProgress?.("encoding");
    return await new Promise<{ dataUrl: string; mime: string }>((resolve, reject) => {
      output.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas encoding failed"));
            return;
          }
          if (blob.type !== requested) {
            reject(new Error(`This system cannot export ${prefs.format.toUpperCase()}. Choose PNG or another format.`));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({ dataUrl: reader.result as string, mime: blob.type || requested });
          };
          reader.onerror = () => reject(new Error("Failed to read encoded image"));
          reader.readAsDataURL(blob);
        },
        requested,
        prefs.format === "png" ? undefined : prefs.quality / 100
      );
    });
  } finally {
    if (output !== canvas) { output.width = 1; output.height = 1; }
  }
}
