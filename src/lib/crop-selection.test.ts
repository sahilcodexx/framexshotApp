import { describe, it, expect } from "vitest";
import {
  normalizeSelection,
  rebaseAnnotationsForCrop,
  resolveSourcePath,
} from "./crop-selection";
import type { Annotation, Color } from "@/types/annotations";

const FILL: Color = { hex: "#FF0000", opacity: 100 };

function makeBase(id: string, type: Annotation["type"], x: number, y: number) {
  return {
    id,
    type,
    x,
    y,
    fill: FILL,
    border: { width: 0, color: FILL },
    alignment: { horizontal: "left" as const, vertical: "top" as const },
  };
}

describe("normalizeSelection", () => {
  const W = 1000;
  const H = 800;

  it("returns null for no selection", () => {
    // normalizeSelection only ever receives a rect; a zero-size one is the
    // programmatic equivalent of "no selection".
    expect(normalizeSelection({ x: 0, y: 0, width: 0, height: 0 }, W, H)).toBeNull();
  });

  it("passes a valid in-bounds rect through unchanged", () => {
    const rect = { x: 100, y: 50, width: 400, height: 300 };
    expect(normalizeSelection(rect, W, H)).toEqual(rect);
  });

  it("normalizes an inverted rect (right-to-left drag)", () => {
    expect(
      normalizeSelection({ x: 500, y: 400, width: -400, height: -300 }, W, H)
    ).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  });

  it("clamps a rect extending past the image", () => {
    expect(
      normalizeSelection({ x: 900, y: 700, width: 500, height: 500 }, W, H)
    ).toEqual({ x: 900, y: 700, width: 100, height: 100 });
  });

  it("clamps negative origins to zero", () => {
    expect(
      normalizeSelection({ x: -50, y: -30, width: 200, height: 200 }, W, H)
    ).toEqual({ x: 0, y: 0, width: 150, height: 170 });
  });

  it("rejects a whole-image selection (cropping it would change nothing)", () => {
    expect(
      normalizeSelection({ x: 0, y: 0, width: W, height: H }, W, H)
    ).toBeNull();
    // Oversized but clamped down to the full image — same outcome.
    expect(
      normalizeSelection({ x: -10, y: -10, width: 2000, height: 2000 }, W, H)
    ).toBeNull();
  });

  it("rejects sub-pixel rects", () => {
    expect(normalizeSelection({ x: 10, y: 10, width: 0.4, height: 200 }, W, H)).toBeNull();
  });

  it("rejects a rect entirely outside the image", () => {
    expect(
      normalizeSelection({ x: 2000, y: 2000, width: 100, height: 100 }, W, H)
    ).toBeNull();
  });
});

