import { memo, useRef, useCallback, useEffect } from "react";
import { RangeSliderDebounced } from "@/components/motion/range-slider-debounced";
import { RotateCcw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ImagePositionControlProps {
  imageScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  onScaleChangeTransient: (scale: number) => void;
  onScaleChange: (scale: number) => void;
  onOffsetTransient: (x: number, y: number) => void;
  onOffsetCommit: (x: number, y: number) => void;
  onReset: () => void;
  /** Signals drag start/end so the preview generator can skip work. */
  onIsDraggingChange?: (dragging: boolean) => void;
}

/** Max pan range in each direction (px) */
const MAX_OFFSET = 300;

/** Pad visual size in px (CSS) */
const PAD_PX = 108;
const HALF = PAD_PX / 2;

export const ImagePositionControl = memo(function ImagePositionControl({
  imageScale,
  imageOffsetX,
  imageOffsetY,
  onScaleChangeTransient,
  onScaleChange,
  onOffsetTransient,
  onOffsetCommit,
  onReset,
  onIsDraggingChange,
}: ImagePositionControlProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const pendingOffsetRef = useRef<{ x: number; y: number }>({ x: imageOffsetX, y: imageOffsetY });

  // Keep pending ref in sync with prop (when reset externally)
  useEffect(() => {
    pendingOffsetRef.current = { x: imageOffsetX, y: imageOffsetY };
  }, [imageOffsetX, imageOffsetY]);

  // Converts a pad pixel coordinate (0…PAD_PX) to an offset in px
  const padToOffset = useCallback((px: number, py: number) => {
    const x = Math.round(((px - HALF) / HALF) * MAX_OFFSET);
    const y = Math.round(((py - HALF) / HALF) * MAX_OFFSET);
    return {
      x: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, x)),
      y: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, y)),
    };
  }, []);

  // Converts stored offset back to pad px position
  const dotX = Math.max(0, Math.min(PAD_PX, (imageOffsetX / MAX_OFFSET) * HALF + HALF));
  const dotY = Math.max(0, Math.min(PAD_PX, (imageOffsetY / MAX_OFFSET) * HALF + HALF));

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;

    const rect = padRef.current!.getBoundingClientRect();
    const px = Math.max(0, Math.min(PAD_PX, e.clientX - rect.left));
    const py = Math.max(0, Math.min(PAD_PX, e.clientY - rect.top));
    const { x, y } = padToOffset(px, py);
    pendingOffsetRef.current = { x, y };
    onOffsetTransient(x, y);
  }, [padToOffset, onOffsetTransient]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const rect = padRef.current!.getBoundingClientRect();
    const px = Math.max(0, Math.min(PAD_PX, e.clientX - rect.left));
    const py = Math.max(0, Math.min(PAD_PX, e.clientY - rect.top));
    const { x, y } = padToOffset(px, py);
    pendingOffsetRef.current = { x, y };
    onOffsetTransient(x, y);
  }, [padToOffset, onOffsetTransient]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const { x, y } = pendingOffsetRef.current;
    onOffsetCommit(x, y);
  }, [onOffsetCommit]);

  const scalePercent = Math.round(imageScale * 100);
  const isDefault = imageScale === 1.0 && imageOffsetX === 0 && imageOffsetY === 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">Drag to reposition</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onReset}
                disabled={isDefault}
                className="p-1 rounded hover:bg-secondary transition-colors disabled:opacity-30"
                aria-label="Reset position and zoom"
              >
                <RotateCcw className="size-3.5 text-muted-foreground hover:text-foreground transition-colors" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">Reset position &amp; zoom</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* 2D Position Pad */}
        <div
          ref={padRef}
          className="relative mx-auto rounded-xl border border-border bg-background cursor-grab active:cursor-grabbing select-none overflow-hidden"
          style={{ width: PAD_PX, height: PAD_PX }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          aria-label="Image position pad — drag to pan"
        >
          {/* Grid lines */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Horizontal thirds */}
            <div className="absolute left-0 right-0 border-t border-border" style={{ top: "33.3%" }} />
            <div className="absolute left-0 right-0 border-t border-border" style={{ top: "66.6%" }} />
            {/* Vertical thirds */}
            <div className="absolute top-0 bottom-0 border-l border-border" style={{ left: "33.3%" }} />
            <div className="absolute top-0 bottom-0 border-l border-border" style={{ left: "66.6%" }} />
            {/* Center crosshair */}
            <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-border" />
            <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-border" />
          </div>

          {/* Movable dot */}
          <div
            className="absolute size-4 rounded-full bg-foreground shadow-lg border-2 border-border pointer-events-none transition-[box-shadow]"
            style={{
              left: dotX,
              top: dotY,
              transform: "translate(-50%, -50%)",
              boxShadow: "0 0 0 3px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.6)",
            }}
          />

          {/* Corner labels */}
          <span className="absolute top-1 left-1.5 text-[8px] text-muted-foreground/50 pointer-events-none font-mono">↖</span>
          <span className="absolute top-1 right-1.5 text-[8px] text-muted-foreground/50 pointer-events-none font-mono">↗</span>
          <span className="absolute bottom-1 left-1.5 text-[8px] text-muted-foreground/50 pointer-events-none font-mono">↙</span>
          <span className="absolute bottom-1 right-1.5 text-[8px] text-muted-foreground/50 pointer-events-none font-mono">↘</span>
        </div>

        {/* Offset readout */}
        {(imageOffsetX !== 0 || imageOffsetY !== 0) && (
          <div className="flex justify-center gap-3 text-[10px] text-muted-foreground font-mono">
            <span>X {imageOffsetX > 0 ? "+" : ""}{imageOffsetX}px</span>
            <span>Y {imageOffsetY > 0 ? "+" : ""}{imageOffsetY}px</span>
          </div>
        )}

        {/* Zoom slider */}
        <div className="space-y-2">
          <RangeSliderDebounced
            label="Zoom"
            value={scalePercent}
            format={(v) => `${v}%`}
            min={50}
            max={200}
            step={1}
            onValueChangeTransient={(v) => onScaleChangeTransient(v / 100)}
            onValueCommit={(v) => onScaleChange(v / 100)}
            onDragChange={onIsDraggingChange}
            aria-label="Image zoom"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/60 font-mono">
            <span>50%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
