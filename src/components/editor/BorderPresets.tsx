import { memo } from "react";
import { RangeSliderDebounced } from "@/components/motion/range-slider-debounced";
import type { BorderPresetId } from "@/lib/frame-presets";
import { BORDER_PRESETS } from "@/lib/frame-presets";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BorderPresetsProps {
  borderPreset: BorderPresetId;
  borderRadius: number;
  onPresetChange: (preset: BorderPresetId) => void;
  onBorderRadiusChangeTransient?: (value: number) => void;
  onBorderRadiusChange: (value: number) => void;
  /** Signals drag start/end so the preview generator can skip work. */
  onIsDraggingChange?: (dragging: boolean) => void;
}

/** Human-friendly labels and descriptions */
const BORDER_META: Record<BorderPresetId, { label: string; description: string }> = {
  sharp:  { label: "Square",  description: "Hard square corners — clean and technical." },
  curved: { label: "Rounded", description: "Gently rounded corners — the most common, natural look." },
  round:  { label: "Pill",    description: "Heavily rounded corners — soft and modern." },
};

/** SVG corner icons that visually show the roundness */
const PRESET_ICONS: Record<BorderPresetId, React.ReactNode> = {
  sharp: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      {/* hard right angle */}
      <path d="M5 19V5h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  curved: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      {/* gentle curve */}
      <path d="M5 19V11a6 6 0 0 1 6-6h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  round: (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      {/* large arc — pill-like */}
      <path d="M5 19V15a10 10 0 0 1 10-10h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export const BorderPresets = memo(function BorderPresets({
  borderPreset,
  borderRadius,
  onPresetChange,
  onBorderRadiusChangeTransient,
  onBorderRadiusChange,
  onIsDraggingChange,
}: BorderPresetsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {BORDER_PRESETS.map((preset) => {
            const active = borderPreset === preset.id;
            const meta = BORDER_META[preset.id];
            return (
              <Tooltip key={preset.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onPresetChange(preset.id)}
                    aria-pressed={active}
                    aria-label={meta.label}
                    className={`
                      flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl border transition-all
                      ${active
                        ? "bg-card border-foreground/40 text-foreground scale-[0.97]"
                        : "bg-background border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground hover:scale-[0.97]"}
                    `}
                  >
                    {PRESET_ICONS[preset.id]}
                    <span className="text-[10px] font-medium">{meta.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[160px] text-xs text-center leading-relaxed">
                  <p className="font-semibold mb-0.5">{meta.label}</p>
                  <p className="text-muted-foreground">{meta.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="space-y-2">
          <RangeSliderDebounced
            label="Corner size"
            value={borderRadius}
            format={(v) => `${v}px`}
            min={0}
            max={50}
            step={1}
            onValueChangeTransient={onBorderRadiusChangeTransient}
            onValueCommit={onBorderRadiusChange}
            onDragChange={onIsDraggingChange}
            aria-label="Corner size"
          />
        </div>
      </div>
    </TooltipProvider>
  );
});
