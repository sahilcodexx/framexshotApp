import { useRef, useEffect, useState, useCallback, memo } from "react";
import { Annotation, ToolType, Point, PenAnnotation, CropRegion } from "@/types/annotations";
import { drawAnnotationOnCanvas } from "@/lib/annotation-utils";
import { cn } from "@/lib/utils";

function getDistanceToQuadraticCurve(
  point: Point,
  start: Point,
  control: Point,
  end: Point
): number {
  let minDistance = Infinity;
  const steps = 50;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * control.x + t * t * end.x;
    const y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * control.y + t * t * end.y;
    const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
    minDistance = Math.min(minDistance, distance);
  }
  
  return minDistance;
}

interface AnnotationCanvasProps {
  annotations: Annotation[];
  selectedAnnotation: Annotation | null;
  selectedTool: ToolType;
  previewUrl: string | null;
  /**
   * Logical (full-resolution) size of the composed frame. Display sizing uses
   * this instead of the rendered buffer size, so the on-screen canvas keeps a
   * constant size while the preview render tier changes between a drag
   * (900px) and rest (1400px). Falls back to the buffer size when absent.
   */
  frameSize?: { width: number; height: number } | null;
  /**
   * Committed crop selection, in logical FRAME coords.
   *
   * The crop is destructive, so there is no permanent viewport to hold — this
   * is just the pending selection, expressed in frame coords because that is
   * what the canvas draws in. The parent maps it to source-image pixels.
   */
  cropSelection?: CropRegion | null;
  /**
   * The screenshot's content rect in frame coords. The selection is clamped to
   * it, so a drag cannot run off into the padding/background — cropping those
   * would delete pixels that were never part of the screenshot.
   */
  imageContentRect?: { x: number; y: number; width: number; height: number } | null;
  /** Commit a finished selection drag, in frame coords. */
  onCropSelect?: (rect: CropRegion | null) => void;
  showTransparencyGrid?: boolean;
  onAnnotationAdd: (annotation: Annotation) => void;
  /** Called on drag end - should commit to history */
  onAnnotationUpdate: (annotation: Annotation) => void;
  onAnnotationSelect: (annotation: Annotation | null) => void;
  onAnnotationDelete?: (id: string) => void;
  onToolSelect?: (tool: ToolType) => void;
}

/** Clone annotations into a mutable working list (Immer freezes store state). */
function cloneAnnotations(list: Annotation[]): Annotation[] {
  return list.map((ann) => {
    const copy = {
      ...ann,
      fill: { ...ann.fill },
      border: {
        width: ann.border.width,
      color: { ...ann.border.color },
      },
      alignment: { ...ann.alignment },
    } as Annotation;

    if ("controlPoints" in ann && ann.controlPoints) {
      (copy as Annotation & { controlPoints?: Point[] }).controlPoints = ann.controlPoints.map((cp) => ({
        x: cp.x,
        y: cp.y,
      }));
    }

    if ("points" in ann && ann.points) {
      (copy as Annotation & { points: Point[] }).points = ann.points.map((p) => ({
        x: p.x,
        y: p.y,
      }));
    }

    return copy;
  });
}

function isActivelyInteracting(ds: {
  isDrawing: boolean;
  draggingAnnotationId: string | null;
  resizingAnnotationId: string | null;
}): boolean {
  return !!(ds.isDrawing || ds.draggingAnnotationId || ds.resizingAnnotationId);
}

/**
 * The rect the crop gesture currently represents.
 *
 * Uses the live pointer position while dragging and falls back to the
 * committed crop, so the overlay shows the committed rect before a drag starts
 * and follows the cursor during one.
 */
function liveCropRect(ds: {
  cropAnchor: Point | null;
  cropCurrent: Point | null;
  cropMoving: CropRegion | null;
}): CropRegion | null {
  const anchor = ds.cropAnchor;
  if (!anchor) return null;
  const current = ds.cropCurrent ?? anchor;

  if (ds.cropMoving) {
    // Moving an existing crop: size is fixed, position tracks the delta.
    return {
      x: ds.cropMoving.x + (current.x - anchor.x),
      y: ds.cropMoving.y + (current.y - anchor.y),
      width: ds.cropMoving.width,
      height: ds.cropMoving.height,
    };
  }

  return {
    x: Math.min(anchor.x, current.x),
    y: Math.min(anchor.y, current.y),
    width: Math.abs(current.x - anchor.x),
    height: Math.abs(current.y - anchor.y),
  };
}

/**
 * Crop overlay: everything outside the selection is dimmed, the selection gets
 * a border plus rule-of-thirds guides and corner brackets.
 *
 * The dim is drawn over the whole FRAME (the user needs to see the background
 * and padding go away once cropped), but `bounds` — the screenshot's own rect
 * — is outlined separately: the selection can never extend past it, so the
 * outline makes the actionable area unambiguous instead of leaving the user to
 * discover the edge by dragging.
 *
 * With NO selection there is deliberately NO dim. Dimming the entire frame on
 * tool activation reads as a broken or greyed-out image rather than as "drag to
 * select", which is the state the user is actually in. Only the dashed bounds
 * outline shows, so the croppable area is obvious and everything is still
 * legible.
 */
function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  rect: CropRegion | null,
  logicalW: number,
  logicalH: number,
  uiScale: number,
  bounds: { x: number; y: number; width: number; height: number } | null
) {
  // Outline the croppable area first so it reads as the canvas edge.
  if (bounds) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(1, Math.round(uiScale));
    ctx.setLineDash([6 * uiScale, 5 * uiScale]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
  }

  if (!rect || rect.width < 1 || rect.height < 1) {
    return;
  }

  const dim = "rgba(0, 0, 0, 0.55)";

  const { x, y, width, height } = rect;

  // Dim the four bands around the selection rather than punching a hole —
  // avoids save/restore around a composite operation.
  ctx.fillStyle = dim;
  ctx.fillRect(0, 0, logicalW, y);
  ctx.fillRect(0, y + height, logicalW, logicalH - (y + height));
  ctx.fillRect(0, y, x, height);
  ctx.fillRect(x + width, y, logicalW - (x + width), height);

  const line = Math.max(1, Math.round(uiScale));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = line;
  ctx.strokeRect(x, y, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = Math.max(1, line * 0.75);
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    const gx = x + (width * i) / 3;
    const gy = y + (height * i) / 3;
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
  }
  ctx.stroke();

  // Corner brackets — constant size on screen, like every other chrome here.
  const arm = Math.min(Math.max(12 * uiScale, 4), Math.min(width, height) / 3);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, line * 2);
  ctx.beginPath();
  const corners: Array<[number, number, number, number]> = [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
  }
  ctx.stroke();
}

/**
 * Clamp a frame-space point into the screenshot's content rect.
 *
 * Cropping outside the image would mean deleting pixels of the background or
 * padding, which is not something the source image even contains — so the
 * selection is hard-bounded here rather than corrected after the fact.
 */
