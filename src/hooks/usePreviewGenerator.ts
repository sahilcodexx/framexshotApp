import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { EditorSettings, useEditorStore } from "@/stores/editorStore";
import { drawAnnotationOnCanvas } from "@/lib/annotation-utils";
import { Annotation } from "@/types/annotations";
import {
  getFrameStyle,
  getLayoutTransform,
  applyFrameStyle,
  applyLayoutTransform,
  layoutPaddingFactor,
  isLayoutTransformed,
  scaleFrameStyle,
} from "@/lib/frame-presets";

import { resolveBackgroundPath, getAssetPath } from "@/lib/asset-registry";
import { gradientOptions } from "@/components/editor/BackgroundSelector";

// Image cache with LRU-like cleanup (max 20 images)
const MAX_CACHE_SIZE = 20;
const imageCache = new Map<string, HTMLImageElement>();
const cacheOrder: string[] = [];

function addToCache(src: string, img: HTMLImageElement) {
  if (imageCache.size >= MAX_CACHE_SIZE) {
    const oldest = cacheOrder.shift();
    if (oldest) {
      imageCache.delete(oldest);
    }
  }
  imageCache.set(src, img);
  cacheOrder.push(src);
}

/**
 * Load an image from a URL, using cache if available
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  if (imageCache.has(src)) {
    return imageCache.get(src)!;
  }

  let finalSrc = src;

  // Convert absolute file system paths or asset protocol URLs to base64 data URIs
  if (!src.startsWith("data:") && !src.startsWith("http:") && !src.startsWith("https:") && (src.startsWith("/") || src.startsWith("asset:") || src.includes("tmp"))) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let filePath = src;
      if (src.startsWith("asset:")) {
        filePath = decodeURIComponent(src.replace(/^asset:\/\/[^/]+\//, "/"));
      }
      finalSrc = await invoke<string>("read_file_as_base64", { path: filePath });
    } catch (e) {
      console.warn("Base64 image conversion failed, falling back to original src:", e);
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();

    if (finalSrc.startsWith("http") || finalSrc.startsWith("asset:")) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      addToCache(src, img);
      resolve(img);
    };

    img.onerror = (event) => {
      const error = new Error(`Failed to load image: ${src}`);
      console.error("Image load error:", { src, event });
      reject(error);
    };

    img.src = finalSrc;
  });
}

/**
 * Get the background image source based on settings
 */
export function getBackgroundImageSrc(settings: EditorSettings): string | null {
  if (settings.backgroundType === "image" && settings.selectedImageSrc) {
    return resolveBackgroundPath(settings.selectedImageSrc);
  }
  if (settings.backgroundType === "gradient") {
    if (settings.gradientSrc) {
      const resolved = resolveBackgroundPath(settings.gradientSrc);
      if (resolved) return resolved;
    }
    if (settings.gradientId) {
      const assetId = settings.gradientId.replace("mesh-", "gradient-");
      const path = getAssetPath(assetId);
      if (path) return path;
    }
    const gradOpt = gradientOptions.find((g) => g.id === settings.gradientId);
    if (gradOpt) return gradOpt.src;
  }
  return null;
}

/**
 * Draw an image onto canvas using cover fitting (maintains aspect ratio, crops overflow)
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
) {
  const imgRatio = img.width / img.height;
  const targetRatio = targetWidth / targetHeight;

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = img.width;
  let sourceHeight = img.height;

  if (imgRatio > targetRatio) {
    sourceWidth = img.height * targetRatio;
    sourceX = (img.width - sourceWidth) / 2;
  } else {
    sourceHeight = img.width / targetRatio;
    sourceY = (img.height - sourceHeight) / 2;
  }

  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );
}

/**
 * Draw background on a canvas context
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: EditorSettings,
  bgImage: HTMLImageElement | null
) {
  switch (settings.backgroundType) {
    case "transparent": {
      break;
    }
    case "white":
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      break;
    case "black":
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      break;
    case "gray":
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(0, 0, width, height);
      break;
    case "gradient":
      if (bgImage) {
        drawImageCover(ctx, bgImage, width, height);
      } else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        const colors = settings.gradientColors || ["#667eea", "#764ba2"];
        gradient.addColorStop(0, colors[0]);
        gradient.addColorStop(1, colors[1]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      break;
    case "custom":
      ctx.fillStyle = settings.customColor;
      ctx.fillRect(0, 0, width, height);
      break;
    case "image":
      if (bgImage) {
        drawImageCover(ctx, bgImage, width, height);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      break;
  }
}


/**
 * Logical (full-resolution) size of the composed frame for the given settings
 * and padding — exactly what renderFullCanvas would produce WITHOUT
 * `maxDimension`. The canvas display layer uses this so the on-screen size and
 * annotation coordinate space stay stable while drag frames render at reduced
 * resolution (900px) and settle frames at full preview resolution (1400px).
 */
