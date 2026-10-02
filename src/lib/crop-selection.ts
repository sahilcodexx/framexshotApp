import type { Annotation, CropRegion, Point } from "@/types/annotations";

/**
 * Geometry for the destructive crop tool.
 *
 * The selection lives in SOURCE IMAGE pixels. The canvas draws in logical
 * frame space (frame coords = source px x imageScale + an offset that depends
 * on padding, layout inset, frame chrome, mockup header and pan), so the two
 * are mapped at the boundary — see `getImageContentRect` in
 * `usePreviewGenerator`.
 *
 * Kept free of React and of the store so it can be unit-tested directly.
 */

/**
 * Resolve which image the editor should be showing.
 *
 * `sourceIndex` 0 is ALWAYS the original capture; index N > 0 is
 * `list[N - 1]`, i.e. the Nth crop. Keeping the original at a fixed index is
 * what makes undo work: an earlier version appended crops starting at index 0,
 * so after the first crop `sourceIndex` was 0 both before and after — undo
 * restored the same index and the image never changed.
 *
 * An index past the end falls back to the original rather than rendering
 * nothing: it can happen legitimately after enough crops (see
 * MAX_SOURCE_CAPTURES) or from a stale redo snapshot.
 */
export function resolveSourcePath(
  crops: string[],
  sourceIndex: number,
  originalPath: string
): string {
  if (sourceIndex <= 0) return originalPath;
  return crops[sourceIndex - 1] ?? originalPath;
}

/** Result of mapping a canvas drag into source-image pixels. */
export function normalizeSelection(
  rect: CropRegion,
  boundsWidth: number,
  boundsHeight: number
): CropRegion | null {
  const rawX0 = Math.min(rect.x, rect.x + rect.width);
  const rawX1 = Math.max(rect.x, rect.x + rect.width);
  const rawY0 = Math.min(rect.y, rect.y + rect.height);
  const rawY1 = Math.max(rect.y, rect.y + rect.height);

  const x0 = Math.max(0, Math.min(rawX0, boundsWidth));
  const x1 = Math.max(0, Math.min(rawX1, boundsWidth));
  const y0 = Math.max(0, Math.min(rawY0, boundsHeight));
  const y1 = Math.max(0, Math.min(rawY1, boundsHeight));

  const width = x1 - x0;
  const height = y1 - y0;
  // Under a pixel is a mis-drag, not a crop.
  if (width < 1 || height < 1) return null;
  // Covering the whole source changes nothing — refuse so the user does not
  // get a Crop button that would burn their undo history for no reason.
  if (width >= boundsWidth && height >= boundsHeight) return null;

  return { x: x0, y: y0, width, height };
}

/**
 * Cut a selection out of a canvas and return the result as a data URL.
 *
 * PNG, always. The cropped image becomes the new editing SOURCE — the base
 * every later preview and export re-renders from — so re-encoding as JPEG
 * would bake lossy artifacts in underneath any subsequent annotation work.
 */
export function cropCanvasToDataUrl(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  selection: CropRegion
): string {
  // Integer bounds: `drawImage` with fractional source rects resamples, which
  // would soften every edge of the new image.
  const x = Math.max(0, Math.round(selection.x));
  const y = Math.max(0, Math.round(selection.y));
  const width = Math.min(sourceWidth, Math.round(selection.width));
  const height = Math.min(sourceHeight, Math.round(selection.height));

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context for crop");

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);

  return out.toDataURL("image/png");
}

/** Axis-aligned bounds of an annotation, in frame coords. */
function annotationBounds(ann: Annotation): { x: number; y: number; right: number; bottom: number } {
  switch (ann.type) {
    case "circle":
      return {
        x: ann.x - ann.radius,
        y: ann.y - ann.radius,
        right: ann.x + ann.radius,
        bottom: ann.y + ann.radius,
      };
    case "rectangle":
    case "blur":
    case "text":
      return {
        x: ann.x,
        y: ann.y,
        right: ann.x + ann.width,
        bottom: ann.y + ann.height,
      };
    case "number":
      return {
        x: ann.x - ann.radius,
        y: ann.y - ann.radius,
        right: ann.x + ann.radius,
        bottom: ann.y + ann.radius,
      };
    case "line":
    case "arrow":
      return {
        x: Math.min(ann.x, ann.endX),
        y: Math.min(ann.y, ann.endY),
        right: Math.max(ann.x, ann.endX),
        bottom: Math.max(ann.y, ann.endY),
      };
    case "pen":
    case "highlighter": {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of ann.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (!ann.points.length) return { x: 0, y: 0, right: 0, bottom: 0 };
      // Grow by half the stroke so a stroke that only just clips the edge is
      // not silently deleted when its centreline is still inside.
      const h = ann.strokeWidth / 2;
      return { x: minX - h, y: minY - h, right: maxX + h, bottom: maxY + h };
    }
  }
}

function translateAnnotation(ann: Annotation, dx: number, dy: number): Annotation {
  const base = {
    ...ann,
    x: ann.x + dx,
    y: ann.y + dy,
  } as Annotation;

  switch (ann.type) {
    case "line":
    case "arrow":
      return {
        ...base,
        endX: ann.endX + dx,
        endY: ann.endY + dy,
        controlPoints: ann.controlPoints?.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        })),
      } as Annotation;
    case "pen":
    case "highlighter":
      return {
        ...base,
        points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      } as Annotation;
    default:
      return base;
  }
}

/**
 * Re-base annotations onto a cropped image.
 *
 * The crop is destructive: the source image shrinks, so the frame recomputes
 * and every annotation's position relative to the image's top-left stays
 * meaningful while its absolute frame position does not. So each annotation is
 * translated by the same delta the image origin moved, and any that fell
 * entirely outside the surviving pixels is dropped — it no longer has
 * anything to point at.
 *
 * `oldOrigin`/`newOrigin` are the image CONTENT top-lefts in frame coords
 * before and after, and `newFrameSize` is the cropped image's rendered size.
 */
export function rebaseAnnotationsForCrop(
  annotations: Annotation[],
  oldOrigin: Point,
  newOrigin: Point,
  newFrameSize: { width: number; height: number }
): Annotation[] {
  const dx = newOrigin.x - oldOrigin.x;
  const dy = newOrigin.y - oldOrigin.y;

  const kept: Annotation[] = [];
  for (const ann of annotations) {
    const moved = translateAnnotation(ann, dx, dy);
    const b = annotationBounds(moved);

    // Fully outside the surviving image — nothing of it would be visible.
    if (b.right <= 0 || b.bottom <= 0 || b.x >= newFrameSize.width || b.y >= newFrameSize.height) {
      continue;
    }
    kept.push(moved);
  }
  return kept;
}