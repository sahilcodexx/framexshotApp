import { memo, useMemo } from "react";
import type { LayoutPresetId } from "@/lib/frame-presets";
import { LAYOUT_PRESETS, getLayoutTransform } from "@/lib/frame-presets";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LayoutPresetsProps {
  layoutPreset: LayoutPresetId;
  onChange: (preset: LayoutPresetId) => void;
  /** Optional preview thumbnail URL (uses current screenshot preview) */
  previewUrl?: string | null;
}

/** Human-friendly names and descriptions for each layout preset */
const LAYOUT_META: Record<LayoutPresetId, { label: string; description: string }> = {
  flat:            { label: "Straight",    description: "Flat front-on view — the default, no tilt." },
  "tilt-right":    { label: "Tilt Right",  description: "Angled to the right — like you're handing someone a tablet." },
  "tilt-left":     { label: "Tilt Left",   description: "Angled to the left — a mirror of the right tilt." },
  "tilt-right-down": { label: "Perspective", description: "Deep perspective lean — dramatic hero-shot look." },
  float:           { label: "Float",       description: "Gently tilted and lifted — light and airy feel." },
};

function LayoutCard({
  id,
  label,
  description,
  active,
  previewUrl,
  onClick,
}: {
  id: LayoutPresetId;
  label: string;
  description: string;
  active: boolean;
  previewUrl?: string | null;
  onClick: () => void;
}) {
  const transform = useMemo(() => getLayoutTransform(id), [id]);

  // CSS approximation of the canvas layout transform for the thumbnail
  const cssTransform = useMemo(() => {
    const { rotateX, rotateY, rotateZ, scale } = transform;
    return `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale * 0.85})`;
  }, [transform]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className="flex flex-col gap-1.5 group"
        >
          <div
            className={`
              relative w-full aspect-[4/3] rounded-xl overflow-hidden border transition-all
              ${active
                ? "border-foreground/70 ring-1 ring-white/30 scale-[0.98]"
                : "border-border hover:border-border hover:scale-[0.98]"}
              bg-gradient-to-br from-[#2a2030] to-[#1a1520]
            `}
          >
            {/* Soft pink ambient glow like the reference */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,120,140,0.18)_0%,transparent_70%)] pointer-events-none" />

            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div
                className="w-[62%] aspect-square rounded-lg overflow-hidden shadow-lg border border-border bg-secondary"
                style={{
                  transform: cssTransform,
                  transformStyle: "preserve-3d",
                }}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#555] to-[#333]" />
                )}
              </div>
            </div>
          </div>

          {/* Label underneath the card */}
          <span
            className={`text-[10px] font-medium text-center w-full transition-colors ${
              active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"
            }`}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[180px] text-xs leading-relaxed">
        <p className="font-semibold mb-0.5">{label}</p>
        <p className="text-muted-foreground">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export const LayoutPresets = memo(function LayoutPresets({
  layoutPreset,
  onChange,
  previewUrl,
}: LayoutPresetsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid grid-cols-2 gap-2">
        {LAYOUT_PRESETS.map((preset) => {
          const meta = LAYOUT_META[preset.id];
          return (
            <LayoutCard
              key={preset.id}
              id={preset.id}
              label={meta.label}
              description={meta.description}
              active={layoutPreset === preset.id}
              previewUrl={previewUrl}
              onClick={() => onChange(preset.id)}
            />
          );
        })}
      </div>
    </TooltipProvider>
  );
});
