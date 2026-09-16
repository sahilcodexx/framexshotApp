/**
 * Frame style, layout, border, and shadow presets for the screenshot editor.
 * Inspired by modern screenshot beautifiers (glass frames, tilted layouts, etc.).
 */

import type { ShadowSettings } from "@/stores/editorStore";

// ============================================================================
// Types
// ============================================================================

export type FrameStyleId =
  | "default"
  | "glass-light"
  | "glass-dark"
  | "liquid"
  | "inset-light"
  | "inset-dark"
  | "outline"
  | "border";

export type LayoutPresetId =
  | "flat"
  | "tilt-right"
  | "tilt-left"
  | "tilt-right-down"
  | "float";

export type BorderPresetId = "sharp" | "curved" | "round";

export type ShadowPresetId = "none" | "spread" | "hug" | "adaptive";

export interface LayoutTransform {
  rotateX: number; // degrees — pitch (tilt forward/back)
  rotateY: number; // degrees — yaw (tilt left/right)
  rotateZ: number; // degrees — roll
  scale: number;
}

export interface FrameStyleDef {
  id: FrameStyleId;
  label: string;
  /** Outer padding around the image for the frame chrome */
  padding: number;
  /** Border stroke width */
  strokeWidth: number;
  /** Outer border color */
  strokeColor: string;
  /** Optional second stroke (inner highlight) */
  innerStrokeColor?: string;
  innerStrokeWidth?: number;
  /** Frame fill behind the image (for glass / inset) */
  fillColor?: string;
  /** Soft outer glow color */
  glowColor?: string;
  glowBlur?: number;
  /** Draw a top highlight bar (glass sheen) */
  sheen?: boolean;
  sheenColor?: string;
  /** Inset shadow strength 0–1 */
  insetStrength?: number;
  insetColor?: string;
}

// ============================================================================
// Frame Style Presets
// ============================================================================

export const FRAME_STYLES: FrameStyleDef[] = [
  {
    id: "default",
    label: "Default",
    padding: 0,
    strokeWidth: 0,
    strokeColor: "transparent",
  },
  {
    id: "glass-light",
    label: "Glass Light",
    padding: 10,
    strokeWidth: 1.5,
    strokeColor: "rgba(255,255,255,0.55)",
    innerStrokeColor: "rgba(255,255,255,0.25)",
    innerStrokeWidth: 1,
    fillColor: "rgba(255,255,255,0.12)",
    glowColor: "rgba(255,255,255,0.15)",
    glowBlur: 12,
    sheen: true,
    sheenColor: "rgba(255,255,255,0.35)",
  },
  {
    id: "glass-dark",
    label: "Glass Dark",
    padding: 10,
    strokeWidth: 1.5,
    strokeColor: "rgba(255,255,255,0.18)",
    innerStrokeColor: "rgba(0,0,0,0.35)",
    innerStrokeWidth: 1,
    fillColor: "rgba(20,20,20,0.55)",
    glowColor: "rgba(0,0,0,0.35)",
    glowBlur: 16,
    sheen: true,
    sheenColor: "rgba(255,255,255,0.12)",
  },
  {
    id: "liquid",
    label: "Liquid",
    padding: 14,
    strokeWidth: 2.5,
    strokeColor: "rgba(255,140,40,0.85)",
    innerStrokeColor: "rgba(255,200,100,0.4)",
    innerStrokeWidth: 1,
    fillColor: "rgba(255,120,30,0.08)",
    glowColor: "rgba(255,140,40,0.45)",
    glowBlur: 28,
    sheen: true,
    sheenColor: "rgba(255,200,120,0.3)",
  },
  {
    id: "inset-light",
    label: "Inset Light",
    padding: 8,
    strokeWidth: 1,
    strokeColor: "rgba(0,0,0,0.08)",
    fillColor: "rgba(255,255,255,0.9)",
    insetStrength: 0.35,
    insetColor: "rgba(0,0,0,0.18)",
  },
  {
    id: "inset-dark",
    label: "Inset Dark",
    padding: 8,
    strokeWidth: 1,
    strokeColor: "rgba(255,255,255,0.08)",
    fillColor: "rgba(30,30,30,0.95)",
    insetStrength: 0.5,
    insetColor: "rgba(0,0,0,0.55)",
  },
  {
    id: "outline",
    label: "Outline",
    padding: 4,
    strokeWidth: 2,
    strokeColor: "rgba(255,255,255,0.9)",
  },
  {
    id: "border",
    label: "Border",
    padding: 6,
    strokeWidth: 6,
    strokeColor: "rgba(255,255,255,0.95)",
  },
];