function clampToImageRect(
  point: Point,
  bounds: { x: number; y: number; width: number; height: number } | null
): Point {
  if (!bounds) return point;
  return {
    x: Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width)),
    y: Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height)),
  };
}

/**
 * Coalesce crop-drag redraws to one per animation frame.
 *
 * `redraw` re-blits the full-resolution screenshot every call, so calling it
 * straight from `pointermove` queues one full-frame composite per event — mice
 * poll at 125-1000Hz against a 60Hz display, so the overlay visibly trails the
 * cursor. Only the latest pointer position matters, so earlier frames are
 * simply dropped.
 */
function scheduleCropRedraw() {
  if (cropRafPending) return;
  cropRafPending = true;
  requestAnimationFrame(() => {
    cropRafPending = false;
    cropRedrawFn?.();
  });
}

// Module-level indirection so the helper can live outside the component without
// taking a dependency on it (and therefore without re-creating it each render).
let cropRafPending = false;
let cropRedrawFn: (() => void) | null = null;

export const AnnotationCanvas = memo(function AnnotationCanvas({
  annotations,
  selectedAnnotation,
  selectedTool,
  previewUrl,
  frameSize,
  cropSelection = null,
  imageContentRect = null,
  onCropSelect,
  showTransparencyGrid = false,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationSelect,
  onToolSelect,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  
  // Mutable working copy — never point at Immer-frozen store arrays
  const annotationsRef = useRef<Annotation[]>(cloneAnnotations(annotations));
  // Mutable drag state (no React re-renders during drag)
  const dragStateRef = useRef({
    isDrawing: false,
    startPoint: null as Point | null,
    currentPoint: null as Point | null,
    draggingAnnotationId: null as string | null,
    dragOffset: null as Point | null,
    dragStartAnnotation: null as Annotation | null,
    resizingAnnotationId: null as string | null,
    resizeHandle: null as string | null,
    resizeStartPoint: null as Point | null,
    resizeStartAnnotation: null as Annotation | null,
    hoveredHandleId: null as string | null,
    nextNumber: 1,
    /** Live point list for the in-progress freehand stroke. */
    penPointsRef: null as { points: Point[] } | null,
    /** Crop gesture: anchor point of the in-progress selection. */
    cropAnchor: null as Point | null,
    /** Current pointer position during a crop drag. */
    cropCurrent: null as Point | null,
    /**
     * Existing crop at mousedown, when the drag MOVES it rather than drawing a
     * new one. Null means "this gesture is drawing a fresh rect".
     */
    cropMoving: null as CropRegion | null,
    /** Whether the crop gesture actually moved (a stray click must not commit). */
    cropMoved: false,
  });

  // Live copy for the pointer handlers, which run outside render.
  const imageRectRef = useRef(imageContentRect);
  imageRectRef.current = imageContentRect;
  const cropSelectionRef = useRef(cropSelection);
  cropSelectionRef.current = cropSelection;
  
  // Local state for drag operation - minimal React state for rendering triggers
  const [imageLoaded, setImageLoaded] = useState(false);

  // Logical (full-resolution) frame size, from the parent. Annotation
  // coordinates and display sizing are expressed in THIS space, so the
  // preview render tier (900px drag frames ↔ 1400px settle frames) is
  // invisible to geometry: only the buffer resolution changes.
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);
  frameSizeRef.current = frameSize ?? null;
  // Buffer-px per logical-px for the current frame — set in redraw().
  const frameScaleRef = useRef(1);
  // Logical px per SCREEN px (the inverse of the display scale). Annotation
  // chrome (handles, hit targets, selection outlines) is sized in screen px
  // and multiplied by this so it stays the same physical size on screen no
  // matter how large the logical frame is.
  const uiScaleRef = useRef(1);

  // Load image once and cache it
  useEffect(() => {
    if (!previewUrl) {
      imageRef.current = null;
      setImageLoaded(false);
      return;
    }

    setImageLoaded(false);

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = previewUrl;

    return () => {
      img.onload = null;
    };
  }, [previewUrl]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const fs = frameSizeRef.current;
    // Map straight from display px to LOGICAL frame px — the buffer
    // resolution cancels out, so clicks land identically whether the current
    // frame rendered at 900px or 1400px.
    if (fs && rect.width > 0 && rect.height > 0) {
      return {
        x: (e.clientX - rect.left) * (fs.width / rect.width),
        y: (e.clientY - rect.top) * (fs.height / rect.height),
      };
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const generateId = () => `annotation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const createAnnotation = useCallback(
    (type: ToolType, start: Point, end: Point): Annotation | null => {
      if (!type || type === "select") return null;

      const defaultColor = { hex: "#FF3300", opacity: 100 };
      // Default geometry is in LOGICAL frame px now — scale by uiScale so a
      // new annotation has the same visual size on a 4000px frame as on a
      // 1000px one (previously defaults lived in ~1400px preview space).
      const ui = Math.max(1, uiScaleRef.current);
      const defaultBorder = { width: 5 * ui, color: { hex: "#FF3300", opacity: 100 } };
      const defaultAlignment = { horizontal: "left" as const, vertical: "top" as const };
      const currentNum = dragStateRef.current.nextNumber;

      switch (type) {
        case "circle": {
          const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
          return {
            id: generateId(),
            type: "circle",
            x: start.x,
            y: start.y,
            radius,
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "rectangle": {
          return {
            id: generateId(),
            type: "rectangle",
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "line": {
          return {
            id: generateId(),
            type: "line",
            x: start.x,
            y: start.y,
            endX: end.x,
            endY: end.y,
            lineType: "straight",
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "arrow": {
          return {
            id: generateId(),
            type: "arrow",
            x: start.x,
            y: start.y,
            endX: end.x,
            endY: end.y,
            lineType: "straight",
            arrowType: "thick",
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "text": {
          return {
            id: generateId(),
            type: "text",
            x: start.x,
            y: start.y,
            text: "Text",
            fontSize: 48 * ui,
            fontFamily: "Arial",
            width: 200 * ui,
            height: 60 * ui,
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "number": {
          return {
            id: generateId(),
            type: "number",
            x: start.x,
            y: start.y,
            number: currentNum,
            radius: 32 * ui,
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "blur": {
          return {
            id: generateId(),
            type: "blur",
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            blurAmount: 20,
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        case "pen":
        case "highlighter": {
          return {
            id: generateId(),
            type,
            x: start.x,
            y: start.y,
            points: [start, end],
            strokeWidth: (type === "highlighter" ? 20 : 5) * ui,
            fill: defaultColor,
            border: defaultBorder,
            alignment: defaultAlignment,
          };
        }
        default:
          return null;
      }
    },
    []
  );

  const HANDLE_SIZE = 12;
  const HANDLE_HIT_SIZE = 24;
  const HANDLE_HOVER_SIZE = 16;
  const LINE_HANDLE_SIZE = 14;
  const LINE_HANDLE_HIT_SIZE = 28;

  const getResizeHandles = useCallback((annotation: Annotation): Array<{ id: string; x: number; y: number }> => {
    switch (annotation.type) {
      case "circle": {
        return [
          { id: "e", x: annotation.x + annotation.radius, y: annotation.y },
          { id: "w", x: annotation.x - annotation.radius, y: annotation.y },
          { id: "n", x: annotation.x, y: annotation.y - annotation.radius },
          { id: "s", x: annotation.x, y: annotation.y + annotation.radius },
        ];
      }
      case "rectangle": {
        return [
          { id: "nw", x: annotation.x, y: annotation.y },
          { id: "ne", x: annotation.x + annotation.width, y: annotation.y },
          { id: "sw", x: annotation.x, y: annotation.y + annotation.height },
          { id: "se", x: annotation.x + annotation.width, y: annotation.y + annotation.height },
          { id: "n", x: annotation.x + annotation.width / 2, y: annotation.y },
          { id: "s", x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height },
          { id: "w", x: annotation.x, y: annotation.y + annotation.height / 2 },
          { id: "e", x: annotation.x + annotation.width, y: annotation.y + annotation.height / 2 },
        ];
      }
      case "line":
      case "arrow": {
        const handles = [
          { id: "start", x: annotation.x, y: annotation.y },
          { id: "end", x: annotation.endX, y: annotation.endY },
        ];
        if (annotation.lineType === "curved" && annotation.controlPoints && annotation.controlPoints.length > 0) {
          handles.push({ id: "control", x: annotation.controlPoints[0].x, y: annotation.controlPoints[0].y });
        }
        return handles;
      }
      case "text": {
        const font = `${annotation.fontSize}px ${annotation.fontFamily || "Arial"}`;
        const lines = (annotation.text || "").split("\n");
        let maxLineWidth = annotation.width || 200;
        const ctxCanvas = canvasRef.current?.getContext("2d");
        if (ctxCanvas) {
          ctxCanvas.save();
          ctxCanvas.font = font;
          let measuredMax = 0;
          for (const line of lines) {
            const m = ctxCanvas.measureText(line || " ");
            if (m.width > measuredMax) measuredMax = m.width;
          }
          ctxCanvas.restore();
          if (measuredMax > 0) {
            maxLineWidth = Math.max(maxLineWidth, measuredMax);
          }
        }
        const lineCount = lines.length || 1;
        const totalHeight = Math.max(annotation.height || 60, lineCount * annotation.fontSize * 1.2);

        return [
          { id: "nw", x: annotation.x, y: annotation.y },
          { id: "ne", x: annotation.x + maxLineWidth, y: annotation.y },
          { id: "sw", x: annotation.x, y: annotation.y + totalHeight },
          { id: "se", x: annotation.x + maxLineWidth, y: annotation.y + totalHeight },
        ];
      }
      case "number": {
        return [
          { id: "e", x: annotation.x + annotation.radius, y: annotation.y },
          { id: "w", x: annotation.x - annotation.radius, y: annotation.y },
          { id: "n", x: annotation.x, y: annotation.y - annotation.radius },
          { id: "s", x: annotation.x, y: annotation.y + annotation.radius },
        ];
      }
      default:
        return [];
    }
  }, []);

  const isPointOnHandle = useCallback((point: Point, handle: { x: number; y: number }, annotation?: Annotation): boolean => {
    const distance = Math.sqrt(Math.pow(point.x - handle.x, 2) + Math.pow(point.y - handle.y, 2));
    const isLineOrArrow = annotation && (annotation.type === "line" || annotation.type === "arrow");
    const hitSize = (isLineOrArrow ? LINE_HANDLE_HIT_SIZE : HANDLE_HIT_SIZE) * uiScaleRef.current;
    return distance <= hitSize / 2;
  }, []);

  const getHandleAtPoint = useCallback((point: Point, annotation: Annotation): string | null => {
    const handles = getResizeHandles(annotation);
    for (const handle of handles) {
      if (isPointOnHandle(point, handle, annotation)) {
        return handle.id;
      }
    }
    return null;
  }, [getResizeHandles, isPointOnHandle]);

  const isPointInAnnotation = useCallback((point: Point, annotation: Annotation): boolean => {
    const ui = uiScaleRef.current;
    const margin = 20 * ui;
    switch (annotation.type) {
      case "circle": {
        const distance = Math.sqrt(
          Math.pow(point.x - annotation.x, 2) + Math.pow(point.y - annotation.y, 2)
        );
        return distance <= annotation.radius + margin;
      }
      case "rectangle": {
        return (
          point.x >= annotation.x - margin &&
          point.x <= annotation.x + annotation.width + margin &&
          point.y >= annotation.y - margin &&
          point.y <= annotation.y + annotation.height + margin
        );
      }
      case "line":
      case "arrow": {
        const lineWidth = annotation.border?.width || 5;
        const hitTolerance = Math.max(35 * ui, lineWidth + 25 * ui);
        
        if (annotation.lineType === "curved" && annotation.controlPoints && annotation.controlPoints.length > 0) {
          const cp = annotation.controlPoints[0];
          const minDistance = getDistanceToQuadraticCurve(
            point,
            { x: annotation.x, y: annotation.y },
            cp,
            { x: annotation.endX, y: annotation.endY }
          );
          return minDistance <= hitTolerance;
        } else {
          const dx = annotation.endX - annotation.x;
          const dy = annotation.endY - annotation.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          
          if (length === 0) {
            const distance = Math.sqrt(
              Math.pow(point.x - annotation.x, 2) + Math.pow(point.y - annotation.y, 2)
            );
            return distance <= hitTolerance;
          }
          
          const t = Math.max(
            0,
            Math.min(
              1,
              ((point.x - annotation.x) * dx + (point.y - annotation.y) * dy) / (length * length)
            )
          );
          const projX = annotation.x + t * dx;
          const projY = annotation.y + t * dy;
          const distance = Math.sqrt(
            Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2)
          );
          return distance <= hitTolerance;
        }
      }
      case "text": {
        const font = `${annotation.fontSize}px ${annotation.fontFamily || "Arial"}`;
        const lines = (annotation.text || "").split("\n");
        let maxLineWidth = annotation.width || 200;
        const ctxCanvas = canvasRef.current?.getContext("2d");
        if (ctxCanvas) {
          ctxCanvas.save();
          ctxCanvas.font = font;
          let measuredMax = 0;
          for (const line of lines) {
            const m = ctxCanvas.measureText(line || " ");
            if (m.width > measuredMax) measuredMax = m.width;
          }
          ctxCanvas.restore();
          if (measuredMax > 0) {
            maxLineWidth = Math.max(maxLineWidth, measuredMax);
          }
        }
        const lineCount = lines.length || 1;
        const totalHeight = Math.max(annotation.height || 60, lineCount * annotation.fontSize * 1.2);
        const padding = 20 * ui;

        return (
          point.x >= annotation.x - padding &&
          point.x <= annotation.x + maxLineWidth + padding &&
          point.y >= annotation.y - padding &&
          point.y <= annotation.y + totalHeight + padding
        );
      }
      case "number": {
        const distance = Math.sqrt(
          Math.pow(point.x - annotation.x, 2) + Math.pow(point.y - annotation.y, 2)
        );
        return distance <= annotation.radius + margin;
      }
      case "blur": {
        return (
          point.x >= annotation.x - margin &&
          point.x <= annotation.x + annotation.width + margin &&
          point.y >= annotation.y - margin &&
          point.y <= annotation.y + annotation.height + margin
        );
      }
      case "pen":
      case "highlighter": {
        // Hit when the pointer is within tolerance of any stroke segment.
        const tol = Math.max(annotation.strokeWidth / 2 + 12 * ui, 16 * ui);
        const pts = annotation.points;
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i + 1].x - pts[i].x;
          const dy = pts[i + 1].y - pts[i].y;
          const lengthSq = dx * dx + dy * dy;
          let distance: number;
          if (lengthSq === 0) {
            distance = Math.hypot(point.x - pts[i].x, point.y - pts[i].y);
          } else {
            const t = Math.max(0, Math.min(1, ((point.x - pts[i].x) * dx + (point.y - pts[i].y) * dy) / lengthSq));
            distance = Math.hypot(point.x - (pts[i].x + t * dx), point.y - (pts[i].y + t * dy));
          }
          if (distance <= tol) return true;
        }
        return false;
      }
      default:
        return false;
    }
  }, []);

  const drawResizeHandles = useCallback((ctx: CanvasRenderingContext2D, annotation: Annotation, activeHandleId?: string | null) => {
    const handles = getResizeHandles(annotation);
    ctx.save();
    
    if ((annotation.type === "line" || annotation.type === "arrow") && 
        annotation.lineType === "curved" && 
        annotation.controlPoints && 
        annotation.controlPoints.length > 0) {
      const cp = annotation.controlPoints[0];
      ctx.strokeStyle = "rgba(59, 130, 246, 0.3)";
      ctx.lineWidth = 1 * uiScaleRef.current;
      ctx.setLineDash([3 * uiScaleRef.current, 3 * uiScaleRef.current]);
      ctx.beginPath();
      ctx.moveTo(annotation.x, annotation.y);
      ctx.lineTo(cp.x, cp.y);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    handles.forEach((handle) => {
      const isHovered = dragStateRef.current.hoveredHandleId === handle.id && !activeHandleId;
      const isActive = activeHandleId === handle.id;
      const isControl = handle.id === "control";
      const isLineOrArrow = annotation.type === "line" || annotation.type === "arrow";
      // Handle sizes are in SCREEN px — scaled by uiScale so they stay the
      // same physical size on screen no matter the logical frame resolution.
      const ui = uiScaleRef.current;
      const baseSize = (isLineOrArrow ? LINE_HANDLE_SIZE : HANDLE_SIZE) * ui;
      const hoverSize = (isLineOrArrow ? LINE_HANDLE_SIZE + 4 : HANDLE_HOVER_SIZE) * ui;
      const size = (isHovered || isActive) ? hoverSize : baseSize;
      const fillColor = isControl ? "#10b981" : (isActive ? "#2563eb" : "#3b82f6");
      
      ctx.save();
      
      if (isHovered || isActive) {
        ctx.shadowColor = "rgba(59, 130, 246, 0.6)";
        ctx.shadowBlur = (isActive ? 12 : 8) * ui;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, size / 2 + 2 * ui, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = ((isHovered || isActive) ? 3.5 : 2.5) * ui;
      
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      if (isHovered || isActive) {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isActive ? "rgba(37, 99, 235, 0.6)" : "rgba(59, 130, 246, 0.5)";
        ctx.lineWidth = 2 * ui;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, size / 2 + 6 * ui, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      ctx.restore();
    });
    
    ctx.restore();
  }, [getResizeHandles]);

  const drawAnnotation = useCallback(
    (ctx: CanvasRenderingContext2D, annotation: Annotation, isSelected: boolean) => {
      drawAnnotationOnCanvas(ctx, annotation, {
        frameScale: frameScaleRef.current,
        uiScale: uiScaleRef.current,
      });

      if (isSelected && annotation.type !== "blur") {
        // Selection chrome is sized in SCREEN px (scaled by uiScale) so it
        // stays the same visual size on any logical frame size.
        const ui = uiScaleRef.current;
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2 * ui;
        ctx.setLineDash([5 * ui, 5 * ui]);
        
        switch (annotation.type) {
          case "circle": {
            ctx.beginPath();
            ctx.arc(annotation.x, annotation.y, annotation.radius + 5 * ui, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case "rectangle": {
            ctx.strokeRect(annotation.x - 5 * ui, annotation.y - 5 * ui, annotation.width + 10 * ui, annotation.height + 10 * ui);
            break;
          }
          case "line":
          case "arrow": {
            let minX = Math.min(annotation.x, annotation.endX);
            let minY = Math.min(annotation.y, annotation.endY);
            let maxX = Math.max(annotation.x, annotation.endX);
            let maxY = Math.max(annotation.y, annotation.endY);
            
            if (annotation.lineType === "curved" && annotation.controlPoints && annotation.controlPoints.length > 0) {
              const cp = annotation.controlPoints[0];
              minX = Math.min(minX, cp.x);
              minY = Math.min(minY, cp.y);
              maxX = Math.max(maxX, cp.x);
              maxY = Math.max(maxY, cp.y);
            }
            
            const padding = 8 * ui;
            ctx.strokeRect(
              minX - padding,
              minY - padding,
              maxX - minX + padding * 2,
              maxY - minY + padding * 2
            );
            break;
          }
          case "text": {
            const font = `${annotation.fontSize}px ${annotation.fontFamily || "Arial"}`;
            const lines = (annotation.text || "").split("\n");
            let maxLineWidth = annotation.width || 200;
            const ctxCanvas = canvasRef.current?.getContext("2d");
            if (ctxCanvas) {
              ctxCanvas.save();
              ctxCanvas.font = font;
              let measuredMax = 0;
              for (const line of lines) {
                const m = ctxCanvas.measureText(line || " ");
                if (m.width > measuredMax) measuredMax = m.width;
              }
              ctxCanvas.restore();
              if (measuredMax > 0) {
                maxLineWidth = Math.max(maxLineWidth, measuredMax);
              }
            }
            const lineCount = lines.length || 1;
            const totalHeight = Math.max(annotation.height || 60, lineCount * annotation.fontSize * 1.2);

            ctx.strokeRect(annotation.x - 5 * ui, annotation.y - 5 * ui, maxLineWidth + 10 * ui, totalHeight + 10 * ui);
            break;
          }
          case "number": {
            ctx.beginPath();
            ctx.arc(annotation.x, annotation.y, annotation.radius + 5 * ui, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case "pen":
          case "highlighter": {
            // Bounding box of the whole path, padded by half the stroke.
            const pts = annotation.points;
            if (pts.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const p of pts) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
              }
              const pad = annotation.strokeWidth / 2 + 5 * ui;
              ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
            }
            break;
          }
        }
        
        ctx.setLineDash([]);
        ctx.restore();
        
        drawResizeHandles(ctx, annotation, dragStateRef.current.resizingAnnotationId === annotation.id ? dragStateRef.current.resizeHandle : null);
      }
    },
    [drawResizeHandles]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const container = containerRef.current;
    if (!canvas || !img || !imageLoaded || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width;
      canvas.height = img.height;
    }

    // Display size from the LOGICAL frame size when available — constant
    // across preview render tiers. Fallback: the rendered buffer size
    // (previous behavior) when frameSize is not supplied.
    const fs = frameSizeRef.current;
    const logicalW = fs ? fs.width : img.width;
    const logicalH = fs ? fs.height : img.height;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    const imgAspect = logicalW / logicalH;
    const containerAspect = containerWidth / containerHeight;

    let displayWidth: number;
    let displayHeight: number;

    if (imgAspect > containerAspect) {
      displayWidth = Math.min(containerWidth, logicalW);
      displayHeight = displayWidth / imgAspect;
    } else {
      displayHeight = Math.min(containerHeight, logicalH);
      displayWidth = displayHeight * imgAspect;
    }

    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    // Buffer-px per logical-px. Annotations live in logical space; this maps
    // them into whatever resolution the current frame rendered at.
    const frameScale = canvas.width / logicalW;
    frameScaleRef.current = frameScale;
    // Logical px per screen px — keeps annotation chrome (handles, hit
    // targets, selection outlines) a constant size on screen regardless of
    // how large the logical frame is.
    uiScaleRef.current = displayWidth > 0 ? logicalW / displayWidth : 1;

    ctx.setTransform(frameScale, 0, 0, frameScale, 0, 0);
    ctx.clearRect(0, 0, logicalW, logicalH);
    ctx.drawImage(img, 0, 0, logicalW, logicalH);

    const currentAnnotations = annotationsRef.current;
    // Render non-text annotations first
    for (let i = 0; i < currentAnnotations.length; i++) {
      const ann = currentAnnotations[i];
      if (ann.type !== "text") {
        const isSelected = selectedAnnotation?.id === ann.id;
        drawAnnotation(ctx, ann, isSelected);
      }
    }
    // Render text annotations on top of everything
    for (let i = 0; i < currentAnnotations.length; i++) {
      const ann = currentAnnotations[i];
      if (ann.type === "text") {
        const isSelected = selectedAnnotation?.id === ann.id;
        drawAnnotation(ctx, ann, isSelected);
      }
    }

    const ds = dragStateRef.current;
    if (selectedTool === "crop") {
      const bounds = imageRectRef.current;
      drawCropOverlay(
        ctx,
        ds.cropAnchor ? liveCropRect(ds) : cropSelectionRef.current,
        logicalW,
        logicalH,
        uiScaleRef.current,
        bounds
      );
      return;
    }
    if (ds.isDrawing && ds.startPoint && selectedTool && selectedTool !== "select") {
      if ((selectedTool === "pen" || selectedTool === "highlighter") && ds.penPointsRef) {
        // Live freehand preview: draw the accumulated path directly.
        drawAnnotationOnCanvas(ctx, {
          id: "temp-pen",
          type: selectedTool,
          x: ds.startPoint.x,
          y: ds.startPoint.y,
          points: ds.penPointsRef.points,
          strokeWidth: (selectedTool === "highlighter" ? 20 : 5) * Math.max(1, uiScaleRef.current),
          fill: { hex: "#FF3300", opacity: 100 },
          border: { width: 0, color: { hex: "#FF3300", opacity: 100 } },
          alignment: { horizontal: "left", vertical: "top" },
        }, { frameScale: frameScaleRef.current, uiScale: uiScaleRef.current });
      } else if (ds.currentPoint) {
        const tempAnnotation = createAnnotation(selectedTool, ds.startPoint, ds.currentPoint);
        if (tempAnnotation) {
          drawAnnotation(ctx, tempAnnotation, false);
        }
      }
    }
  }, [imageLoaded, selectedAnnotation, selectedTool, drawAnnotation, createAnnotation]);

  // Publish the latest redraw for the frame-coalescing crop scheduler. Assigned
  // during render (like the other *_ref.current = prop mirrors in this file) so
  // the scheduler never calls a stale closure.
  cropRedrawFn = redraw;

  useEffect(
    () => () => {
      // Drop the binding so a queued frame cannot fire into an unmounted tree.
      cropRedrawFn = null;
      cropRafPending = false;
    },
    []
  );

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Sync from props only when not mid-drag/resize/draw (prevents snap-back + frozen mutations).
  // Also redraw so undo/redo and external annotation updates paint immediately.
  useEffect(() => {
    if (!isActivelyInteracting(dragStateRef.current)) {
      annotationsRef.current = cloneAnnotations(annotations);
      if (imageLoaded) {
        redraw();
      }
    }
  }, [annotations, imageLoaded, redraw]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (imageLoaded) {
        redraw();
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [imageLoaded, redraw]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasCoordinates(e);
    const ds = dragStateRef.current;
    const currentAnnotations = annotationsRef.current;

    // Crop tool takes priority over every annotation interaction — it edits
    // the frame window, not the annotations drawn inside it.
    if (selectedTool === "crop") {
      e.preventDefault();
      const clamped = clampToImageRect(point, imageRectRef.current);

      ds.cropAnchor = clamped;
      ds.cropCurrent = clamped;
      ds.cropMoved = false;
      // Dragging from inside the existing rect MOVES it (keeping its size);
      // dragging from anywhere else draws a new one. Moving is what makes an
      // earlier crop adjustable without having to start over.
      const existing = cropSelectionRef.current;
      ds.cropMoving =
        existing &&
        clamped.x >= existing.x &&
        clamped.x <= existing.x + existing.width &&
        clamped.y >= existing.y &&
        clamped.y <= existing.y + existing.height
          ? { ...existing }
          : null;
      onAnnotationSelect(null);
      redraw();
      return;
    }

    // Check if clicking resize handles of currently selected annotation
    if (selectedAnnotation && selectedAnnotation.type !== "blur") {
      const liveSelected =
        currentAnnotations.find((a) => a.id === selectedAnnotation.id) ?? selectedAnnotation;
      const handle = getHandleAtPoint(point, liveSelected);
      if (handle) {
        annotationsRef.current = cloneAnnotations(currentAnnotations);
        const workingAnn =
          annotationsRef.current.find((a) => a.id === liveSelected.id) ?? liveSelected;
        ds.resizingAnnotationId = workingAnn.id;
        ds.resizeHandle = handle;
        ds.resizeStartPoint = point;
        ds.resizeStartAnnotation = cloneAnnotations([workingAnn])[0];
        return;
      }
    }

    // Check if clicking any resize handle (prioritize text handles)
    let clickedAnnotation: Annotation | null = null;
    let clickedHandle: string | null = null;
    
    for (let i = currentAnnotations.length - 1; i >= 0; i--) {
      const ann = currentAnnotations[i];
      if (ann.type === "text") {
        const handle = getHandleAtPoint(point, ann);
        if (handle) {
          clickedAnnotation = ann;
          clickedHandle = handle;
          break;
        }
      }
    }

    if (!clickedAnnotation) {
      for (let i = currentAnnotations.length - 1; i >= 0; i--) {
        const ann = currentAnnotations[i];
        if (ann.type !== "blur" && ann.type !== "text") {
          const handle = getHandleAtPoint(point, ann);
          if (handle) {
            clickedAnnotation = ann;
            clickedHandle = handle;
            break;
          }
        }
      }
    }
    
    // Check if clicking inside any existing annotation (prioritize text annotations)
    if (!clickedAnnotation) {
      for (let i = currentAnnotations.length - 1; i >= 0; i--) {
        const ann = currentAnnotations[i];
        if (ann.type === "text" && isPointInAnnotation(point, ann)) {
          clickedAnnotation = ann;
          break;
        }
      }
    }

    if (!clickedAnnotation) {
      for (let i = currentAnnotations.length - 1; i >= 0; i--) {
        const ann = currentAnnotations[i];
        if (ann.type !== "text" && isPointInAnnotation(point, ann)) {
          clickedAnnotation = ann;
          break;
        }
      }
    }

    if (clickedAnnotation) {
      // Work on a fresh mutable clone for the duration of this interaction
      annotationsRef.current = cloneAnnotations(currentAnnotations);
      const working = annotationsRef.current;
      const workingAnn = working.find((a) => a.id === clickedAnnotation.id) ?? clickedAnnotation;

      // Bring clicked annotation to top of the local working list (visual + hit order)
      const idx = working.findIndex((a) => a.id === workingAnn.id);
      if (idx !== -1 && idx !== working.length - 1) {
        working.splice(idx, 1);
        working.push(workingAnn);
      }

      onAnnotationSelect(workingAnn);
      if (clickedHandle && workingAnn.type !== "blur") {
        ds.resizingAnnotationId = workingAnn.id;
        ds.resizeHandle = clickedHandle;
        ds.resizeStartPoint = point;
        ds.resizeStartAnnotation = cloneAnnotations([workingAnn])[0];
      } else {
        ds.draggingAnnotationId = workingAnn.id;
        ds.dragOffset = {
          x: point.x - workingAnn.x,
          y: point.y - workingAnn.y,
        };
        ds.dragStartAnnotation = cloneAnnotations([workingAnn])[0];
      }
      redraw();
      return;
    }

    if (selectedTool === "select" || !selectedTool) {
      onAnnotationSelect(null);
    } else {
      ds.isDrawing = true;
      ds.startPoint = point;
      ds.currentPoint = point;
      if (selectedTool === "pen" || selectedTool === "highlighter") {
        ds.penPointsRef = { points: [point] };
      }
    }
  };

  const applyResize = useCallback((annotation: Annotation, handle: string, point: Point, startPoint: Point, startAnnotation: Annotation): Annotation => {
    switch (annotation.type) {
      case "circle": {
        const distance = Math.sqrt(
          Math.pow(point.x - startAnnotation.x, 2) + Math.pow(point.y - startAnnotation.y, 2)
        );
        const newRadius = Math.max(5, distance);
        return { ...annotation, radius: newRadius };
      }
      case "rectangle": {
        if (annotation.type !== "rectangle" || startAnnotation.type !== "rectangle") return annotation;
        const dx = point.x - startPoint.x;
        const dy = point.y - startPoint.y;
        let { x, y, width, height } = startAnnotation;
        
        if (handle === "nw") {
          x = startAnnotation.x + dx;
          y = startAnnotation.y + dy;
          width = Math.max(10, startAnnotation.width - dx);
          height = Math.max(10, startAnnotation.height - dy);
        } else if (handle === "ne") {
          y = startAnnotation.y + dy;
          width = Math.max(10, startAnnotation.width + dx);
          height = Math.max(10, startAnnotation.height - dy);
        } else if (handle === "sw") {
          x = startAnnotation.x + dx;
          width = Math.max(10, startAnnotation.width - dx);
          height = Math.max(10, startAnnotation.height + dy);
        } else if (handle === "se") {
          width = Math.max(10, startAnnotation.width + dx);
          height = Math.max(10, startAnnotation.height + dy);
        } else if (handle === "n") {
          y = startAnnotation.y + dy;
          height = Math.max(10, startAnnotation.height - dy);
        } else if (handle === "s") {
          height = Math.max(10, startAnnotation.height + dy);
        } else if (handle === "w") {
          x = startAnnotation.x + dx;
          width = Math.max(10, startAnnotation.width - dx);
        } else if (handle === "e") {
          width = Math.max(10, startAnnotation.width + dx);
        }
        
        return { ...annotation, x, y, width, height };
      }
      case "line":
      case "arrow": {
        if (annotation.type !== "line" && annotation.type !== "arrow") return annotation;
        if (handle === "start") {
          const updated = { ...annotation, x: point.x, y: point.y };
          if (annotation.lineType === "curved" && annotation.controlPoints && annotation.controlPoints.length > 0) {
            const dx = point.x - startAnnotation.x;
            const dy = point.y - startAnnotation.y;
            updated.controlPoints = [{
              x: annotation.controlPoints[0].x + dx,
              y: annotation.controlPoints[0].y + dy,
            }];
          }
          return updated;
        } else if (handle === "end") {
          if (startAnnotation.type !== "line" && startAnnotation.type !== "arrow") return annotation;
          const updated = { ...annotation, endX: point.x, endY: point.y };
          if (annotation.lineType === "curved" && annotation.controlPoints && annotation.controlPoints.length > 0) {
            const dx = point.x - startAnnotation.endX;
            const dy = point.y - startAnnotation.endY;
            updated.controlPoints = [{
              x: annotation.controlPoints[0].x + dx,
              y: annotation.controlPoints[0].y + dy,
            }];
          }
          return updated;
        } else if (handle === "control" && annotation.lineType === "curved") {
          return { ...annotation, controlPoints: [{ x: point.x, y: point.y }] };
        }
        return annotation;
      }
      case "text": {
        if (annotation.type !== "text" || startAnnotation.type !== "text") return annotation;
        
        const isRightHandle = handle === "ne" || handle === "se" || handle === "e";
        const isBottomHandle = handle === "sw" || handle === "se" || handle === "s";
        const isLeftHandle = handle === "nw" || handle === "sw" || handle === "w";
        const isTopHandle = handle === "nw" || handle === "ne" || handle === "n";
        
        let scaleX = 1;
        let scaleY = 1;
        
        if (isRightHandle) {
          scaleX = Math.max(0.1, (point.x - startAnnotation.x) / startAnnotation.width);
        } else if (isLeftHandle) {
          scaleX = Math.max(0.1, (startAnnotation.x - point.x) / startAnnotation.width);
        }
        
        if (isBottomHandle) {
          scaleY = Math.max(0.1, (point.y - startAnnotation.y) / startAnnotation.height);
        } else if (isTopHandle) {
          scaleY = Math.max(0.1, (startAnnotation.y - point.y) / startAnnotation.height);
        }
        
        const scale = Math.max(scaleX, scaleY);
        const newFontSize = Math.max(8, Math.round(startAnnotation.fontSize * scale));
        const fontScale = newFontSize / startAnnotation.fontSize;
        
        let newX = startAnnotation.x;
        let newY = startAnnotation.y;
        
        if (isLeftHandle) {
          newX = startAnnotation.x + startAnnotation.width - (startAnnotation.width * fontScale);
        }
        if (isTopHandle) {
          newY = startAnnotation.y + startAnnotation.height - (startAnnotation.height * fontScale);
        }
        
        const newWidth = Math.max(50, Math.round(startAnnotation.width * fontScale));
        const newHeight = Math.max(20, Math.round(startAnnotation.height * fontScale));
        
        return { 
          ...annotation, 
          x: newX, 
          y: newY, 
          fontSize: newFontSize, 
          width: newWidth, 
          height: newHeight 
        };
      }
      case "number": {
        const distance = Math.sqrt(
          Math.pow(point.x - startAnnotation.x, 2) + Math.pow(point.y - startAnnotation.y, 2)
        );
        const newRadius = Math.max(10, distance);
        return { ...annotation, radius: newRadius };
      }
      default:
        return annotation;
    }
  }, []);

  const getCursorForHandle = useCallback((handle: string | null): string => {
    if (!handle) return "default";
    
    const cursorMap: Record<string, string> = {
      "nw": "nw-resize",
      "ne": "ne-resize",
      "sw": "sw-resize",
      "se": "se-resize",
      "n": "n-resize",
      "s": "s-resize",
      "w": "w-resize",
      "e": "e-resize",
      "start": "move",
      "end": "move",
      "control": "crosshair",
    };
    
    return cursorMap[handle] || "default";
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasCoordinates(e);
    const canvas = canvasRef.current;
    const ds = dragStateRef.current;

    // Crop drag: redraw only, never touch annotations or the store. The
    // overlay is drawn from ds.cropAnchor/cropCurrent so the rect tracks the
    // cursor without a React render per pointermove.
    if (selectedTool === "crop" && ds.cropAnchor) {
      ds.cropCurrent = clampToImageRect(point, imageRectRef.current);
      if (
        ds.cropCurrent.x !== ds.cropAnchor.x ||
        ds.cropCurrent.y !== ds.cropAnchor.y
      ) {
        ds.cropMoved = true;
      }
      scheduleCropRedraw();
      return;
    }

    const resizeHandle = ds.resizeHandle;
    const resizeStartPoint = ds.resizeStartPoint;
    const resizeStartAnnotation = ds.resizeStartAnnotation;
    const dragOffset = ds.dragOffset;

    // Live drag/resize only mutates the local working copy. Commit to Zustand on mouseup.
    // Writing into Immer-frozen store arrays (or pushing history every frame) was breaking moves.
    if (ds.resizingAnnotationId && resizeHandle && resizeStartPoint && resizeStartAnnotation) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const currentAnnotations = annotationsRef.current;
        const annotation = currentAnnotations.find((ann) => ann.id === ds.resizingAnnotationId);
        if (annotation && resizeStartAnnotation) {
          const updated = applyResize(annotation, resizeHandle, point, resizeStartPoint, resizeStartAnnotation);
          const idx = currentAnnotations.findIndex((ann) => ann.id === annotation.id);
          if (idx !== -1) {
            currentAnnotations[idx] = updated;
            redraw();
          }
        }
      });
    } else if (ds.draggingAnnotationId && dragOffset) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const currentAnnotations = annotationsRef.current;
        const annotation = currentAnnotations.find((ann) => ann.id === ds.draggingAnnotationId);
        if (annotation && dragOffset && ds.dragStartAnnotation) {
          const startAnn = ds.dragStartAnnotation;
          const newX = point.x - dragOffset.x;
          const newY = point.y - dragOffset.y;
          const dx = newX - startAnn.x;
          const dy = newY - startAnn.y;
          const updated = {
            ...annotation,
            x: newX,
            y: newY,
          };
          if (annotation.type === "line" || annotation.type === "arrow") {
            if ("endX" in startAnn && "endY" in startAnn) {
              (updated as typeof annotation & { endX: number; endY: number }).endX =
                (startAnn as typeof annotation & { endX: number; endY: number }).endX + dx;
              (updated as typeof annotation & { endX: number; endY: number }).endY =
                (startAnn as typeof annotation & { endX: number; endY: number }).endY + dy;
            }
            if ("controlPoints" in startAnn && startAnn.controlPoints && startAnn.controlPoints.length > 0) {
              (updated as typeof annotation & { controlPoints?: Point[] }).controlPoints =
                startAnn.controlPoints.map((cp) => ({
                  x: cp.x + dx,
                  y: cp.y + dy,
                }));
            }
          }
          if ((annotation.type === "pen" || annotation.type === "highlighter") && (startAnn.type === "pen" || startAnn.type === "highlighter")) {
            (updated as Annotation & { points: Point[] }).points = startAnn.points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
          }
          const idx = currentAnnotations.findIndex((ann) => ann.id === annotation.id);
          if (idx !== -1) {
            currentAnnotations[idx] = updated as Annotation;
            redraw();
          }
        }
      });
    } else if (ds.isDrawing && ds.startPoint) {
      ds.currentPoint = point;
      // Freehand tools accumulate sampled points along the gesture instead of
      // just tracking the current endpoint; redraw paints the whole path.
      if ((selectedTool === "pen" || selectedTool === "highlighter") && ds.penPointsRef) {
        const pts = ds.penPointsRef.points;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2) {
          pts.push({ x: point.x, y: point.y });
        }
      }
      redraw();
    } else if (selectedTool === "select" && selectedAnnotation && selectedAnnotation.type !== "blur" && canvas) {
      const liveSelected =
        annotationsRef.current.find((a) => a.id === selectedAnnotation.id) ?? selectedAnnotation;
      const handle = getHandleAtPoint(point, liveSelected);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle);
        if (ds.hoveredHandleId !== handle) {
          ds.hoveredHandleId = handle;
          redraw();
        }
      } else {
        if (ds.hoveredHandleId !== null) {
          ds.hoveredHandleId = null;
          redraw();
        }
        if (isPointInAnnotation(point, liveSelected)) {
          canvas.style.cursor = "move";
        } else {
          canvas.style.cursor = "default";
        }
      }
    } else if (canvas && selectedTool === "select") {
      const hovered = [...annotationsRef.current]
        .reverse()
        .find((ann) => isPointInAnnotation(point, ann));
      canvas.style.cursor = hovered ? "move" : "default";
      if (ds.hoveredHandleId !== null) {
        ds.hoveredHandleId = null;
        redraw();
      }
    } else if (ds.hoveredHandleId !== null) {
      ds.hoveredHandleId = null;
      redraw();
    }
  }, [getCanvasCoordinates, selectedTool, selectedAnnotation, applyResize, getHandleAtPoint, isPointInAnnotation, getCursorForHandle, redraw]);

  const handleMouseUp = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const ds = dragStateRef.current;
    const currentAnnotations = annotationsRef.current;

    // Commit the crop gesture. Runs before the annotation branches because the
    // crop tool never sets isDrawing — but it must also reset the crop drag
    // state even when nothing moved (a stray click inside the existing rect).
    if (ds.cropAnchor) {
      const anchor = ds.cropAnchor;
      const current = ds.cropCurrent ?? anchor;
      const moved = ds.cropMoved;
      const moving = ds.cropMoving;

      ds.cropAnchor = null;
      ds.cropCurrent = null;
      ds.cropMoving = null;
      ds.cropMoved = false;

      if (onCropSelect && moved) {
        const b = imageRectRef.current;
        const next = moving
          ? (() => {
              // Preserve the dragged rect's SIZE, shift it by the pointer
              // delta, then keep it inside the image.
              const moved2 = {
                x: moving.x + (current.x - anchor.x),
                y: moving.y + (current.y - anchor.y),
                width: moving.width,
                height: moving.height,
              };
              if (!b) return moved2;
              return {
                ...moved2,
                x: Math.max(b.x, Math.min(moved2.x, b.x + b.width - moved2.width)),
                y: Math.max(b.y, Math.min(moved2.y, b.y + b.height - moved2.height)),
              };
            })()
          : {
              x: Math.min(anchor.x, current.x),
              y: Math.min(anchor.y, current.y),
              // A right-to-left / bottom-to-top drag arrives inverted.
              width: Math.abs(current.x - anchor.x),
              height: Math.abs(current.y - anchor.y),
            };
        onCropSelect(next);
      }
      redraw();
      return;
    }

    if (ds.isDrawing && ds.startPoint && ds.currentPoint && selectedTool && selectedTool !== "select") {
      if ((selectedTool === "pen" || selectedTool === "highlighter") && ds.penPointsRef) {
        // Freehand: commit the accumulated path as one annotation.
        const points = ds.penPointsRef.points;
        const last = points[points.length - 1];
        if (last && (last.x !== ds.startPoint.x || last.y !== ds.startPoint.y)) {
          points.push({ x: ds.startPoint.x + (ds.currentPoint.x - ds.startPoint.x), y: ds.startPoint.y + (ds.currentPoint.y - ds.startPoint.y) });
        }
        const stroke: PenAnnotation = {
          id: generateId(),
          type: selectedTool,
          x: ds.startPoint.x,
          y: ds.startPoint.y,
          points,
          strokeWidth: (selectedTool === "highlighter" ? 20 : 5) * Math.max(1, uiScaleRef.current),
          fill: { hex: "#FF3300", opacity: 100 },
          border: { width: 0, color: { hex: "#FF3300", opacity: 100 } },
          alignment: { horizontal: "left", vertical: "top" },
        };
        onAnnotationAdd(stroke);
        onToolSelect?.("select");
      } else {
        const newAnnotation = createAnnotation(selectedTool, ds.startPoint, ds.currentPoint);
        if (newAnnotation) {
          onAnnotationAdd(newAnnotation);
          if (selectedTool === "number") {
            ds.nextNumber++;
          } else {
            onToolSelect?.("select");
          }
        }
      }
      ds.isDrawing = false;
      ds.startPoint = null;
      ds.currentPoint = null;
      ds.penPointsRef = null;
    } else if (ds.resizingAnnotationId && ds.resizeStartAnnotation) {
      const annotation = currentAnnotations.find((ann) => ann.id === ds.resizingAnnotationId);
      if (annotation) {
        const startAnn = ds.resizeStartAnnotation;
        let changed = false;

        if (annotation.type === "circle" && startAnn.type === "circle") {
          changed = annotation.radius !== startAnn.radius;
        } else if (annotation.type === "number" && startAnn.type === "number") {
          changed = annotation.radius !== startAnn.radius;
        } else if (annotation.type === "rectangle" && startAnn.type === "rectangle") {
          changed =
            annotation.x !== startAnn.x ||
            annotation.y !== startAnn.y ||
            annotation.width !== startAnn.width ||
            annotation.height !== startAnn.height;
        } else if (annotation.type === "text" && startAnn.type === "text") {
          changed =
            annotation.x !== startAnn.x ||
            annotation.y !== startAnn.y ||
            annotation.width !== startAnn.width ||
            annotation.height !== startAnn.height ||
            annotation.fontSize !== startAnn.fontSize;
        } else if (
          (annotation.type === "line" || annotation.type === "arrow") &&
          (startAnn.type === "line" || startAnn.type === "arrow")
        ) {
          changed =
            annotation.x !== startAnn.x ||
            annotation.y !== startAnn.y ||
            annotation.endX !== startAnn.endX ||
            annotation.endY !== startAnn.endY;
        }

        if (changed) {
          onAnnotationUpdate(annotation);
        }
      }
      ds.resizingAnnotationId = null;
      ds.resizeHandle = null;
      ds.resizeStartPoint = null;
      ds.resizeStartAnnotation = null;
    } else if (ds.draggingAnnotationId) {
      const annotation = currentAnnotations.find((ann) => ann.id === ds.draggingAnnotationId);
      if (annotation && ds.dragStartAnnotation) {
        const startAnn = ds.dragStartAnnotation;
        let changed = annotation.x !== startAnn.x || annotation.y !== startAnn.y;
        if (
          !changed &&
          (annotation.type === "line" || annotation.type === "arrow") &&
          (startAnn.type === "line" || startAnn.type === "arrow")
        ) {
          changed = annotation.endX !== startAnn.endX || annotation.endY !== startAnn.endY;
        }
        if (changed) {
          onAnnotationUpdate(annotation);
        } else {
          // Still refresh selection so PropertiesPanel holds a plain (unfrozen) object
          onAnnotationSelect(annotation);
        }
      }
      ds.draggingAnnotationId = null;
      ds.dragOffset = null;
      ds.dragStartAnnotation = null;
    }
  };

  if (!previewUrl) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative flex items-center justify-center w-full h-full min-w-0 min-h-0">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          display: "block",
        }}
        className={cn(
          "rounded-lg border border-border",
          showTransparencyGrid &&
            "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iNSIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0iI2UwZTBlMCIvPjxyZWN0IHk9IjUiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IiNlMGUwZTAiLz48cmVjdCB4PSI1IiB5PSI1IiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9InVybCgjY2hlY2tlcmJvYXJkKSIvPjwvc3ZnPg==')]",
          selectedTool === "select"
            ? "cursor-grab active:cursor-grabbing"
            : selectedTool === "text"
              ? "cursor-text"
              : "cursor-crosshair"
        )}
      />
    </div>
  );
});