export function getFrameDimensions(
  screenshotImage: HTMLImageElement,
  settings: EditorSettings,
  padding: { top: number; bottom: number; left: number; right: number }
): { width: number; height: number } {
  const layoutId = settings.layoutPreset || "flat";
  const extraFactor = layoutPaddingFactor(layoutId);
  const styleDef = getFrameStyle(settings.frameStyle || "default");
  const framePad = (settings.framePadding !== undefined && settings.framePadding >= 0)
    ? settings.framePadding
    : styleDef.padding;
  const scale = settings.imageScale ?? 1.0;
  const scaledWidth = Math.round(screenshotImage.width * scale);
  const scaledHeight = Math.round(screenshotImage.height * scale);
  const extraX = Math.round(scaledWidth * extraFactor);
  const extraY = Math.round(scaledHeight * extraFactor);
  const frame = {
    width:
      scaledWidth + padding.left + padding.right + extraX * 2 + framePad * 2,
    height:
      scaledHeight + padding.top + padding.bottom + extraY * 2 + framePad * 2,
  };

  return frame;
}

/**
 * Normalize a raw crop rect against the frame it must fit inside.
 *
 * Every caller funnels through here so the renderer can treat the result as a
 * plain source rect. Clamping to the frame and normalizing the drag direction
 * (a rect dragged right-to-left arrives with negative width) means no drawing
 * code has to think about inverted or out-of-bounds input.
 *
 * Returns null when nothing would actually be cropped — no selection, or a
 * selection covering the whole frame — so the common case skips the extra
 * canvas allocation entirely.
 */
export interface ImageContentRect {
  /** Where the screenshot's top-left sits inside the logical frame. */
  x: number;
  y: number;
  /** Rendered size of the screenshot, i.e. source size x imageScale. */
  width: number;
  height: number;
  /** `settings.imageScale` — frame px per source-image px. */
  scale: number;
}

/**
 * Where the screenshot sits inside the composed frame.
 *
 * Crop is destructive: the selection is defined on the SOURCE IMAGE, and this
 * is what maps between that and the logical frame space the canvas draws in.
 * Everything that positions the image is derived here exactly as
 * `renderFullCanvas` derives it (layout inset, frame padding, mockup header,
 * pan offset), so the two can never drift — a single source of truth is the
 * whole reason the selection lines up with what the user sees.
 */
export function getImageContentRect(
  screenshotImage: { width: number; height: number },
  settings: EditorSettings,
  padding: { top: number; bottom: number; left: number; right: number }
): ImageContentRect {
  const layoutId = settings.layoutPreset || "flat";
  const extraFactor = layoutPaddingFactor(layoutId);
  const styleDef = getFrameStyle(settings.frameStyle || "default");
  const framePad = settings.framePadding !== undefined && settings.framePadding >= 0
    ? settings.framePadding
    : styleDef.padding;

  const scale = settings.imageScale ?? 1.0;
  const width = Math.round(screenshotImage.width * scale);
  const height = Math.round(screenshotImage.height * scale);

  const extraX = Math.round(width * extraFactor);
  const extraY = Math.round(height * extraFactor);

  // The mockup title bar is drawn INSIDE the framed layer, above the image, so
  // the image content starts below it. Skipping this would shift every crop
  // selection up by 36px whenever a window frame is enabled.
  const frameType =
    settings.showMockup && settings.windowFrame && settings.windowFrame !== "none"
      ? settings.windowFrame
      : "none";
  const headerHeight = frameType === "none" ? 0 : 36;

  return {
    x: padding.left + extraX + framePad + (settings.imageOffsetX ?? 0),
    y: padding.top + extraY + framePad + (settings.imageOffsetY ?? 0) + headerHeight,
    width,
    height,
    scale,
  };
}

/**
 * Frame coords -> source-image pixels.
 *
 * `imageRect.x/y` is the frame position of the image's CONTENT top-left (below
 * the mockup header), so this does not need to know about the header.
 */
export function frameToImagePoint(
  imageRect: ImageContentRect,
  point: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: (point.x - imageRect.x) / imageRect.scale,
    y: (point.y - imageRect.y) / imageRect.scale,
  };
}

/**
 * Source-image pixels -> frame coords.
 */
export function imageToFramePoint(
  imageRect: ImageContentRect,
  point: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: imageRect.x + point.x * imageRect.scale,
    y: imageRect.y + point.y * imageRect.scale,
  };
}

/**
 * Full editor composite: background + effects + framed screenshot + layout + shadow.
 * Shared by live preview and high-quality export so they stay in sync.
 *
 * Pass `maxDimension` to render the whole composite directly at a reduced
 * resolution (used by the live preview): every dimension — padding, image
 * draw size, frame chrome, shadow — is multiplied by the same factor `s`,
 * so the result is identical (up to rounding) to a downscaled full-res
 * render, but at a fraction of the pixel work.
 */
