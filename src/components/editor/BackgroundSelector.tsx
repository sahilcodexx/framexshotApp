import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/thumbnail-utils";
import { Button } from "@/components/ui/button";

import mesh1 from "@/assets/mesh/mesh1.webp";
import mesh2 from "@/assets/mesh/mesh2.webp";
import mesh3 from "@/assets/mesh/mesh3.webp";
import mesh4 from "@/assets/mesh/mesh4.webp";
import mesh5 from "@/assets/mesh/mesh5.webp";
import mesh6 from "@/assets/mesh/mesh6.webp";
import mesh7 from "@/assets/mesh/mesh7.webp";
import mesh8 from "@/assets/mesh/mesh8.webp";
import mesh9 from "@/assets/mesh/mesh9.webp";
import mesh10 from "@/assets/mesh/mesh10.webp";
import mesh11 from "@/assets/mesh/mesh11.webp";
import mesh12 from "@/assets/mesh/mesh12.webp";
import mesh13 from "@/assets/mesh/mesh13.webp";
import mesh14 from "@/assets/mesh/mesh14.webp";
import mesh15 from "@/assets/mesh/mesh15.webp";
import mesh16 from "@/assets/mesh/mesh16.webp";
import mesh17 from "@/assets/mesh/mesh17.webp";

type BackgroundType = "transparent" | "white" | "black" | "gray" | "gradient" | "custom" | "image";

interface GradientOption {
  id: string;
  name: string;
  src: string;
  colors: [string, string];
}

const gradientOptions: GradientOption[] = [
  { id: "mesh-1", name: "Mesh 1", src: mesh1, colors: ["#667eea", "#764ba2"] },
  { id: "mesh-2", name: "Mesh 2", src: mesh2, colors: ["#0093E9", "#80D0C7"] },
  { id: "mesh-3", name: "Mesh 3", src: mesh3, colors: ["#f093fb", "#f5576c"] },
  { id: "mesh-4", name: "Mesh 4", src: mesh4, colors: ["#11998e", "#38ef7d"] },
  { id: "mesh-5", name: "Mesh 5", src: mesh5, colors: ["#fa709a", "#fee140"] },
  { id: "mesh-6", name: "Mesh 6", src: mesh6, colors: ["#2E3192", "#1BFFFF"] },
  { id: "mesh-7", name: "Mesh 7", src: mesh7, colors: ["#ffecd2", "#fcb69f"] },
  { id: "mesh-8", name: "Mesh 8", src: mesh8, colors: ["#0f0c29", "#24243e"] },
  { id: "mesh-9", name: "Mesh 9", src: mesh9, colors: ["#1a1f2b", "#3f4c6b"] },
  { id: "mesh-10", name: "Mesh 10", src: mesh10, colors: ["#0d324d", "#7f5a83"] },
  { id: "mesh-11", name: "Mesh 11", src: mesh11, colors: ["#2c3e50", "#4ca1af"] },
  { id: "mesh-12", name: "Mesh 12", src: mesh12, colors: ["#1d2b64", "#f8cdda"] },
  { id: "mesh-13", name: "Mesh 13", src: mesh13, colors: ["#42275a", "#734b6d"] },
  { id: "mesh-14", name: "Mesh 14", src: mesh14, colors: ["#16222a", "#3a6073"] },
  { id: "mesh-15", name: "Mesh 15", src: mesh15, colors: ["#0b8793", "#360033"] },
  { id: "mesh-16", name: "Mesh 16", src: mesh16, colors: ["#232526", "#414345"] },
  { id: "mesh-17", name: "Mesh 17", src: mesh17, colors: ["#000000", "#ffffff"] },
];

interface BackgroundSelectorProps {
  backgroundType: BackgroundType;
  customColor: string;
  selectedGradient?: string;
  onBackgroundTypeChange: (type: BackgroundType) => void;
  onCustomColorChange: (color: string) => void;
  onGradientSelect?: (gradient: GradientOption) => void;
  onImageSelect?: (imageSrc: string) => void;
}

