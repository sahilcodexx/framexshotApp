export type ToolType = "circle" | "rectangle" | "line" | "arrow" | "text" | "number" | "blur" | "pen" | "highlighter" | "crop" | "select" | null;

/**
 * A crop window into the LOGICAL frame space — the same coordinate space
 * annotations live in (see AGENTS.md Change 35).
 *
 * Modelled as a window rather than a "the image is now smaller" flag so that
 * annotations, padding and frame chrome all keep their original coordinates:
 * cropping only changes which part of the composed frame is emitted, so
 * resizing the crop back out restores the annotations untouched.
 *
 * Always normalized on write (positive width/height, inside the frame), which
 * is what lets the renderer treat it as a plain source rect.
 */
export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LineType = "straight" | "curved";

export type ArrowType = "thin" | "thick" | "none";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface Point {
  x: number;
  y: number;
}

export interface Color {
  hex: string;
  opacity: number;
}

export interface BaseAnnotation {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  fill: Color;
  border: {
    width: number;
    color: Color;
  };
  alignment: {
    horizontal: HorizontalAlign;
    vertical: VerticalAlign;
  };
}

export interface CircleAnnotation extends BaseAnnotation {
  type: "circle";
  radius: number;
}

export interface RectangleAnnotation extends BaseAnnotation {
  type: "rectangle";
  width: number;
  height: number;
}

export interface LineAnnotation extends BaseAnnotation {
  type: "line";
  endX: number;
  endY: number;
  lineType: LineType;
  controlPoints?: Point[];
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: "arrow";
  endX: number;
  endY: number;
  lineType: LineType;
  arrowType: ArrowType;
  controlPoints?: Point[];
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  width: number;
  height: number;
}

export interface NumberAnnotation extends BaseAnnotation {
  type: "number";
  number: number;
  radius: number;
}

export interface BlurAnnotation extends BaseAnnotation {
  type: "blur";
  width: number;
  height: number;
  blurAmount: number;
}

export interface PenAnnotation extends BaseAnnotation {
  type: "pen" | "highlighter";
  /** Freehand points in logical frame px. */
  points: Point[];
  /** Stroke width in logical px. */
  strokeWidth: number;
}

export type Annotation =
  | CircleAnnotation
  | RectangleAnnotation
  | LineAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | NumberAnnotation
  | BlurAnnotation
  | PenAnnotation;