describe("rebaseAnnotationsForCrop", () => {
  const oldOrigin = { x: 100, y: 100 };
  const newOrigin = { x: 40, y: 40 };
  const newFrameSize = { width: 400, height: 300 };

  it("translates every annotation by the origin delta", () => {
    const rect: Annotation = {
      ...makeBase("r", "rectangle", 150, 150),
      type: "rectangle",
      width: 50,
      height: 50,
    };
    const [moved] = rebaseAnnotationsForCrop([rect], oldOrigin, newOrigin, newFrameSize);
    // 150 - 100 + 40 = 90
    expect(moved.x).toBe(90);
    expect(moved.y).toBe(90);
  });

  it("translates line endpoints and control points", () => {
    const line: Annotation = {
      ...makeBase("l", "line", 120, 120),
      type: "line",
      endX: 300,
      endY: 260,
      controlPoints: [{ x: 200, y: 180 }],
    };
    const [moved] = rebaseAnnotationsForCrop([line], oldOrigin, newOrigin, newFrameSize);
    expect(moved).toMatchObject({
      x: 60,
      y: 60,
      endX: 240,
      endY: 200,
      controlPoints: [{ x: 140, y: 120 }],
    });
  });

  it("translates every point of a freehand stroke", () => {
    const pen: Annotation = {
      ...makeBase("p", "pen", 130, 130),
      type: "pen",
      strokeWidth: 10,
      points: [
        { x: 130, y: 130 },
        { x: 220, y: 190 },
      ],
    };
    const [moved] = rebaseAnnotationsForCrop([pen], oldOrigin, newOrigin, newFrameSize);
    expect(moved).toMatchObject({
      points: [
        { x: 70, y: 70 },
        { x: 160, y: 130 },
      ],
    });
  });

  it("keeps an annotation that is only partly inside", () => {
    // Starts inside the surviving region, extends past its right edge.
    const rect: Annotation = {
      ...makeBase("r", "rectangle", 350, 100),
      type: "rectangle",
      width: 200,
      height: 50,
    };
    const kept = rebaseAnnotationsForCrop([rect], oldOrigin, newOrigin, newFrameSize);
    expect(kept).toHaveLength(1);
    expect(kept[0].x).toBe(290);
  });

  it("drops an annotation entirely outside the crop", () => {
    // Was far down-right of the image origin; after the crop that area is gone.
    const rect: Annotation = {
      ...makeBase("r", "rectangle", 900, 700),
      type: "rectangle",
      width: 50,
      height: 50,
    };
    expect(rebaseAnnotationsForCrop([rect], oldOrigin, newOrigin, newFrameSize)).toHaveLength(0);
  });

  it("keeps a circle whose centre survives even when its edge does not", () => {
    const circle: Annotation = {
      ...makeBase("c", "circle", 405, 150),
      type: "circle",
      radius: 20,
    };
    // Centre lands at 345,150 — inside a 400x300 crop — but it spans to 365,
    // still inside. A radius 400 circle centred at 390 would be clipped, not
    // deleted.
    expect(rebaseAnnotationsForCrop([circle], oldOrigin, newOrigin, newFrameSize)).toHaveLength(1);
  });

  it("does not drop a freehand stroke that merely grazes the new edge", () => {
    // Centreline is at x=360 with a 40px stroke, so the right half falls
    // outside a 400px-wide crop. The stroke is still half-visible.
    const pen: Annotation = {
      ...makeBase("p", "pen", 300, 150),
      type: "pen",
      strokeWidth: 40,
      points: [{ x: 300, y: 150 }],
    };
    const kept = rebaseAnnotationsForCrop([pen], oldOrigin, newOrigin, newFrameSize);
    expect(kept).toHaveLength(1);
  });

  it("returns annotations unchanged when the origin does not move", () => {
    const rect: Annotation = {
      ...makeBase("r", "rectangle", 150, 150),
      type: "rectangle",
      width: 50,
      height: 50,
    };
    // Same origin on both sides => zero delta => nothing moves.
    const kept = rebaseAnnotationsForCrop([rect], oldOrigin, oldOrigin, {
      width: 1000,
      height: 1000,
    });
    expect(kept[0].x).toBe(150);
    expect(kept[0].y).toBe(150);
  });

  it("applies the exact origin delta", () => {
    // Guards the arithmetic itself: oldOrigin -> newOrigin is (-60, -60), so
    // an annotation at (150, 150) must land at (90, 90).
    const rect: Annotation = {
      ...makeBase("r", "rectangle", 150, 150),
      type: "rectangle",
      width: 50,
      height: 50,
    };
    const [moved] = rebaseAnnotationsForCrop([rect], oldOrigin, newOrigin, newFrameSize);
    expect(moved.x).toBe(90);
    expect(moved.y).toBe(90);
  });
});
/**
 * `sourceIndex` 0 must always mean the ORIGINAL capture. An earlier version
 * appended crops starting at index 0, so after the first crop the index was 0
 * both before and after — undo restored the same index, resolved to the same
 * (cropped) image, and looked like undo was simply broken.
 */
describe("resolveSourcePath", () => {
  const ORIGINAL = "/tmp/capture.png";
  const crop1 = "data:image/png;base64,CROP1";
  const crop2 = "data:image/png;base64,CROP2";

  it("index 0 is the original, with no crops yet", () => {
    expect(resolveSourcePath([], 0, ORIGINAL)).toBe(ORIGINAL);
  });

  it("index 0 stays the original after any number of crops", () => {
    expect(resolveSourcePath([crop1, crop2], 0, ORIGINAL)).toBe(ORIGINAL);
  });

  it("index 1 is the first crop, index 2 the second", () => {
    expect(resolveSourcePath([crop1, crop2], 1, ORIGINAL)).toBe(crop1);
    expect(resolveSourcePath([crop1, crop2], 2, ORIGINAL)).toBe(crop2);
  });

  it("walks back through crops in order (the undo path)", () => {
    const crops = [crop1, crop2];
    // After two crops the index is 2; each undo steps down one.
    expect(resolveSourcePath(crops, 2, ORIGINAL)).toBe(crop2);
    expect(resolveSourcePath(crops, 1, ORIGINAL)).toBe(crop1);
    expect(resolveSourcePath(crops, 0, ORIGINAL)).toBe(ORIGINAL);
  });

  it("falls back to the original when the index runs past the list", () => {
    // Reachable legitimately: MAX_SOURCE_CAPTURES drops old entries, and a
    // stale redo snapshot can name an image that no longer exists.
    expect(resolveSourcePath([crop1], 5, ORIGINAL)).toBe(ORIGINAL);
    expect(resolveSourcePath([], 2, ORIGINAL)).toBe(ORIGINAL);
  });

  it("treats a negative index as the original", () => {
    expect(resolveSourcePath([crop1], -1, ORIGINAL)).toBe(ORIGINAL);
  });
});
