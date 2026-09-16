import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

interface TitleBarProps {
  /** Optional controls (e.g. Cancel / Copy / Export) rendered on the right
   *  side of the bar. Buttons are still clickable because Tauri only treats
   *  the empty area of the drag region as draggable. */
  rightActions?: ReactNode;
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
    </div>
  );
}
