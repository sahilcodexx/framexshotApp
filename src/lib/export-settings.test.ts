import { invoke } from "@tauri-apps/api/core";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildFilenameFromTemplate,
  buildExportFilename,
  DEFAULT_FILENAME_TEMPLATE,
  mimeForFormat,
  canvasToDataUrl,
  DEFAULT_EXPORT_PREFS,
  EXPORT_SCALES,
  exportDimensions,
} from "./export-settings";

describe("buildFilenameFromTemplate", () => {
  const now = new Date(2026, 9, 1, 14, 30, 5); // Oct 1 2026, 14:30:05 local

  it("resolves %date and %time tokens", () => {
    expect(buildFilenameFromTemplate("%date_%time", now)).toBe("2026-10-01_14-30-05");
  });

  it("replaces repeated tokens", () => {
    expect(buildFilenameFromTemplate("%date/%date", now)).toBe("2026-10-01 2026-10-01");
  });

  it("leaves plain text untouched", () => {
    expect(buildFilenameFromTemplate("my shot", now)).toBe("my shot");
  });

  it("strips filesystem-forbidden characters", () => {
    expect(buildFilenameFromTemplate('a/b\\c:d*e?f"g<h>i|j', now)).toBe("a b c d e f g h i j");
  });

  it("collapses whitespace and trims dots", () => {
    expect(buildFilenameFromTemplate("  spaced   out  ", now)).toBe("spaced out");
    // Dots-only names are wiped, then the framexshot fallback applies.
    expect(buildFilenameFromTemplate("...", now)).toBe("framexshot");
  });

  it("falls back to 'framexshot' when nothing usable remains", () => {
    expect(buildFilenameFromTemplate("/\\:*?\"<>|", now)).toBe("framexshot");
  });

  it("caps length at 120 characters", () => {
    expect(buildFilenameFromTemplate("x".repeat(500), now)).toHaveLength(120);
  });
});

describe("buildExportFilename", () => {
  it("is undefined for the default template (Rust default naming stays)", async () => {
    // Store plugin without Tauri backend rejects Store.load — prefs fall back
    // to defaults, whose template is the default one.
    await expect(buildExportFilename()).resolves.toBeUndefined();
  });
});

describe("mimeForFormat", () => {
  it("maps formats to mimes", () => {
    expect(mimeForFormat("png")).toBe("image/png");
    expect(mimeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeForFormat("webp")).toBe("image/webp");
    expect(mimeForFormat("avif")).toBe("image/avif");
  });
});

describe("DEFAULT_FILENAME_TEMPLATE", () => {
  it("contains only known tokens", () => {
    expect(DEFAULT_FILENAME_TEMPLATE).toMatch(/^(%date|%time|[^%])*$/);
  });
});

it("offers 2x, 3x and 4x export sizes", () => {
  expect(EXPORT_SCALES).toEqual(expect.arrayContaining([1, 2, 3, 4]));
});

it("rejects unsupported encoders instead of silently saving a different format", async () => {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
  await expect(canvasToDataUrl(canvas, { ...DEFAULT_EXPORT_PREFS, format: "webp" })).rejects.toThrow("cannot export WEBP");
});

afterEach(() => vi.restoreAllMocks());

it("validates export allocations before creating a canvas", () => {
  expect(exportDimensions(4144, 2464, 3)).toEqual({ width: 12432, height: 7392 });
  expect(() => exportDimensions(4144, 2464, 4)).toThrow("100 megapixels");
  expect(() => exportDimensions(0, 100, 1)).toThrow();
  expect(() => exportDimensions(100, 100, NaN)).toThrow();
});

it("sends one base-sized PNG to native AVIF encoding and forwards real progress", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const toBlob = vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
  const syncEncode = vi.spyOn(canvas, "toDataURL");
  const progress = vi.fn();
  vi.mocked(invoke).mockImplementationOnce(async (_command, args) => {
    const input = args as { scale: number; quality: number; imageData: string; onProgress: { onmessage: (event: { stage: string; estimatedSeconds?: number }) => void } };
    expect(input).toMatchObject({ scale: 3, quality: 90 });
    expect(input.imageData).toMatch(/^data:image\/png;base64,/);
    input.onProgress.onmessage({ stage: "resizing" });
    input.onProgress.onmessage({ stage: "encoding", estimatedSeconds: 20 });
    return "data:image/avif;base64,encoded";
  });
  const estimate = vi.fn();
  const result = await canvasToDataUrl(canvas, { ...DEFAULT_EXPORT_PREFS, format: "avif", scale: 3 }, progress, estimate);
  expect(result.sourcePng).toMatch(/^data:image\/png;base64,/);
  expect(result.mime).toBe("image/avif");
  expect(estimate).toHaveBeenCalledWith(20);
  expect(toBlob).toHaveBeenCalledTimes(1);
  expect(syncEncode).not.toHaveBeenCalled();
  expect([canvas.width, canvas.height]).toEqual([1200, 800]);
  expect(progress.mock.calls.flat()).toEqual(["preparing", "resizing", "encoding"]);
});

it("scales the finished composition once for browser formats and releases the large canvas", async () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 60;
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  let encodedSize: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
    encodedSize = [this.width, this.height];
    callback(new Blob(["png"], { type: "image/png" }));
  });
  await canvasToDataUrl(canvas, { ...DEFAULT_EXPORT_PREFS, scale: 3 });
  expect(encodedSize).toEqual([300, 180]);
  expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 300, 180);
  expect([canvas.width, canvas.height]).toEqual([100, 60]);
});

it.each(["png", "jpeg", "webp"] as const)("calibrates %s time using the selected encoder before encoding the full image", async (format) => {
  const canvas = document.createElement("canvas");
  canvas.width = 3000;
  canvas.height = 2000;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => callback(new Blob(["image"], { type })));
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(500);
  const progress = vi.fn();
  const estimate = vi.fn();
  await canvasToDataUrl(canvas, { ...DEFAULT_EXPORT_PREFS, format }, progress, estimate);
  expect(toBlob).toHaveBeenCalledTimes(2);
  expect(toBlob.mock.calls.every((call) => call[1] === mimeForFormat(format))).toBe(true);
  expect(estimate).toHaveBeenCalledWith(expect.any(Number));
  expect(estimate.mock.calls[0][0]).toBeGreaterThan(0);
  expect(progress.mock.calls.flat()).toEqual(["estimating", "encoding"]);
});