const GradientButton = memo(function GradientButton({
  gradient,
  isSelected,
  onSelect,
}: {
  gradient: GradientOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [thumbSrc, setThumbSrc] = useState<string>(gradient.src);

  useEffect(() => {
    let isMounted = true;
    getThumbnailUrl(gradient.src, 140).then((url) => {
      if (isMounted) setThumbSrc(url);
    });
    return () => {
      isMounted = false;
    };
  }, [gradient.src]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Select ${gradient.name} gradient`}
      className={cn(
        "relative w-full aspect-square rounded-xl transition-all duration-[var(--duration-quick)] overflow-hidden transform-gpu active:scale-95",
        isSelected
          ? "ring-2 ring-accent ring-offset-2 ring-offset-card shadow-md scale-[1.02]"
          : "ring-1 ring-border/60 hover:ring-border hover:scale-[1.02]"
      )}
      title={gradient.name}
    >
      <img
        src={thumbSrc}
        alt={gradient.name}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
      {isSelected && (
        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
          <div className="size-5 rounded-full bg-accent flex items-center justify-center shadow-lg">
            <svg className="size-3 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
    </button>
  );
});

export const BackgroundSelector = memo(function BackgroundSelector({
  backgroundType,
  customColor,
  selectedGradient,
  onBackgroundTypeChange,
  onCustomColorChange,
  onGradientSelect,
  onImageSelect,
}: BackgroundSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const solidColors: { type: BackgroundType; color: string }[] = [
    { type: "white", color: "#ffffff" },
    { type: "black", color: "#000000" },
    { type: "gray", color: "#f5f5f5" },
    { type: "transparent", color: "transparent" },
  ];

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select a valid image file");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;

        // Apply immediately
        onImageSelect?.(dataUrl);

        try {
          const store = await Store.load("settings.json");
          const existingUploaded = (await store.get<string[]>("uploadedBackgroundImages")) || [];
          const updatedUploaded = [...existingUploaded, dataUrl];
          await store.set("uploadedBackgroundImages", updatedUploaded);
          await store.save();
          toast.success("Background photo uploaded");
        } catch (err) {
          console.error("Failed to save uploaded image:", err);
        }
      };
      reader.onerror = () => {
        toast.error("Failed to read image file");
      };
      reader.readAsDataURL(file);

      event.target.value = "";
    },
    [onImageSelect]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground tracking-tight">Background</h3>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full text-xs h-7 px-3 bg-secondary text-foreground hover:bg-secondary/80 font-medium"
          >
            <Upload className="size-3 mr-1.5" aria-hidden="true" />
            Upload Photo
          </Button>
        </div>
      </div>

      {/* Solid Colors */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Solid Colors</span>
        <div className="flex gap-2">
          {solidColors.map(({ type, color }) => (
            <button
              key={type}
              type="button"
              onClick={() => onBackgroundTypeChange(type)}
              aria-label={`Select ${type} background`}
              className={cn(
                "size-10 rounded-xl transition-all transform-gpu active:scale-95 border",
                type === "transparent" && "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iNSIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0iI2UwZTBlMCIvPjxyZWN0IHk9IjUiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IiNlMGUwZTAiLz48cmVjdCB4PSI1IiB5PSI1IiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9InVybCgjY2hlY2tlcmJvYXJkKSIvPjwvc3ZnPg==')]",
                backgroundType === type
                  ? "border-accent ring-2 ring-accent/50 scale-[1.05]"
                  : "border-border/60 hover:border-border"
              )}
              style={type !== "transparent" ? { backgroundColor: color } : undefined}
              title={type.charAt(0).toUpperCase() + type.slice(1)}
            />
          ))}
          {/* Custom color picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => onBackgroundTypeChange("custom")}
              aria-label="Select custom color background"
              className={cn(
                "size-10 rounded-xl transition-all transform-gpu active:scale-95 border",
                backgroundType === "custom"
                  ? "border-accent ring-2 ring-accent/50 scale-[1.05]"
                  : "border-border/60 hover:border-border"
              )}
              style={{ backgroundColor: customColor }}
              title="Custom color"
            />
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                onCustomColorChange(e.target.value);
                onBackgroundTypeChange("custom");
              }}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </div>
        </div>
      </div>

      {/* Gradients */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Gradients</span>
        <div className="grid grid-cols-4 gap-2">
          {gradientOptions.map((gradient) => (
            <GradientButton
              key={gradient.id}
              gradient={gradient}
              isSelected={backgroundType === "gradient" && selectedGradient === gradient.id}
              onSelect={() => {
                onBackgroundTypeChange("gradient");
                onGradientSelect?.(gradient);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

export { gradientOptions };
export type { GradientOption };
