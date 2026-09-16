import type { CSSProperties, ReactNode } from "react";
import { isWindows } from "@/lib/platform";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/**
 * Mirrors `ResizeDirection` from `@tauri-apps/api/window`.
 *
 * That module declares the union locally but does **not** export it (checked
 * against `@tauri-apps/api` 2.11.1), so it cannot be imported. This is the
 * identical literal union, and because TypeScript types are structural,
 * `startResizeDragging` accepts it unchanged.
 */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface TitleBarProps {
  /** Optional controls (e.g. Cancel / Copy / Export) rendered on the right
   *  side of the bar. Buttons are still clickable because Tauri only treats
   *  the empty area of the drag region as draggable. */
  rightActions?: ReactNode;
}

const RESIZE_EDGE = 5;
const RESIZE_CORNER = 12;

/**
 * Windows-only resize handles.
 *
 * The main window is created with `decorations(false)`. On GTK the compositor
 * still lets the user resize such a window from its edges, but Windows has no
 * native frame to grab at all — without these strips a `decorations(false)`
 * window can never be resized. They are invisible: their only job is to call
 * `startResizeDragging` on mousedown.
 *
 * They use `position: fixed` so they are laid out against the real window edges
 * rather than the 32px bar they are rendered from — the window bottom is far
 * outside the bar, so an `absolute` handle could never reach it.
 *
 * Layering / non-interference:
 *  - `z-20` (edges) / `z-30` (corners) clears the editor canvas wrapper (`z-10`)
 *    so the strips actually receive mouse events, while staying below the
 *    floating toolbars and dialogs (`z-50`), which never sit on a window edge.
 *  - The bar has `px-3` (12px), so the traffic-light buttons start at x=12 and
 *    `rightActions` ends at x=width-12. The 5px edges and 12px corners stay
 *    strictly outside that content box and cannot intercept their clicks.
 *  - The strips carry no `data-tauri-drag-region`, so Tauri's drag handler
 *    (which matches on the event target itself) never treats them as draggable.
 */
const WINDOW_RESIZE_HANDLES: { direction: ResizeDirection; style: CSSProperties }[] = [
  { direction: "North", style: { top: 0, left: 0, right: 0, height: RESIZE_EDGE, cursor: "ns-resize", zIndex: 20 } },
  { direction: "South", style: { bottom: 0, left: 0, right: 0, height: RESIZE_EDGE, cursor: "ns-resize", zIndex: 20 } },
  { direction: "West", style: { top: 0, bottom: 0, left: 0, width: RESIZE_EDGE, cursor: "ew-resize", zIndex: 20 } },
  { direction: "East", style: { top: 0, bottom: 0, right: 0, width: RESIZE_EDGE, cursor: "ew-resize", zIndex: 20 } },
  { direction: "NorthWest", style: { top: 0, left: 0, width: RESIZE_CORNER, height: RESIZE_CORNER, cursor: "nwse-resize", zIndex: 30 } },
  { direction: "NorthEast", style: { top: 0, right: 0, width: RESIZE_CORNER, height: RESIZE_CORNER, cursor: "nesw-resize", zIndex: 30 } },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: RESIZE_CORNER, height: RESIZE_CORNER, cursor: "nesw-resize", zIndex: 30 } },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: RESIZE_CORNER, height: RESIZE_CORNER, cursor: "nwse-resize", zIndex: 30 } },
];

function WindowsResizeHandles() {
  return (
    <>
      {WINDOW_RESIZE_HANDLES.map(({ direction, style }) => (
        <div
          key={direction}
          aria-hidden="true"
          className="fixed"
          style={{ position: "fixed", ...style }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            // Keep the event away from Tauri's document-level drag-region
            // listener and stop any text selection from starting.
            e.preventDefault();
            e.stopPropagation();
            void appWindow.startResizeDragging(direction);
          }}
        />
      ))}
    </>
  );
}

export function TitleBar({ rightActions }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center h-8 shrink-0 select-none relative px-3 bg-transparent"
    >
      {/* Mac-style traffic light buttons — left aligned, no bar background */}
      <div className="flex items-center gap-[7px] z-10 py-2">
        {/* Close — red */}
        <button
          onClick={() => appWindow.close()}
          aria-label="Close"
          className="group relative flex items-center justify-center"
          style={{ width: 12, height: 12 }}
        >
          <span
            style={{
              display: "block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "radial-gradient(circle at 40% 35%, #ff7e72, #e0443a)",
              boxShadow: "0 0 0 0.5px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
              transition: "filter var(--duration-quick) var(--ease-out)",
            }}
            className="group-hover:brightness-110"
          />
          {/* × symbol on hover */}
          <svg
            className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            width="6" height="6" viewBox="0 0 6 6"
            style={{ left: 3, top: 3 }}
          >
            <line x1="0.5" y1="0.5" x2="5.5" y2="5.5" stroke="#4a0800" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="5.5" y1="0.5" x2="0.5" y2="5.5" stroke="#4a0800" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Minimize — yellow */}
        <button
          onClick={() => appWindow.minimize()}
          aria-label="Minimize"
          className="group relative flex items-center justify-center"
          style={{ width: 12, height: 12 }}
        >
          <span
            style={{
              display: "block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "radial-gradient(circle at 40% 35%, #ffda6a, #d8952a)",
              boxShadow: "0 0 0 0.5px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
              transition: "filter var(--duration-quick) var(--ease-out)",
            }}
            className="group-hover:brightness-110"
          />
          {/* – symbol on hover */}
          <svg
            className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            width="6" height="6" viewBox="0 0 6 6"
            style={{ left: 3, top: 3 }}
          >
            <line x1="0.5" y1="3" x2="5.5" y2="3" stroke="#5c3a00" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Maximize/Fullscreen — green */}
        <button
          onClick={async () => {
            const isFullscreen = await appWindow.isFullscreen();
            appWindow.setFullscreen(!isFullscreen);
          }}
          aria-label="Fullscreen"
          className="group relative flex items-center justify-center"
          style={{ width: 12, height: 12 }}
        >
          <span
            style={{
              display: "block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "radial-gradient(circle at 40% 35%, #77e382, #29a642)",
              boxShadow: "0 0 0 0.5px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
              transition: "filter var(--duration-quick) var(--ease-out)",
            }}
            className="group-hover:brightness-110"
          />
          {/* ⤢ symbol on hover */}
          <svg
            className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            width="6" height="6" viewBox="0 0 7 7"
            style={{ left: 3, top: 3 }}
          >
            <path d="M1 5.5 L5.5 1 M3.5 1 H5.5 V3.5 M1 3.5 V1 H3.5" stroke="#004d16" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>
      </div>

      {/* Right side — action buttons (still clickable inside the drag region) */}
      {rightActions && (
        <div className="ml-auto z-10 flex items-center gap-1.5">
          {rightActions}
        </div>
      )}

      {/* Windows-only: invisible edge/corner strips that restore resizing on a
          frameless window. Linux and macOS render nothing here. */}
      {isWindows && <WindowsResizeHandles />}
    </div>
  );
}