export function getFrameStyle(id: FrameStyleId): FrameStyleDef {
  return FRAME_STYLES.find((s) => s.id === id) ?? FRAME_STYLES[0];
}

// ============================================================================
// Layout Presets (3D-ish tilt)
// ============================================================================

export const LAYOUT_PRESETS: Array<{
  id: LayoutPresetId;
  label: string;
  transform: LayoutTransform;
}> = [
  {
    id: "flat",
    label: "Flat",
    transform: { rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 },
  },
  {
    id: "tilt-right",
    label: "Tilt Right",
    transform: { rotateX: 6, rotateY: -16, rotateZ: 4, scale: 0.92 },
  },
  {
    id: "tilt-left",
    label: "Tilt Left",
    transform: { rotateX: 6, rotateY: 16, rotateZ: -4, scale: 0.92 },
  },
  {
    id: "tilt-right-down",
    label: "Perspective",
    transform: { rotateX: 12, rotateY: -10, rotateZ: 6, scale: 0.9 },
  },
  {
    id: "float",
    label: "Float",
    transform: { rotateX: -4, rotateY: 8, rotateZ: -3, scale: 0.94 },
  },
];

export function getLayoutTransform(id: LayoutPresetId): LayoutTransform {
  return (
    LAYOUT_PRESETS.find((p) => p.id === id)?.transform ??
    LAYOUT_PRESETS[0].transform
  );
}

/** True when the layout needs extra canvas room (non-flat). */
export function isLayoutTransformed(id: LayoutPresetId): boolean {
  return id !== "flat";
}

/**
 * Approximate a 3D perspective transform with a 2D affine matrix.
 * Applied after translating to the image center.
 */
export function applyLayoutTransform(
  ctx: CanvasRenderingContext2D,
  transform: LayoutTransform
) {
  const { rotateX, rotateY, rotateZ, scale } = transform;
  if (rotateX === 0 && rotateY === 0 && rotateZ === 0 && scale === 1) return;

  const rx = (rotateX * Math.PI) / 180;
  const ry = (rotateY * Math.PI) / 180;
  const rz = (rotateZ * Math.PI) / 180;

  // Perspective foreshortening + mild skew for depth
  const scaleX = Math.cos(ry) * scale;
  const scaleY = Math.cos(rx) * scale;
  const skewX = Math.sin(ry) * 0.22;
  const skewY = Math.sin(rx) * 0.18;

  // Roll
  ctx.rotate(rz);
  // Skew + scale for pitch/yaw
  ctx.transform(scaleX, skewY, skewX, scaleY, 0, 0);
}

/**
 * Extra padding needed so a transformed image doesn't clip.
 * Returns a multiplier on half-diagonal.
 */
export function layoutPaddingFactor(id: LayoutPresetId): number {
  if (id === "flat") return 0;
  return 0.18; // ~18% extra on each side
}

// ============================================================================
// Border Presets
// ============================================================================

export const BORDER_PRESETS: Array<{
  id: BorderPresetId;
  label: string;
  /** Absolute radius, or null to mean "fully round" (50% of min side) */
  radius: number | null;
}> = [
  { id: "sharp", label: "Sharp", radius: 0 },
  { id: "curved", label: "Curved", radius: 20 },
  { id: "round", label: "Round", radius: 40 },
];

export function borderRadiusForPreset(
  preset: BorderPresetId,
  customRadius?: number
): number {
  if (customRadius !== undefined && preset === "curved") {
    return customRadius;
  }
  const def = BORDER_PRESETS.find((b) => b.id === preset);
  return def?.radius ?? 12;
}

// ============================================================================
// Shadow Presets
// ============================================================================

export const SHADOW_PRESETS: Array<{
  id: ShadowPresetId;
  label: string;
  shadow: ShadowSettings;
}> = [
  {
    id: "none",
    label: "None",
    shadow: { blur: 0, offsetX: 0, offsetY: 0, opacity: 0 },
  },
  {
    id: "spread",
    label: "Spread",
    shadow: { blur: 48, offsetX: 0, offsetY: 18, opacity: 35 },
  },
  {
    id: "hug",
    label: "Hug",
    shadow: { blur: 16, offsetX: 0, offsetY: 6, opacity: 28 },
  },
  {
    id: "adaptive",
    label: "Adaptive",
    shadow: { blur: 60, offsetX: 12, offsetY: 28, opacity: 42 },
  },
];

