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
  // Transient updates are coalesced to at most one per animation frame. A
  // high-polling mouse fires pointermove far faster than the display refreshes;
  // each un-coalesced call was a store write → full sidebar re-render, which
  // starved the main thread and made drags feel heavy. The first change of a
  // gesture is sent immediately so the preview never waits a frame to start.
  const rafRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const dragActiveRef = useRef(false);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const flushPending = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingValueRef.current !== null) {
      const v = pendingValueRef.current;
      pendingValueRef.current = null;
      onValueChangeTransient?.(v);
    }
  };

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
          if (!dragActiveRef.current) {
            dragActiveRef.current = true;
            onDragChange?.(true);
            onValueChangeTransient?.(v);
          } else {
            pendingValueRef.current = v;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                flushPending();
              });
            }
          }
          if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
          commitTimerRef.current = setTimeout(() => {
            // Send the final transient (in case a coalesced update is still
            // pending), then push one history step for the whole gesture.
            flushPending();
            dragActiveRef.current = false;
            onValueCommit?.(v);
            onDragChange?.(false);
            commitTimerRef.current = null;
          }, debounceMs);
        }}
      />
    </div>
  );
}
