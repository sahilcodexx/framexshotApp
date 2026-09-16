import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal reveal — Emil Kowalski's design-engineering rules in one component.
 *
 * Why it animates: hides the jarring "appears from nothing" snap of a fresh
 * element. Used sparingly for surfaces the user sees occasionally (overlays,
 * editor mounts, captured previews) — never for keyboard-initiated actions.
 *
 * Decisions baked in (do not override without a reason):
 *   - Custom ease-out curve, not the weak built-in `ease-out`.
 *   - Enters from `scale(0.97) + opacity: 0`. Never `scale(0)` — nothing in
 *     the real world materialises from a point.
 *   - Only `transform` + `opacity` are animated (skip layout / paint).
 *   - CSS transition (interruptible), not `@keyframes` (restarts from zero).
 *   - `prefers-reduced-motion`: keeps the opacity fade, drops the transform.
 *   - rAF before the visible state: guarantees the "pre" frame paints first.
 */

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Delay before the animation starts, in ms. Keep small (≤ 200ms). */
  delay?: number;
  /** Animation duration, in ms. Keep under 300ms for UI. */
  duration?: number;
  /** Optional inline style merged on top. */
  style?: CSSProperties;
}

export function Reveal({
  children,
  className,
  delay = 0,
  duration = 250,
  style,
}: RevealProps) {
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    // Wait one frame so the "pre" state paints before the transition starts.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const transition =
    reduceMotion
      ? `opacity ${Math.min(duration, 100)}ms ${EASE_OUT} ${delay}ms`
      : `opacity ${duration}ms ${EASE_OUT} ${delay}ms, transform ${duration}ms ${EASE_OUT} ${delay}ms`;

  const motionStyle: CSSProperties = reduceMotion
    ? {
        opacity: shown ? 1 : 0,
        transition,
      }
    : {
        opacity: shown ? 1 : 0,
        transform: shown ? "scale(1)" : "scale(0.97)",
        transition,
        willChange: shown ? undefined : "opacity, transform",
      };

  return (
    <div className={className} style={{ ...motionStyle, ...style }}>
      {children}
    </div>
  );
}

/**
 * Skeleton — a subtle shimmer placeholder for content that's loading.
 * Uses a slow linear gradient sweep so it reads as "loading" without being
 * loud. The `prefers-reduced-motion` global guard freezes the sweep at a
 * near-static state.
 */
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden bg-card",
        // Shimmer band sweeps from left to right, infinite linear loop.
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent",
        "before:animate-[skeleton-shimmer_1.6s_linear_infinite]",
        className
      )}
    />
  );
}
