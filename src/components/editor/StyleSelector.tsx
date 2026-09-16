import { memo } from "react";
import type { FrameStyleId } from "@/lib/frame-presets";
import { FRAME_STYLES, getFrameStyle } from "@/lib/frame-presets";
import { RangeSliderDebounced } from "@/components/motion/range-slider-debounced";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StyleSelectorProps {
  frameStyle: FrameStyleId;
  framePadding: number;
  frameOpacity: number;
  onChange: (style: FrameStyleId) => void;
  onFramePaddingChangeTransient: (value: number) => void;
  onFramePaddingChange: (value: number) => void;
  onFrameOpacityChangeTransient: (value: number) => void;
  onFrameOpacityChange: (value: number) => void;
}

/** Human-friendly names and one-line descriptions for each frame style */
const STYLE_META: Record<FrameStyleId, { label: string; description: string }> = {
  default:       { label: "Plain",   description: "No frame — just your screenshot, clean and simple." },
  "glass-light": { label: "Frosted", description: "A light frosted-glass border — like iOS sheets." },
  "glass-dark":  { label: "Smoky",   description: "A dark smoky-glass border — sleek and modern." },
  liquid:        { label: "Glow",    description: "Warm orange glow around the edges for a vibrant look." },
  "inset-light": { label: "Raised",  description: "Soft white raised mat — like a photo print border." },
  "inset-dark":  { label: "Carved",  description: "Dark recessed frame — premium dark-mode feel." },
  outline:       { label: "Outline", description: "Thin white line traced around your screenshot." },
  border:        { label: "Frame",   description: "Bold white border — like a picture frame." },
};

/** Mini visual swatches that mirror each frame style */
function StyleSwatch({ id, active }: { id: FrameStyleId; active: boolean }) {
  const base =
    "relative w-full aspect-square rounded-xl overflow-hidden transition-all border";
  const ring = active
    ? "border-foreground/80 ring-2 ring-white/30 shadow-sm scale-[0.97]"
    : "border-border hover:border-border hover:scale-[0.97]";

  switch (id) {
    case "default":
      return (
        <div className={`${base} ${ring} bg-gradient-to-b from-[#e8e8e8] to-[#cfcfcf]`}>
          <div className="absolute inset-[18%] rounded-md bg-white shadow-sm" />
        </div>
      );
    case "glass-light":
      return (
        <div className={`${base} ${ring} bg-gradient-to-br from-[#f0f4ff] to-[#c8d8ef]`}>
          <div className="absolute inset-[14%] rounded-lg bg-foreground/50 border border-foreground/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" />
          <div className="absolute inset-x-[14%] top-[14%] h-[16%] rounded-t-lg bg-gradient-to-b from-white/60 to-transparent" />
        </div>
      );
    case "glass-dark":
      return (
        <div className={`${base} ${ring} bg-gradient-to-br from-[#2a2a3a] to-[#111118]`}>
          <div className="absolute inset-[14%] rounded-lg bg-black/50 border border-foreground/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
          <div className="absolute inset-x-[14%] top-[14%] h-[14%] rounded-t-lg bg-gradient-to-b from-white/10 to-transparent" />
        </div>
      );
    case "liquid":
      return (
        <div className={`${base} ${ring} bg-gradient-to-br from-[#ff9a3c] via-[#ff6b1a] to-[#e85d04]`}>
          <div className="absolute inset-[16%] rounded-lg bg-foreground/20 border border-orange-200/50" />
          <div className="absolute inset-[10%] rounded-xl border-2 border-orange-300/40 shadow-[0_0_18px_rgba(255,140,40,0.5)]" />
        </div>
      );
    case "inset-light":
      return (
        <div className={`${base} ${ring} bg-[#eaeaea]`}>
          <div className="absolute inset-[16%] rounded-md bg-white shadow-[inset_0_3px_8px_rgba(0,0,0,0.20)]" />
          <div className="absolute inset-[13%] rounded-lg border border-foreground/80 border-b-black/10 border-r-black/10" />
        </div>
      );
    case "inset-dark":
      return (
        <div className={`${base} ${ring} bg-[#222]`}>
          <div className="absolute inset-[16%] rounded-md bg-[#111] shadow-[inset_0_3px_10px_rgba(0,0,0,0.7)] border border-foreground/5" />
          <div className="absolute inset-[13%] rounded-lg border border-foreground/5" />
        </div>
      );
    case "outline":
      return (
        <div className={`${base} ${ring} bg-card`}>
          <div className="absolute inset-[18%] rounded-md border-[2px] border-foreground/90 bg-transparent" />
        </div>
      );
    case "border":
      return (
        <div className={`${base} ${ring} bg-card`}>
          <div className="absolute inset-[11%] rounded-md border-[6px] border-foreground bg-secondary" />
        </div>
      );
    default:
      return <div className={`${base} ${ring} bg-[#222]`} />;
  }
}

export const StyleSelector = memo(function StyleSelector({
  frameStyle,
  framePadding,
  frameOpacity,
  onChange,
  onFramePaddingChangeTransient,
  onFramePaddingChange,
  onFrameOpacityChangeTransient,
  onFrameOpacityChange,
}: StyleSelectorProps) {
  const isStyled = frameStyle !== "default";
  // Resolved padding for the slider: use the live value if already set, else the style's built-in default
  const resolvedPadding = framePadding >= 0 ? framePadding : getFrameStyle(frameStyle).padding;

  return (
    <div className="space-y-4">
      {/* Swatch grid */}
      <TooltipProvider delayDuration={300}>
        <div className="grid grid-cols-3 gap-2.5">
          {FRAME_STYLES.map((style) => {
            const active = frameStyle === style.id;
            const meta = STYLE_META[style.id];
            return (
              <Tooltip key={style.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onChange(style.id)}
                    className="flex flex-col items-center gap-1.5 group"
                    aria-pressed={active}
                    aria-label={meta.label}
                  >
                    <StyleSwatch id={style.id} active={active} />
                    <span
                      className={`text-[10px] font-medium truncate w-full text-center transition-colors ${
                        active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"
                      }`}
                    >
                      {meta.label}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[180px] text-xs text-center leading-relaxed">
                  <p className="font-semibold mb-0.5">{meta.label}</p>
                  <p className="text-muted-foreground">{meta.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Padding + Opacity sliders — only shown when a frame style is active */}
      {isStyled && (
        <div className="space-y-3 pt-1 border-t border-border">
          {/* Padding */}
          <RangeSliderDebounced
            label="Padding"
            value={resolvedPadding}
            format={(v) => `${v}px`}
            min={0}
            max={40}
            step={1}
            onValueChangeTransient={(v) => onFramePaddingChangeTransient(v)}
            onValueCommit={(v) => onFramePaddingChange(v)}
            aria-label="Frame padding"
          />

          {/* Opacity */}
          <RangeSliderDebounced
            label="Opacity"
            value={frameOpacity}
            format={(v) => `${v}%`}
            min={0}
            max={100}
            step={1}
            onValueChangeTransient={(v) => onFrameOpacityChangeTransient(v)}
            onValueCommit={(v) => onFrameOpacityChange(v)}
            aria-label="Frame opacity"
          />
        </div>
      )}
    </div>
  );
});