export function renderFullCanvas(
  screenshotImage: HTMLImageElement,
  settings: EditorSettings,
  padding: { top: number; bottom: number; left: number; right: number },
  bgImage: HTMLImageElement | null,
  options: { renderEffects?: boolean; maxDimension?: number; outputScale?: number } = { renderEffects: true }
): HTMLCanvasElement {
  const { top: paddingTop, bottom: paddingBottom, left: paddingLeft, right: paddingRight } = padding;
  const renderEffects = options.renderEffects !== false;
  const layoutId = settings.layoutPreset || "flat";
  const extraFactor = layoutPaddingFactor(layoutId);
  const styleId = settings.frameStyle || "default";
  const styleDef = getFrameStyle(styleId);
  // Use user-overridden padding if set (framePadding >= 0), else fall back to style default
  const framePad = (settings.framePadding !== undefined && settings.framePadding >= 0)
    ? settings.framePadding
    : styleDef.padding;

  const scale = settings.imageScale ?? 1.0;
  const scaledWidth = Math.round(screenshotImage.width * scale);
  const scaledHeight = Math.round(screenshotImage.height * scale);

  const fullExtraX = Math.round(scaledWidth * extraFactor);
  const fullExtraY = Math.round(scaledHeight * extraFactor);
  const fullWidth =
    scaledWidth + paddingLeft + paddingRight + fullExtraX * 2 + framePad * 2;
  const fullHeight =
    scaledHeight + paddingTop + paddingBottom + fullExtraY * 2 + framePad * 2;

  // Uniform output scale: 1 for full-res export, <1 when rendering the live preview.
  const s = options.maxDimension
    ? Math.min(1, options.maxDimension / Math.max(fullWidth, fullHeight))
    : 1;

  // Everything below is computed in OUTPUT space (already multiplied by s).
  const drawW = Math.round(scaledWidth * s);
  const drawH = Math.round(scaledHeight * s);
  const extraX = Math.round(drawW * extraFactor);
  const extraY = Math.round(drawH * extraFactor);
  const padL = paddingLeft * s;
  const padR = paddingRight * s;
  const padT = paddingTop * s;
  const padB = paddingBottom * s;
  const outFramePad = framePad * s;

  const bgWidth = drawW + padL + padR + extraX * 2 + outFramePad * 2;
  const bgHeight = drawH + padT + padB + extraY * 2 + outFramePad * 2;

  const contentPadL = padL + extraX + outFramePad;
  const contentPadT = padT + extraY + outFramePad;

  const canvas = document.createElement("canvas");
  canvas.width = bgWidth;
  canvas.height = bgHeight;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Failed to get canvas context");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const totalPadding = padT + padB + padL + padR;
  if (totalPadding === 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, drawW, drawH, settings.borderRadius * s);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(screenshotImage, 0, 0, drawW, drawH);
    applyImageAdjustments(ctx, 0, 0, drawW, drawH, {
      brightness: settings.brightness ?? 0,
      contrast: settings.contrast ?? 0,
      saturation: settings.saturation ?? 0,
      sharpness: settings.sharpness ?? 0,
    });
    return maybeScaleOutput(canvas, options.outputScale);
  }

  // Background plate
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bgWidth;
  tempCanvas.height = bgHeight;
  const tempCtx = tempCanvas.getContext("2d")!;
  drawBackground(tempCtx, bgWidth, bgHeight, settings, bgImage);

  // Blur radius / noise amplitude scale with `s` too, so the reduced-resolution
  // preview still matches what the full-res export looks like when downscaled.
  if (renderEffects && settings.blurAmount > 0) {
    applyFastBoxBlur(tempCanvas, settings.blurAmount * s);
  }
  if (renderEffects && settings.noiseAmount > 0) {
    applyNoise(tempCanvas, settings.noiseAmount * s);
  }

  ctx.drawImage(tempCanvas, 0, 0);

  const framed = buildFramedScreenshot(screenshotImage, settings, s);
  if (!framed) throw new Error("Failed to build framed screenshot");

  const contentW = framed.width;
  const contentH = framed.height;

  // Independent position offset (pan) on the background canvas
  const offsetX = (settings.imageOffsetX ?? 0) * s;
  const offsetY = (settings.imageOffsetY ?? 0) * s;
  const drawX = contentPadL + offsetX;
  const drawY = contentPadT + offsetY;

  const layout = getLayoutTransform(layoutId);
  const needsTransform = isLayoutTransformed(layoutId);

  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${settings.shadow.opacity / 100})`;
  ctx.shadowBlur = settings.shadow.blur * s;
  ctx.shadowOffsetX = settings.shadow.offsetX * s;
  ctx.shadowOffsetY = settings.shadow.offsetY * s;

  if (needsTransform) {
    const cx = drawX + contentW / 2;
    const cy = drawY + contentH / 2;
    ctx.translate(cx, cy);
    applyLayoutTransform(ctx, layout);
    ctx.drawImage(framed, -contentW / 2, -contentH / 2);
  } else {
    ctx.drawImage(framed, drawX, drawY);
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();

  return maybeScaleOutput(canvas, options.outputScale);
}

/**
 * Apply the user's export scale (0.5× / 1× / 2×) to a finished composite.
 * Runs AFTER all drawing so internal geometry never has to know about it;
 * annotations are drawn by the caller AFTER this, directly at output size.
 */
function maybeScaleOutput(canvas: HTMLCanvasElement, outputScale?: number): HTMLCanvasElement {
  const scale = outputScale ?? 1;
  if (scale === 1 || canvas.width === 0) return canvas;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const octx = out.getContext("2d");
  if (!octx) return canvas;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = scale < 1 ? "high" : "high";
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Build the screenshot layer with optional mockup chrome + frame style chrome.
 * Returns a canvas ready to be drawn (with shadow / layout transform applied by caller).
 * `s` is the output scale (1 = full res); all chrome geometry scales with it.
 */
function buildFramedScreenshot(
  screenshotImage: HTMLImageElement,
  settings: EditorSettings,
  s: number = 1
): HTMLCanvasElement | null {
  const showMockup = settings.showMockup !== false;
  const frameType =
    showMockup && settings.windowFrame && settings.windowFrame !== "none"
      ? settings.windowFrame
      : "none";
  const headerHeight = frameType === "none" ? 0 : Math.max(1, Math.round(36 * s));
  const borderRadius = (settings.borderRadius ?? 12) * s;

  const scale = settings.imageScale ?? 1.0;
  const scaledW = Math.round(screenshotImage.width * scale * s);
  const scaledH = Math.round(screenshotImage.height * scale * s);

  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = scaledW;
  imageCanvas.height = scaledH + headerHeight;
  const imageCtx = imageCanvas.getContext("2d");
  if (!imageCtx) return null;

  imageCtx.imageSmoothingEnabled = true;
  imageCtx.imageSmoothingQuality = "high";

  imageCtx.beginPath();
  imageCtx.roundRect(0, 0, imageCanvas.width, imageCanvas.height, borderRadius);
  imageCtx.closePath();
  imageCtx.clip();

  if (frameType === "macos") {
    imageCtx.fillStyle = "#1e1e1e";
    imageCtx.fillRect(0, 0, imageCanvas.width, headerHeight);

    const circleY = headerHeight / 2;
    const radius = 6 * s;

    imageCtx.beginPath();
    imageCtx.arc(18 * s, circleY, radius, 0, Math.PI * 2);
    imageCtx.fillStyle = "#ff5f56";
    imageCtx.fill();

    imageCtx.beginPath();
    imageCtx.arc(36 * s, circleY, radius, 0, Math.PI * 2);
    imageCtx.fillStyle = "#ffbd2e";
    imageCtx.fill();

    imageCtx.beginPath();
    imageCtx.arc(54 * s, circleY, radius, 0, Math.PI * 2);
    imageCtx.fillStyle = "#27c93f";
    imageCtx.fill();
  } else if (frameType === "windows") {
    imageCtx.fillStyle = "#202020";
    imageCtx.fillRect(0, 0, imageCanvas.width, headerHeight);

    imageCtx.strokeStyle = "#cccccc";
    imageCtx.lineWidth = Math.max(0.5, 1.5 * s);
    const rightX = imageCanvas.width - 20 * s;

    imageCtx.beginPath();
    imageCtx.moveTo(rightX - 6 * s, headerHeight / 2 - 4 * s);
    imageCtx.lineTo(rightX + 2 * s, headerHeight / 2 + 4 * s);
    imageCtx.moveTo(rightX + 2 * s, headerHeight / 2 - 4 * s);
    imageCtx.lineTo(rightX - 6 * s, headerHeight / 2 + 4 * s);
    imageCtx.stroke();
  }

  // Draw screenshot image scaled to scaledW x scaledH — no cropping!
  imageCtx.drawImage(screenshotImage, 0, headerHeight, scaledW, scaledH);

  // Apply pixel-level image adjustments (brightness, contrast, saturation, sharpness)
  applyImageAdjustments(imageCtx, 0, headerHeight, scaledW, scaledH, {
    brightness: settings.brightness ?? 0,
    contrast: settings.contrast ?? 0,
    saturation: settings.saturation ?? 0,
    sharpness: settings.sharpness ?? 0,
  });

  // Apply glass / inset / outline / border frame chrome
  const frameStyle = getFrameStyle(settings.frameStyle || "default");
  const framePaddingOverride = (settings.framePadding !== undefined && settings.framePadding >= 0)
    ? settings.framePadding * s
    : undefined;
  const opacityFactor = (settings.frameOpacity !== undefined)
    ? settings.frameOpacity / 100
    : 1;
  return applyFrameStyle(imageCanvas, scaleFrameStyle(frameStyle, s), borderRadius, {
    paddingOverride: framePaddingOverride,
    opacityFactor,
  });
}

/**
 * Fast box blur approximation — O(n) sliding window, multi-pass
 */
function applyFastBoxBlur(canvas: HTMLCanvasElement, radius: number) {
  if (radius <= 0) return;

  const passes = Math.min(Math.ceil(radius / 15) + 1, 3);
  const boxRadius = Math.floor(radius / passes);
  if (boxRadius <= 0) return;

  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  const kernelSize = boxRadius * 2 + 1;

  for (let pass = 0; pass < passes; pass++) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const tempData = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let x = 0; x < width; x++) {
        if (x === 0) {
          for (let kx = -boxRadius; kx <= boxRadius; kx++) {
            const px = Math.max(0, Math.min(width - 1, kx));
            const idx = (y * width + px) * 4;
            rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2]; aSum += data[idx + 3];
          }
        } else {
          const removeX = Math.max(0, Math.min(width - 1, x - boxRadius - 1));
          const addX = Math.max(0, Math.min(width - 1, x + boxRadius));
          const removeIdx = (y * width + removeX) * 4;
          const addIdx = (y * width + addX) * 4;
          rSum = rSum - data[removeIdx] + data[addIdx];
          gSum = gSum - data[removeIdx + 1] + data[addIdx + 1];
          bSum = bSum - data[removeIdx + 2] + data[addIdx + 2];
          aSum = aSum - data[removeIdx + 3] + data[addIdx + 3];
        }
        const idx = (y * width + x) * 4;
        tempData[idx] = rSum / kernelSize | 0;
        tempData[idx + 1] = gSum / kernelSize | 0;
        tempData[idx + 2] = bSum / kernelSize | 0;
        tempData[idx + 3] = aSum / kernelSize | 0;
      }
    }

    const finalData = new Uint8ClampedArray(tempData);
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let y = 0; y < height; y++) {
        if (y === 0) {
          for (let ky = -boxRadius; ky <= boxRadius; ky++) {
            const py = Math.max(0, Math.min(height - 1, ky));
            const idx = (py * width + x) * 4;
            rSum += tempData[idx]; gSum += tempData[idx + 1]; bSum += tempData[idx + 2]; aSum += tempData[idx + 3];
          }
        } else {
          const removeY = Math.max(0, Math.min(height - 1, y - boxRadius - 1));
          const addY = Math.max(0, Math.min(height - 1, y + boxRadius));
          const removeIdx = (removeY * width + x) * 4;
          const addIdx = (addY * width + x) * 4;
          rSum = rSum - tempData[removeIdx] + tempData[addIdx];
          gSum = gSum - tempData[removeIdx + 1] + tempData[addIdx + 1];
          bSum = bSum - tempData[removeIdx + 2] + tempData[addIdx + 2];
          aSum = aSum - tempData[removeIdx + 3] + tempData[addIdx + 3];
        }
        const idx = (y * width + x) * 4;
        finalData[idx] = rSum / kernelSize | 0;
        finalData[idx + 1] = gSum / kernelSize | 0;
        finalData[idx + 2] = bSum / kernelSize | 0;
        finalData[idx + 3] = aSum / kernelSize | 0;
      }
    }
    ctx.putImageData(new ImageData(finalData, width, height), 0, 0);
  }
}

/**
 * Apply noise effect to a canvas in place
 */
function applyNoise(canvas: HTMLCanvasElement, noiseAmount: number) {
  if (noiseAmount <= 0) return;

  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const noiseIntensity = noiseAmount * 2.55;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const noise = (Math.random() - 0.5) * noiseIntensity;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply Brightness, Contrast, Saturation, and Sharpness directly to canvas pixel buffer.
 * Pure pixel manipulation — 100% compatible with Linux WebKit2GTK, Tauri, Chrome, Firefox.
 */
function applyImageAdjustments(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  adjustments: {
    brightness: number; // -100 to 100
    contrast: number;   // -100 to 100
    saturation: number; // -100 to 100
    sharpness: number;  // 0 to 100
  }
) {
  const { brightness, contrast, saturation, sharpness } = adjustments;

  if (brightness === 0 && contrast === 0 && saturation === 0 && sharpness === 0) {
    return;
  }

  const w = Math.round(width);
  const h = Math.round(height);
  const startX = Math.round(x);
  const startY = Math.round(y);

  if (w <= 0 || h <= 0) return;

  try {
    const imageData = ctx.getImageData(startX, startY, w, h);
    const data = imageData.data;
    const len = data.length;

    const contrastClamped = Math.max(-99, Math.min(99, contrast));
    const cFactor = (259 * (contrastClamped + 255)) / (255 * (259 - contrastClamped));
    const bOffset = (brightness / 100) * 255;
    const sFactor = (saturation + 100) / 100;

    const hasColorAdjustments = brightness !== 0 || contrast !== 0 || saturation !== 0;

    if (hasColorAdjustments) {
      for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. Brightness
        if (brightness !== 0) {
          r += bOffset;
          g += bOffset;
          b += bOffset;
        }

        // 2. Contrast
        if (contrast !== 0) {
          r = cFactor * (r - 128) + 128;
          g = cFactor * (g - 128) + 128;
          b = cFactor * (b - 128) + 128;
        }

        // 3. Saturation
        if (saturation !== 0) {
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = gray + sFactor * (r - gray);
          g = gray + sFactor * (g - gray);
          b = gray + sFactor * (b - gray);
        }

        // Clamp to valid range [0, 255]
        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }

    // 4. Sharpness (Unsharp Mask Convolution)
    if (sharpness > 0) {
      const src = new Uint8ClampedArray(data);
      const a = (sharpness / 100) * 0.45;
      const centerWeight = 1 + 4 * a;

      for (let py = 1; py < h - 1; py++) {
        const rowOffset = py * w;
        const topOffset = (py - 1) * w;
        const bottomOffset = (py + 1) * w;

        for (let px = 1; px < w - 1; px++) {
          const i = (rowOffset + px) * 4;
          const iTop = (topOffset + px) * 4;
          const iBottom = (bottomOffset + px) * 4;
          const iLeft = (rowOffset + px - 1) * 4;
          const iRight = (rowOffset + px + 1) * 4;

          const sr = src[i] * centerWeight - a * (src[iTop] + src[iBottom] + src[iLeft] + src[iRight]);
          data[i] = sr < 0 ? 0 : sr > 255 ? 255 : sr;

          const sg = src[i + 1] * centerWeight - a * (src[iTop + 1] + src[iBottom + 1] + src[iLeft + 1] + src[iRight + 1]);
          data[i + 1] = sg < 0 ? 0 : sg > 255 ? 255 : sg;

          const sb = src[i + 2] * centerWeight - a * (src[iTop + 2] + src[iBottom + 2] + src[iLeft + 2] + src[iRight + 2]);
          data[i + 2] = sb < 0 ? 0 : sb > 255 ? 255 : sb;
        }
      }
    }

    ctx.putImageData(imageData, startX, startY);
  } catch (err) {
    console.warn("Failed to apply image adjustments:", err);
  }
}

export interface PreviewGeneratorOptions {
  screenshotImage: HTMLImageElement | null;
  settings: EditorSettings;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  imagePath?: string;
}

export interface PreviewGeneratorResult {
  previewUrl: string | null;
  isGenerating: boolean;
  error: string | null;
  renderHighQualityCanvas: (
    annotations: Annotation[],
    imagePath?: string,
    opts?: { outputScale?: number }
  ) => Promise<HTMLCanvasElement | null>;
}

const PREVIEW_DEBOUNCE_MS = 16;
const EFFECTS_IDLE_MS = 200;
const DRAG_THROTTLE_MS = 34;
/** Live preview is composited at this max dimension — see renderFullCanvas. */
const MAX_PREVIEW_DIM = 1400;
/** During a slider drag the preview drops to this max dimension — render +
 * JPEG-encode cost scales with pixel area, and a slightly softer frame that
 * tracks the cursor beats a crisp one that stutters. The settle render
 * (effects on, 1400px) restores full detail ~150ms after the drag ends. */
const DRAG_PREVIEW_DIM = 900;
/** Slightly softer JPEG during drags for the same reason. */
const DRAG_JPEG_QUALITY = 0.72;
const PREVIEW_JPEG_QUALITY = 0.8;

/**
 * Hook for generating preview images based on editor settings
 * Optimized: blur/noise only render when slider settles (idle >200ms)
 */
export function usePreviewGenerator({
  screenshotImage,
  settings,
  canvasRef,
  paddingTop = 100,
  paddingBottom = 100,
  paddingLeft = 100,
  paddingRight = 100,
  imagePath: _imagePath,
}: PreviewGeneratorOptions): PreviewGeneratorResult {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrlRef = useRef<string | null>(null);
  const renderIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRegenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<EditorSettings | null>(null);
  const renderEffectsRef = useRef(false);
  // Serialized settings at the last drag-frame render — the drag loop's
  // change detector (skips renders when nothing moved).
  const lastDragRenderKeyRef = useRef<string | null>(null);

  // Memoize background-related settings for comparison
  const bgSettingsKey = useMemo(() => {
    return JSON.stringify({
      backgroundType: settings.backgroundType,
      selectedImageSrc: settings.selectedImageSrc,
      gradientId: settings.gradientId,
      gradientSrc: settings.gradientSrc,
      customColor: settings.customColor,
    });
  }, [
    settings.backgroundType,
    settings.selectedImageSrc,
    settings.gradientId,
    settings.gradientSrc,
    settings.customColor,
  ]);

  // Core render function
  const generatePreview = useCallback(async (settingsToRender: EditorSettings) => {
    if (!screenshotImage || !canvasRef.current) return;

    const currentRenderId = ++renderIdRef.current;
    const canvas = canvasRef.current;
    const shouldRenderEffects = renderEffectsRef.current;
    // Snapshot at render start. Drag frames render at reduced resolution +
    // quality and skip the isGenerating state flips (two host re-renders of
    // the whole editor per frame was pure waste — nothing reads the spinner
    // during a drag); the settle render restores full detail.
    const dragging = useEditorStore.getState()._isDragging;

    if (!dragging) {
      setIsGenerating(true);
    }
    setError(null);

    try {
      const bgSrc = getBackgroundImageSrc(settingsToRender);
      let bgImage: HTMLImageElement | null = null;
      if (bgSrc) {
        bgImage = await loadImage(bgSrc);
      }

      if (currentRenderId !== renderIdRef.current) return;

      // Padding comes from the settings object being rendered, not the
      // hook's last-render closure. The drag loop calls this with the
      // latest pending settings; a closed-over padding value would freeze
      // the preview at whatever padding the drag started with.
      const rendered = renderFullCanvas(
        screenshotImage,
        settingsToRender,
        {
          top: settingsToRender.paddingTop,
          bottom: settingsToRender.paddingBottom,
          left: settingsToRender.paddingLeft,
          right: settingsToRender.paddingRight,
        },
        bgImage,
        {
          renderEffects: shouldRenderEffects,
          maxDimension: shouldRenderEffects ? MAX_PREVIEW_DIM : DRAG_PREVIEW_DIM,
        }
      );

      if (currentRenderId !== renderIdRef.current) return;

      // `rendered` is already at preview resolution (≤ MAX_PREVIEW_DIM) —
      // the composite ran scaled end-to-end (padding, chrome, shadow, and all)
      // instead of rendering full-res and downscaling afterwards. Keeps slider
      // dragging and zooming ultra-smooth at a fraction of the pixel work.
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) {
        setError("Failed to get canvas context");
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(rendered, 0, 0);

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      const url = canvas.toDataURL(
        "image/jpeg",
        shouldRenderEffects ? PREVIEW_JPEG_QUALITY : DRAG_JPEG_QUALITY
      );
      previewUrlRef.current = url;
      setPreviewUrl(url);
      if (!dragging) {
        setIsGenerating(false);
      }
    } catch (err) {
      if (currentRenderId === renderIdRef.current) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Preview generation failed: ${message}`);
        setIsGenerating(false);
        console.error("Preview generation failed:", err);
      }
    }
  }, [screenshotImage, canvasRef]);

  // Keep the LATEST generatePreview reachable from store subscriptions and
  // timers. Padding is read from the settings object passed in, so a stale
  // closure cannot freeze the preview at the drag-start padding.
  const generatePreviewRef = useRef(generatePreview);
  useEffect(() => {
    generatePreviewRef.current = generatePreview;
  });

  // Keep `pendingSettingsRef` pointed at the latest settings on every render.
  //
  // This assignment used to live at the top of the big debounce effect below,
  // which made `settings` — a fresh object each render — a dependency of that
  // effect. Satisfying the linter by adding it there would have re-run the whole
  // debounce/throttle setup on every single render, defeating the fine-grained
  // `settings.*` dependency list that exists precisely to avoid regenerating the
  // preview when an unrelated field changes. Splitting the ref sync into its own
  // always-running effect keeps the ref current for the timers below without
  // coupling them to object identity.
  useEffect(() => {
    pendingSettingsRef.current = settings;
  });

  // Debounced preview generation + idle detection for effects (non-drag path).
  // While a slider is being dragged this effect deliberately does nothing:
  // rendering is owned by the drag regen loop subscribed below. This effect's
  // cleanup fires on every per-pixel settings update, so any drag timer created
  // here would be cleared on the very next pixel — the preview would freeze
  // mid-drag and only jump once the drag ends.
  useEffect(() => {
    if (!screenshotImage || !canvasRef.current) return;
    if (useEditorStore.getState()._isDragging) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Reset effects flag on every settings change; the idle timer below
    // re-enables them once the user stops moving.
    renderEffectsRef.current = false;

    // After 200ms of no changes, enable effects and re-render
    if (effectsTimerRef.current) {
      clearTimeout(effectsTimerRef.current);
    }
    effectsTimerRef.current = setTimeout(() => {
      // A drag may have started after this timer was armed (settings change
      // → drag start within 200ms). Rendering with effects at full res
      // mid-drag would jank the gesture; the falling-edge handler renders
      // the settled frame anyway.
      if (useEditorStore.getState()._isDragging) return;
      renderEffectsRef.current = true;
      if (pendingSettingsRef.current) {
        generatePreview(pendingSettingsRef.current);
      }
    }, EFFECTS_IDLE_MS);

    debounceTimerRef.current = setTimeout(() => {
      if (pendingSettingsRef.current) {
        generatePreview(pendingSettingsRef.current);
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (effectsTimerRef.current) clearTimeout(effectsTimerRef.current);
    };
  }, [
    screenshotImage,
    bgSettingsKey,
    settings.blurAmount,
    settings.noiseAmount,
    settings.borderRadius,
    settings.shadow.blur,
    settings.shadow.offsetX,
    settings.shadow.offsetY,
    settings.shadow.opacity,
    settings.windowFrame,
    settings.frameStyle,
    settings.layoutPreset,
    settings.borderPreset,
    settings.shadowPreset,
    settings.showMockup,
    settings.framePadding,
    settings.frameOpacity,
    settings.imageScale,
    settings.imageOffsetX,
    settings.imageOffsetY,
    settings.sharpness,
    settings.brightness,
    settings.contrast,
    settings.saturation,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    canvasRef,
    generatePreview,
  ]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // Drag regen loop — lives in a store subscription on the `_isDragging`
  // edges, NOT in the settings effect above (that effect's cleanup runs on
  // every per-pixel settings update and would cancel the loop's timer after
  // the first drag pixel, freezing the preview until release). While dragging,
  // the loop regenerates the preview whenever the settings actually changed
  // (checked every DRAG_THROTTLE_MS), with effects disabled — blur/noise are
  // too expensive per-pixel and are re-added when the drag settles. It always
  // calls the latest `generatePreview` through the ref above, so padding and
  // other settings are never stale, and re-arms on a recursive setTimeout —
  // not setInterval — so a slow render never queues overlapping renders.
  useEffect(() => {
    const startRegenLoop = () => {
      if (dragRegenTimerRef.current) {
        clearTimeout(dragRegenTimerRef.current);
        dragRegenTimerRef.current = null;
      }
      // Effects (blur/noise) are too heavy to include while tracking the cursor.
      renderEffectsRef.current = false;
      // Baseline for the change check — do not re-render the frame the rising
      // edge itself is about to be rendered for.
      lastDragRenderKeyRef.current = pendingSettingsRef.current
        ? JSON.stringify(pendingSettingsRef.current)
        : null;
      const regenLoop = () => {
        if (!useEditorStore.getState()._isDragging) {
          dragRegenTimerRef.current = null;
          return;
        }
        // Render only when something actually changed. A pointer that is down
        // but not moving (or a committed slider pause mid-gesture) previously
        // re-rendered the identical frame every tick — pure wasted main-thread
        // time competing with the interaction itself.
        const pending = pendingSettingsRef.current;
        if (generatePreviewRef.current && pending) {
          const key = JSON.stringify(pending);
          if (key !== lastDragRenderKeyRef.current) {
            lastDragRenderKeyRef.current = key;
            generatePreviewRef.current(pending);
          }
        }
        dragRegenTimerRef.current = setTimeout(regenLoop, DRAG_THROTTLE_MS);
      };
      regenLoop();
    };

    const stopRegenLoopAndRender = () => {
      // Drag just ended — cancel the throttled regen, then render the latest
      // settings now with effects enabled (blur/noise/contrast show up too).
      if (dragRegenTimerRef.current) {
        clearTimeout(dragRegenTimerRef.current);
        dragRegenTimerRef.current = null;
      }
      renderEffectsRef.current = true;
      if (generatePreviewRef.current && pendingSettingsRef.current) {
        generatePreviewRef.current(pendingSettingsRef.current);
      }
    };

    const unsub = useEditorStore.subscribe(
      (state) => state._isDragging,
      (isDragging) => {
        if (isDragging) {
          startRegenLoop();
        } else {
          stopRegenLoopAndRender();
        }
      }
    );
    return () => {
      unsub();
      if (dragRegenTimerRef.current) {
        clearTimeout(dragRegenTimerRef.current);
        dragRegenTimerRef.current = null;
      }
    };
  }, []);

  // High quality canvas render for save/copy — same pipeline as preview.
  // `outputScale` (from the user's export prefs) resizes the composite and
  // annotations are drawn to match, so a 2x export stays sharp.
  const renderHighQualityCanvas = useCallback(
    async (
      annotations: Annotation[],
      _imagePath?: string,
      opts?: { outputScale?: number }
    ): Promise<HTMLCanvasElement | null> => {
      if (!screenshotImage) return null;

      try {
        const bgSrc = getBackgroundImageSrc(settings);
        let bgImage: HTMLImageElement | null = null;
        if (bgSrc) {
          bgImage = await loadImage(bgSrc);
        }

        const outputScale = opts?.outputScale ?? 1;
        const canvas = renderFullCanvas(
          screenshotImage,
          settings,
          {
            top: settings.paddingTop,
            bottom: settings.paddingBottom,
            left: settings.paddingLeft,
            right: settings.paddingRight,
          },
          bgImage,
          { renderEffects: true, outputScale }
        );

        if (annotations.length > 0) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Annotations live in the LOGICAL frame space; scale them onto the
            // output-sized canvas. blur drops to device space internally with
            // frameScale = outputScale.
            ctx.save();
            if (outputScale !== 1) {
              ctx.scale(outputScale, outputScale);
            }
            const nonText = annotations.filter((a) => a.type !== "text");
            const textAnns = annotations.filter((a) => a.type === "text");
            nonText.forEach((annotation) => {
              drawAnnotationOnCanvas(ctx, annotation, { frameScale: outputScale, uiScale: 1 });
            });
            textAnns.forEach((annotation) => {
              drawAnnotationOnCanvas(ctx, annotation, { frameScale: outputScale, uiScale: 1 });
            });
            ctx.restore();
          }
        }

        return canvas;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to render high-quality image: ${message}`);
        return null;
      }
    },
    [screenshotImage, settings]
  );

  return {
    previewUrl,
    isGenerating,
    error,
    renderHighQualityCanvas,
  };
}