export function getShadowPreset(id: ShadowPresetId): ShadowSettings {
  return (
    SHADOW_PRESETS.find((s) => s.id === id)?.shadow ?? SHADOW_PRESETS[1].shadow
  );
}

// ============================================================================
// Canvas drawing: frame chrome around the screenshot
// ============================================================================

/**
 * Draw frame style chrome onto a canvas that already has the clipped image.
 * The canvas is expanded by `style.padding` on each side.
 *
 * @param imageCanvas  The screenshot (+ optional mockup header), already rounded
 * @param style        Frame style definition
 * @param borderRadius Corner radius of the outer frame
 * @returns            New canvas with frame padding + chrome, or the original if default
 */
export function applyFrameStyle(
  imageCanvas: HTMLCanvasElement,
  style: FrameStyleDef,
  borderRadius: number,
  options?: { paddingOverride?: number; opacityFactor?: number }
): HTMLCanvasElement {
  const pad = options?.paddingOverride !== undefined ? options.paddingOverride : style.padding;
  const alpha = options?.opacityFactor !== undefined ? Math.max(0, Math.min(1, options.opacityFactor)) : 1;

  if (style.id === "default" || (pad === 0 && style.strokeWidth === 0)) {
    if (style.id === "default") return imageCanvas;
  }

  const out = document.createElement("canvas");
  out.width = imageCanvas.width + pad * 2;
  out.height = imageCanvas.height + pad * 2;
  const ctx = out.getContext("2d");
  if (!ctx) return imageCanvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const w = out.width;
  const h = out.height;
  const r = Math.min(borderRadius + pad * 0.5, Math.min(w, h) / 2);

  // Outer glow
  if (style.glowColor && style.glowBlur) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = style.glowColor;
    ctx.shadowBlur = style.glowBlur;
    ctx.fillStyle = style.fillColor || "rgba(255,255,255,0.01)";
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  // Frame fill plate
  if (style.fillColor) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = style.fillColor;
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  // Inset shadow (draw dark gradient at edges before image)
  if (style.insetStrength && style.insetStrength > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.clip();
    const inset = style.insetColor || "rgba(0,0,0,0.3)";
    const gradSize = Math.max(12, pad + 8);
    // Top
    let g = ctx.createLinearGradient(0, 0, 0, gradSize);
    g.addColorStop(0, inset);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, gradSize);
    // Left
    g = ctx.createLinearGradient(0, 0, gradSize, 0);
    g.addColorStop(0, inset);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, gradSize, h);
    // Bottom
    g = ctx.createLinearGradient(0, h, 0, h - gradSize);
    g.addColorStop(0, inset);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, h - gradSize, w, gradSize);
    // Right
    g = ctx.createLinearGradient(w, 0, w - gradSize, 0);
    g.addColorStop(0, inset);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(w - gradSize, 0, gradSize, h);
    ctx.restore();
  }

  // Draw the screenshot content (always full opacity)
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(imageCanvas, pad, pad);
  ctx.restore();

  // Outer stroke
  if (style.strokeWidth > 0 && style.strokeColor !== "transparent") {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    roundRectPath(
      ctx,
      style.strokeWidth / 2,
      style.strokeWidth / 2,
      w - style.strokeWidth,
      h - style.strokeWidth,
      Math.max(0, r - style.strokeWidth / 2)
    );
    ctx.stroke();
    ctx.restore();
  }

  // Inner highlight stroke
  if (style.innerStrokeColor && style.innerStrokeWidth) {
    const inset = pad * 0.35 + style.strokeWidth;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style.innerStrokeColor;
    ctx.lineWidth = style.innerStrokeWidth;
    roundRectPath(
      ctx,
      inset,
      inset,
      w - inset * 2,
      h - inset * 2,
      Math.max(0, r - inset)
    );
    ctx.stroke();
    ctx.restore();
  }

  // Top sheen (glass highlight)
  if (style.sheen && style.sheenColor) {
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRectPath(ctx, 0, 0, w, h, r);
    ctx.clip();
    const sheenH = Math.min(h * 0.35, 48 + pad);
    const g = ctx.createLinearGradient(0, 0, 0, sheenH);
    g.addColorStop(0, style.sheenColor);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, sheenH);
    ctx.restore();
  }

  return out;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}
