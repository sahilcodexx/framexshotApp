"use client";

import { useEffect, useRef } from "react";
import { RangeSlider, type RangeSliderProps } from "./range-slider";

export interface RangeSliderDebouncedProps
  extends Omit<RangeSliderProps, "onValueChange"> {
  /** Label shown above-left of the track. */
  label?: string;
  /** Formats the value shown above-right of the track. */
  format?: (value: number) => string;
  /** Fires on every value change while dragging — for transient preview updates. */
  onValueChangeTransient?: (value: number) => void;
  /** Fires after the value settles (debounceMs after the last change) — pushes to history. */
  onValueCommit?: (value: number) => void;
  /** Fires when drag state changes — signals the preview generator to skip work. */
  onDragChange?: (dragging: boolean) => void;
  /** Idle window before commit. Default 150ms — keeps one drag as one undo step. */
  debounceMs?: number;
}

/**
 * RangeSlider with a transient/commit split, an isDragging flag, and a
 * label-above / value-above layout that mirrors the reference design:
 *
 *   Drag the handle                 100
 *   [• • • • • • • • • • • • • • |]
 *
 * The slider itself is the dotted-track + bar-thumb design from beui. This
 * wrapper adds the app's plumbing on top: transient preview, debounced
 * commit, and the `isDragging` signal the canvas uses to skip regen.
 */
export function RangeSliderDebounced({
  label,
  format = (v) => `${v}`,
  onValueChangeTransient,
  onValueCommit,
  onDragChange,
  debounceMs = 150,
  ...rest
}: RangeSliderDebouncedProps) {
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  return (
    <div className="space-y-1.5">
      {(label) && (
        <div className="flex items-center justify-between text-xs">
          {label ? (
            <span className="text-muted-foreground font-medium">{label}</span>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground font-mono tabular-nums">
            {format(rest.value ?? 0)}
          </span>
        </div>
      )}
      <RangeSlider
        {...rest}
        onValueChange={(v) => {
          onValueChangeTransient?.(v);
          onDragChange?.(true);
          if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
          commitTimerRef.current = setTimeout(() => {
            onValueCommit?.(v);
            onDragChange?.(false);
            commitTimerRef.current = null;
          }, debounceMs);
        }}
      />
    </div>
  );
}
