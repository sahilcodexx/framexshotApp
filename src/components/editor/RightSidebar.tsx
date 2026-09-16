import { useEffect, useRef, useState, memo, type ReactNode } from "react";
import { Bookmark, ChevronDown, RotateCcw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Store } from "@tauri-apps/plugin-store";
import { Accordion } from "./Accordion";
import { RangeSliderDebounced } from "@/components/motion/range-slider-debounced";
import { cn } from "@/lib/utils";
import { getAssetCategories, isDataUrl } from "@/lib/asset-registry";
import { gradientOptions } from "./BackgroundSelector";
import { BorderPresets } from "./BorderPresets";
import { StyleSelector } from "./StyleSelector";
import { ShadowPresets } from "./ShadowPresets";
import { ImagePositionControl } from "./ImagePositionControl";
import { PropertiesPanel } from "./PropertiesPanel";
import { getThumbnailUrl } from "@/lib/thumbnail-utils";
import { Skeleton, Reveal } from "@/lib/motion";
import { motion, AnimatePresence, type Easing } from "motion/react";

const EASE_OUT: Easing = [0.23, 1, 0.32, 1];
import type {
  Annotation,
} from "@/types/annotations";
import type {
  BackgroundType,
  BorderPresetId,
  EditorSettings,
  FrameStyleId,
  ShadowPresetId,
} from "@/stores/editorStore";

// ---------------------------------------------------------------------------
// Re-render scope helper
// ---------------------------------------------------------------------------
/**
 * Each section re-renders the whole settings tree when it gets a new
 * `settings` reference, even if its own slice didn't change. To keep the
 * whole sidebar from re-rendering on every drag pixel, we wrap every
 * section in `React.memo` and compare *only the keys it actually uses*.
 *
 * `makeSettingsComparator` builds that comparator. Pass the keys the
 * section reads, and the section will skip its re-render unless one of
 * those keys changed.
 */
function makeSettingsComparator<K extends keyof EditorSettings>(
  ...keys: readonly K[]
) {
  return (
    prev: { settings: EditorSettings; actions: RightSidebarActions },
    next: { settings: EditorSettings; actions: RightSidebarActions }
  ): boolean => {
    if (prev.actions !== next.actions) return false;
    for (const key of keys) {
      if (prev.settings[key] !== next.settings[key]) return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Asset registry (lazy) — only loaded when the wallpapers tab is opened
// ---------------------------------------------------------------------------
const assetCategories = getAssetCategories();

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------
type BgTab = "none" | "color" | "gradient" | "wallpaper" | "image";

const COLOR_PRESETS: { id: string; label: string; color: string; type: BackgroundType }[] = [
  { id: "white", label: "White", color: "#ffffff", type: "white" },
  { id: "black", label: "Black", color: "#000000", type: "black" },
  { id: "gray", label: "Gray", color: "#f5f5f5", type: "gray" },
];

const PREVIEW_COUNT = 3;
const wallpaperAssets = assetCategories[0]?.assets ?? [];
const previewWallpapers = wallpaperAssets.slice(0, PREVIEW_COUNT);

// ---------------------------------------------------------------------------
// Actions surface (same shape used by ImageEditor)
// ---------------------------------------------------------------------------
export interface RightSidebarActions {
  // Background
  setBackgroundType: (type: BackgroundType) => void;
  setCustomColor: (color: string) => void;
  setGradient: (gradient: (typeof gradientOptions)[number]) => void;
  handleImageSelect: (src: string) => void;
  setAllPaddingTransient?: (v: number) => void;
  setAllPadding: (v: number) => void;
  setPadding: (v: number) => void;
  // Border
  setBorderPreset: (preset: BorderPresetId) => void;
  setBorderRadiusTransient?: (v: number) => void;
  setBorderRadius: (v: number) => void;
  // Frame style (Frosted, Smoky, Glow, etc.)
  setFrameStyle: (style: FrameStyleId) => void;
  setFramePaddingTransient: (v: number) => void;
  setFramePadding: (v: number) => void;
  setFrameOpacityTransient: (v: number) => void;
  setFrameOpacity: (v: number) => void;
  // Shadow
  setShadowPreset: (preset: ShadowPresetId) => void;
  setShowMockup: (show: boolean) => void;
  setShadowOpacityTransient?: (v: number) => void;
  setShadowOpacity: (v: number) => void;
  setShadowBlurTransient?: (v: number) => void;
  setShadowBlur: (v: number) => void;
  setShadowOffsetX: (v: number) => void;
  setShadowOffsetY: (v: number) => void;
  // Image transform
  setImageScaleTransient: (v: number) => void;
  setImageScale: (v: number) => void;
  setImageOffsetTransient: (x: number, y: number) => void;
  setImageOffset: (x: number, y: number) => void;
  resetImageTransform: () => void;
  // Image adjustments
  setSharpnessTransient?: (v: number) => void;
  setSharpness: (v: number) => void;
  setBrightnessTransient?: (v: number) => void;
  setBrightness: (v: number) => void;
  setContrastTransient?: (v: number) => void;
  setContrast: (v: number) => void;
  setSaturationTransient?: (v: number) => void;
  setSaturation: (v: number) => void;
  resetImageAdjustments: () => void;
  // Effects (blur, noise)
  setBlurAmountTransient?: (v: number) => void;
  setBlurAmount: (v: number) => void;
  setNoiseAmountTransient?: (v: number) => void;
  setNoiseAmount: (v: number) => void;
  // Annotation
  updateAnnotationTransient: (annotation: Annotation) => void;
  // Transient UI flags
  setIsDragging: (dragging: boolean) => void;
  // Defaults
  saveEffectSettingsAsDefaults?: () => Promise<void>;
}

interface RightSidebarProps {
  settings: EditorSettings;
  actions: RightSidebarActions;
  previewUrl: string | null;
  selectedAnnotation: Annotation | null;
  onAnnotationUpdate: (annotation: Annotation) => void;
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------
function BgRow({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "t-acc px-3 py-2.5 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
        selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"
      )}
      data-open={selected ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        aria-pressed={selected}
        className="flex w-full items-center text-left active:scale-[0.99] origin-left"
      >
        <span
          className={cn(
            "text-[13px] font-medium tracking-[-0.01em] transition-colors duration-[var(--duration-quick)]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            selected && "rotate-180 text-foreground"
          )}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {selected && children && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.22, ease: EASE_OUT },
              opacity: { duration: 0.18, ease: "easeOut" },
            }}
            style={{ overflow: "hidden" }}
          >
            <div className="pt-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallpaper thumbnail — reuses the shimmer + loaded-fade pattern from the
// AssetGrid in the editor's right panel, but slimmer.
// ---------------------------------------------------------------------------
const WallpaperThumb = memo(function WallpaperThumb({
  src,
  name,
  isSelected,
  onSelect,
  eager = false,
}: {
  src: string;
  name: string;
  isSelected: boolean;
  onSelect: () => void;
  /**
   * Set true when the thumb is rendered inside a popover or other
   * dynamically-mounted container. The browser's lazy-load heuristic can
   * skip images that are inserted into the DOM after page load (especially
   * inside `position: fixed` overlays), so we let the popover's thumbs
   * load immediately.
   */
  eager?: boolean;
}) {
  const [thumbSrc, setThumbSrc] = useState<string>(src);

  // Record *which* src finished loading rather than a bare boolean. The boolean
  // had to be reset to false from inside the effect on every `src` change; a
  // comparison gives the identical result by derivation — a new `src` is
  // not-yet-loaded automatically — with no synchronous setState in an effect.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  useEffect(() => {
    let mounted = true;
    getThumbnailUrl(src, 140).then((url) => {
      if (mounted) setThumbSrc(url);
    });
    return () => {
      mounted = false;
    };
  }, [src]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Select ${name} background`}
      aria-pressed={isSelected}
      className={cn(
        "group relative w-full aspect-[5/4] overflow-hidden rounded-lg transition-[box-shadow,transform] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] transform-gpu active:scale-[0.97]",
        isSelected
          ? "ring-2 ring-accent ring-offset-2 ring-offset-background scale-[1.02]"
          : "ring-1 ring-border hover:ring-border/80"
      )}
    >
      {!loaded && <Skeleton className="absolute inset-0" />}
      <img
        src={thumbSrc}
        alt={name}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
  );
});

// ---------------------------------------------------------------------------
// Section: Background
// ---------------------------------------------------------------------------
const BackgroundSection = memo(function BackgroundSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  // Default to all rows collapsed. The user opens a row explicitly; we
  // don't auto-yank it open based on the active background.
  const [tab, setTab] = useState<BgTab | null>(null);

  const handleTab = (next: BgTab) => {
    // Toggle: clicking the open row closes it. Clicking a different row
    // switches. Closing a row never undoes the background it applied.
    setTab((current) => (current === next ? null : next));
    if (next === "none") {
      actions.setBackgroundType("transparent");
    } else if (next === "color") {
      const current = settings.backgroundType;
      if (!["white", "black", "gray", "custom"].includes(current)) {
        actions.setBackgroundType("white");
      }
    } else if (next === "gradient") {
      const current =
        gradientOptions.find((g) => g.id === settings.gradientId) ?? gradientOptions[0];
      if (current) actions.setGradient(current);
    } else if (next === "wallpaper") {
      const alreadyWallpaper =
        settings.backgroundType === "image" &&
        !!settings.selectedImageSrc &&
        !isDataUrl(settings.selectedImageSrc);
      if (!alreadyWallpaper && previewWallpapers[0]) {
        actions.handleImageSelect(previewWallpapers[0].src);
      }
    }
  };

  const paddingValue = settings.paddingTop;

  return (
    <div className="space-y-4">
      <RangeSliderDebounced
        label="Padding"
        value={Math.round((paddingValue / 400) * 100)}
        format={(v) => `${v}%`}
        min={0}
        max={100}
        // Padding updates per-pixel during drag — `usePreviewGenerator`
        // throttles the canvas regen to 50ms (no effects) so the preview
        // tracks the cursor instead of jumping once on release. The commit
        // fires 150ms after the drag settles so undo history still sees
        // one step per drag, not one per pixel.
        onValueChangeTransient={actions.setAllPaddingTransient}
        onValueCommit={(v) => actions.setAllPadding(Math.round((v / 100) * 400))}
        onDragChange={actions.setIsDragging}
        aria-label="Padding"
      />

      <div
        role="listbox"
        aria-label="Background type"
        className="overflow-hidden rounded-xl bg-background ring-1 ring-border divide-y divide-border"
      >
        <BgRow label="None" selected={tab === "none"} onSelect={() => handleTab("none")} />

        <BgRow label="Color" selected={tab === "color"} onSelect={() => handleTab("color")}>
          <ColorTab settings={settings} actions={actions} />
        </BgRow>

        <BgRow
          label="Gradient"
          selected={tab === "gradient"}
          onSelect={() => handleTab("gradient")}
        >
          <GradientTab settings={settings} actions={actions} />
        </BgRow>

        <BgRow
          label="Wallpapers"
          selected={tab === "wallpaper"}
          onSelect={() => handleTab("wallpaper")}
        >
          <WallpaperPreviewRow settings={settings} actions={actions} />
        </BgRow>

        <BgRow label="Image" selected={tab === "image"} onSelect={() => handleTab("image")}>
          <ImageTab settings={settings} actions={actions} />
        </BgRow>
      </div>
    </div>
  );
}, makeSettingsComparator(
  "backgroundType",
  "paddingTop",
  "selectedImageSrc",
  "customColor",
  "gradientId"
));

const ColorTab = memo(function ColorTab({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-3">
      {/* Preset color swatches */}
      <div className="flex items-center gap-2">
        {COLOR_PRESETS.map((c) => {
          const active = settings.backgroundType === c.type;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => actions.setBackgroundType(c.type)}
              aria-label={c.label}
              className={cn(
                "size-9 rounded-lg border transition-all duration-[var(--duration-quick)] transform-gpu active:scale-95",
                active
                  ? "border-accent ring-2 ring-accent/50 scale-[1.05]"
                  : "border-foreground/10 hover:border-foreground/30"
              )}
              style={{ backgroundColor: c.color }}
            />
          );
        })}

        {/* Custom color picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => actions.setBackgroundType("custom")}
            aria-label="Custom color"
            className={cn(
              "size-9 rounded-lg border transition-all duration-[var(--duration-quick)] transform-gpu active:scale-95",
              settings.backgroundType === "custom"
                ? "border-accent ring-2 ring-accent/50 scale-[1.05]"
                : "border-foreground/10 hover:border-foreground/30"
            )}
            style={{
              background:
                "linear-gradient(135deg, #ff6b6b 0%, #ffd93d 33%, #6bcf7f 66%, #4d96ff 100%)",
            }}
          />
          <input
            type="color"
            value={settings.customColor}
            onChange={(e) => {
              actions.setCustomColor(e.target.value);
              actions.setBackgroundType("custom");
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Pick custom color"
          />
        </div>
      </div>

      {/* Hex display */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">Hex</span>
        <input
          type="text"
          value={settings.customColor}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
              actions.setCustomColor(v);
              actions.setBackgroundType("custom");
            }
          }}
          className="w-full bg-transparent text-xs font-mono uppercase text-foreground outline-none"
          maxLength={7}
        />
      </div>
    </div>
  );
}, makeSettingsComparator("backgroundType", "customColor"));

const GradientTab = memo(function GradientTab({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  const [expanded, setExpanded] = useState(false);

  // Hero preview: the currently selected gradient, or the first one.
  const selectedIndex = gradientOptions.findIndex(
    (g) => settings.backgroundType === "gradient" && settings.gradientId === g.id
  );
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const preview = gradientOptions[activeIndex] ?? gradientOptions[0];
  // Browse tile: the *next* gradient in the list, so the user sees a
  // hint of "more" without expanding.
  const browseIndex = (activeIndex + 1) % Math.max(1, gradientOptions.length);
  const browse = gradientOptions[browseIndex] ?? gradientOptions[0];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {/* Hero preview — equal-sized square on the left. Shows the
            currently selected gradient. */}
        <button
          type="button"
          onClick={() => {
            if (browse) actions.setGradient(browse);
          }}
          aria-label="Use next gradient"
          className={cn(
            "group relative overflow-hidden rounded-xl",
            "ring-1 ring-border hover:ring-border/80",
            "transition-all duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            "active:scale-[0.99]"
          )}
          style={{ aspectRatio: "1 / 1" }}
        >
          {preview && (
            <img
              src={preview.src}
              alt="Selected gradient"
              className={cn(
                "h-full w-full object-cover",
                "transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                "group-hover:scale-105"
              )}
            />
          )}
          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            Gradient
          </span>
        </button>

        {/* Browse tile — equal-sized square on the right. Holds the
            chevron and opens the full grid on click. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide gradients" : "Show all gradients"}
          className={cn(
            "group relative overflow-hidden rounded-xl",
            "ring-1 ring-border hover:ring-border/80",
            "transition-all duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            "active:scale-[0.97]"
          )}
          style={{ aspectRatio: "1 / 1" }}
        >
          {browse && (
            <img
              src={browse.src}
              alt=""
              aria-hidden="true"
              className={cn(
                "h-full w-full object-cover opacity-70",
                "transition-opacity duration-[var(--duration-quick)]",
                "group-hover:opacity-90"
              )}
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/45"
          />
          <div className="absolute inset-0 grid place-items-center">
            <div
              className={cn(
                "grid size-7 place-items-center rounded-full",
                "bg-black/55 backdrop-blur-md ring-1 ring-white/20",
                "transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                expanded && "rotate-180"
              )}
            >
              <ChevronDown className="size-3.5 text-foreground" aria-hidden="true" />
            </div>
          </div>
        </button>
      </div>

      {/* Expanded picker — 3-column grid with reveal stagger. */}
      {expanded && (
        <div className="max-h-[280px] overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-1.5">
            {gradientOptions.map((g, i) => {
              const active =
                settings.backgroundType === "gradient" && settings.gradientId === g.id;
              return (
                <Reveal
                  key={g.id}
                  delay={Math.min(i, 8) * 28}
                  duration={220}
                >
                  <button
                    type="button"
                    onClick={() => {
                      actions.setGradient(g);
                      setExpanded(false);
                    }}
                    aria-label={`Select ${g.name} gradient`}
                    aria-pressed={active}
                  className={cn(
                      "relative w-full aspect-square overflow-hidden rounded-lg transition-all duration-[var(--duration-quick)] transform-gpu active:scale-95",
                      active
                        ? "ring-2 ring-accent ring-offset-2 ring-offset-background scale-[1.03]"
                        : "ring-1 ring-border hover:ring-border/80"
                    )}
                  >
                    <img
                      src={g.src}
                      alt={g.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </Reveal>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}, makeSettingsComparator("backgroundType", "gradientId"));

 // Wallpapers panel shown when the "Wallpapers" tab is selected inside the
// Background section. Collapsed state = a large hero preview of the
// currently-selected wallpaper on the left, with a small "browse" tile
// beside it (chevron + the next asset) that expands an inline grid of
// every wallpaper, grouped by category, on click.
const WallpaperPreviewRow = memo(function WallpaperPreviewRow({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  const [expanded, setExpanded] = useState(false);

  // Hero preview: the user's selected wallpaper, falling back to the first
  // asset. Uploaded (data-URL) images belong in the "Image" tab.
  const selected = wallpaperAssets.find(
    (a) =>
      settings.backgroundType === "image" &&
      settings.selectedImageSrc === a.src
  );
  const previewSrc = selected?.src ?? wallpaperAssets[0]?.src;

  // Browse tile preview: the *next* wallpaper in the list, so the user can
  // see a hint of "more" without expanding. Falls back to the second
  // asset, or the first one if there's only one.
  const browseSrc =
    wallpaperAssets[(wallpaperAssets.findIndex((a) => a.src === previewSrc) + 1) %
      Math.max(1, wallpaperAssets.length)]?.src ?? wallpaperAssets[0]?.src;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {/* Hero preview — equal-sized square on the left. Shows the
            currently selected wallpaper. */}
        <button
          type="button"
          onClick={() => {
            if (!browseSrc) return;
            actions.handleImageSelect(browseSrc);
          }}
          aria-label="Use next wallpaper"
          className={cn(
            "group relative overflow-hidden rounded-xl",
            "ring-1 ring-border hover:ring-border/80",
            "transition-all duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            "active:scale-[0.99]"
          )}
          style={{ aspectRatio: "1 / 1" }}
        >
          {previewSrc && (
            <img
              src={previewSrc}
              alt="Selected wallpaper"
              className={cn(
                "h-full w-full object-cover",
                "transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                "group-hover:scale-105"
              )}
            />
          )}
          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            Wallpapers
          </span>
        </button>

        {/* Browse tile — equal-sized square on the right. Holds the
            chevron and opens the full inline grid on click. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide wallpapers" : "Show all wallpapers"}
          className={cn(
            "group relative overflow-hidden rounded-xl",
            "ring-1 ring-border hover:ring-border/80",
            "transition-all duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            "active:scale-[0.97]"
          )}
          style={{ aspectRatio: "1 / 1" }}
        >
          {browseSrc && (
            <img
              src={browseSrc}
              alt=""
              aria-hidden="true"
              className={cn(
                "h-full w-full object-cover opacity-70",
                "transition-opacity duration-[var(--duration-quick)]",
                "group-hover:opacity-90"
              )}
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/45"
          />
          <div className="absolute inset-0 grid place-items-center">
            <div
              className={cn(
                "grid size-7 place-items-center rounded-full",
                "bg-black/55 backdrop-blur-md ring-1 ring-white/20",
                "transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                expanded && "rotate-180"
              )}
            >
              <ChevronDown className="size-3.5 text-foreground" aria-hidden="true" />
            </div>
          </div>
        </button>
      </div>

      {/* Expanded picker — 3-column grid, grouped by category, with its
          own scroll. Doesn't reach outside the tab. */}
      {expanded && (
        <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
          {assetCategories.map((category) => (
            <div key={category.name} className="space-y-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category.name}
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {category.assets.map((asset) => (
                  <WallpaperThumb
                    key={asset.id}
                    src={asset.src}
                    name={asset.name}
                    isSelected={
                      settings.backgroundType === "image" &&
                      settings.selectedImageSrc === asset.src
                    }
                    onSelect={() => {
                      actions.handleImageSelect(asset.src);
                      setExpanded(false);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}, makeSettingsComparator("backgroundType", "selectedImageSrc"));

const ImageTab = memo(function ImageTab({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);

  // Load previously uploaded images from persistent storage on mount
  useEffect(() => {
    const load = async () => {
      try {
        const store = await Store.load("settings.json");
        const uploaded =
          (await store.get<string[]>("uploadedBackgroundImages")) || [];
        setUploadedImages(uploaded);
      } catch (err) {
        console.error("Failed to load uploaded images:", err);
      }
    };
    void load();
  }, []);

  const persistUploaded = async (next: string[]) => {
    setUploadedImages(next);
    try {
      const store = await Store.load("settings.json");
      await store.set("uploadedBackgroundImages", next);
      await store.save();
    } catch (err) {
      console.error("Failed to persist uploaded images:", err);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      actions.handleImageSelect(dataUrl);
      await persistUploaded([...uploadedImages, dataUrl]);
      toast.success("Background image uploaded");
    };
    reader.onerror = () => toast.error("Failed to read image");
    reader.readAsDataURL(file);
  };

  const handleRemove = (index: number) => {
    void persistUploaded(uploadedImages.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-xs font-medium transition-colors duration-[var(--duration-quick)]",
          dragOver
            ? "border-accent bg-accent/10 text-accent"
            : "border-foreground/10 bg-foreground/[0.02] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
        )}
      >
        <Upload className="size-4" aria-hidden="true" />
        {dragOver ? "Drop to upload" : "Click or drop an image"}
      </button>
      <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
        Uploads are stored locally and applied as the background immediately.
      </p>

      {/* Uploaded photos — visible list of every image you've added,
          with click-to-select and a small × to remove. */}
      {uploadedImages.length > 0 && (
        <div className="space-y-2 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Uploaded Photos ({uploadedImages.length})
          </span>
          <div className="grid grid-cols-3 gap-2">
            {uploadedImages.map((src, index) => (
              <UploadedImageThumb
                key={`uploaded-${index}`}
                src={src}
                name={`Custom ${index + 1}`}
                isSelected={
                  settings.backgroundType === "image" &&
                  settings.selectedImageSrc === src
                }
                onSelect={() => actions.handleImageSelect(src)}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}, makeSettingsComparator("backgroundType", "selectedImageSrc"));

/** Same look as WallpaperThumb but with a small × overlay for removal. */
function UploadedImageThumb({
  src,
  name,
  isSelected,
  onSelect,
  onRemove,
}: {
  src: string;
  name: string;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Select ${name}`}
        aria-pressed={isSelected}
        className={cn(
          "relative w-full aspect-square overflow-hidden rounded-lg transition-all duration-[var(--duration-quick)] transform-gpu active:scale-[0.97]",
          isSelected
            ? "ring-2 ring-accent ring-offset-2 ring-offset-background scale-[1.02]"
            : "ring-1 ring-border hover:ring-border/80"
        )}
      >
        {!loaded && <Skeleton className="absolute inset-0" />}
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${name}`}
        className="absolute -top-1.5 -right-1.5 z-10 grid size-5 place-items-center rounded-full bg-red-500 text-white opacity-0 transition-opacity duration-[var(--duration-quick)] shadow-md group-hover:opacity-100 hover:scale-110"
      >
        <X className="size-3 stroke-[3]" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Image (transform)
// ---------------------------------------------------------------------------
const ImageSection = memo(function ImageSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-4">
      <ImagePositionControl
        imageScale={settings.imageScale ?? 1.0}
        imageOffsetX={settings.imageOffsetX ?? 0}
        imageOffsetY={settings.imageOffsetY ?? 0}
        onScaleChangeTransient={actions.setImageScaleTransient}
        onScaleChange={actions.setImageScale}
        onOffsetTransient={actions.setImageOffsetTransient}
        onOffsetCommit={actions.setImageOffset}
        onReset={actions.resetImageTransform}
        onIsDraggingChange={actions.setIsDragging}
      />
    </div>
  );
}, makeSettingsComparator("imageScale", "imageOffsetX", "imageOffsetY"));

// ---------------------------------------------------------------------------
// Section: Adjustments (sharpness / brightness / contrast / saturation)
// ---------------------------------------------------------------------------
const AdjustmentsSection = memo(function AdjustmentsSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Image Quality
        </span>
        <button
          type="button"
          onClick={actions.resetImageAdjustments}
          aria-label="Reset image adjustments"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <RotateCcw className="size-3" aria-hidden="true" />
        </button>
      </div>
      <RangeSliderDebounced
        label="Sharpness"
        value={settings.sharpness}
        format={(v) => `${v}%`}
        min={0}
        max={100}
        onValueChangeTransient={actions.setSharpnessTransient}
        onValueCommit={actions.setSharpness}
        onDragChange={actions.setIsDragging}
        aria-label="Sharpness"
      />
      <RangeSliderDebounced
        label="Brightness"
        value={settings.brightness}
        format={(v) => `${v > 0 ? "+" : ""}${v}%`}
        min={-100}
        max={100}
        onValueChangeTransient={actions.setBrightnessTransient}
        onValueCommit={actions.setBrightness}
        onDragChange={actions.setIsDragging}
        aria-label="Brightness"
      />
      <RangeSliderDebounced
        label="Contrast"
        value={settings.contrast}
        format={(v) => `${v > 0 ? "+" : ""}${v}%`}
        min={-100}
        max={100}
        onValueChangeTransient={actions.setContrastTransient}
        onValueCommit={actions.setContrast}
        onDragChange={actions.setIsDragging}
        aria-label="Contrast"
      />
      <RangeSliderDebounced
        label="Saturation"
        value={settings.saturation}
        format={(v) => `${v > 0 ? "+" : ""}${v}%`}
        min={-100}
        max={100}
        onValueChangeTransient={actions.setSaturationTransient}
        onValueCommit={actions.setSaturation}
        onDragChange={actions.setIsDragging}
        aria-label="Saturation"
      />
    </div>
  );
}, makeSettingsComparator("sharpness", "brightness", "contrast", "saturation"));

// ---------------------------------------------------------------------------
// Section: Effects (blur / noise)
// ---------------------------------------------------------------------------
const EffectsSection = memo(function EffectsSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Background Effects
        </span>
      </div>
      <RangeSliderDebounced
        label="Gaussian Blur"
        value={settings.blurAmount}
        format={(v) => `${v}px`}
        min={0}
        max={50}
        onValueChangeTransient={actions.setBlurAmountTransient}
        onValueCommit={actions.setBlurAmount}
        onDragChange={actions.setIsDragging}
        aria-label="Gaussian blur"
      />
      <RangeSliderDebounced
        label="Noise"
        value={settings.noiseAmount}
        format={(v) => `${v}%`}
        min={0}
        max={100}
        onValueChangeTransient={actions.setNoiseAmountTransient}
        onValueCommit={actions.setNoiseAmount}
        onDragChange={actions.setIsDragging}
        aria-label="Noise"
      />
    </div>
  );
}, makeSettingsComparator("blurAmount", "noiseAmount"));

// ---------------------------------------------------------------------------
// Section: Border
// ---------------------------------------------------------------------------
const BorderSection = memo(function BorderSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-4">
      <StyleSelector
        frameStyle={settings.frameStyle as FrameStyleId}
        framePadding={settings.framePadding}
        frameOpacity={settings.frameOpacity}
        onChange={actions.setFrameStyle}
        onFramePaddingChangeTransient={actions.setFramePaddingTransient}
        onFramePaddingChange={actions.setFramePadding}
        onFrameOpacityChangeTransient={actions.setFrameOpacityTransient}
        onFrameOpacityChange={actions.setFrameOpacity}
      />
      <BorderPresets
        borderPreset={settings.borderPreset}
        borderRadius={settings.borderRadius}
        onPresetChange={actions.setBorderPreset}
        onBorderRadiusChangeTransient={actions.setBorderRadiusTransient}
        onBorderRadiusChange={actions.setBorderRadius}
        onIsDraggingChange={actions.setIsDragging}
      />
    </div>
  );
}, makeSettingsComparator(
  "borderPreset",
  "borderRadius",
  "frameStyle",
  "framePadding",
  "frameOpacity"
));

// ---------------------------------------------------------------------------
// Section: Shadow
// ---------------------------------------------------------------------------
const ShadowSection = memo(function ShadowSection({
  settings,
  actions,
}: {
  settings: EditorSettings;
  actions: RightSidebarActions;
}) {
  return (
    <div className="space-y-4">
      <ShadowPresets
        shadowPreset={settings.shadowPreset}
        opacity={settings.shadow.opacity}
        showMockup={settings.showMockup}
        onPresetChange={actions.setShadowPreset}
        onOpacityChangeTransient={actions.setShadowOpacityTransient}
        onOpacityChange={actions.setShadowOpacity}
        onToggleMockup={() => actions.setShowMockup(!settings.showMockup)}
        onIsDraggingChange={actions.setIsDragging}
        showAdvanced
      >
        <div className="space-y-3 pt-2">
          <RangeSliderDebounced
            label="Blur"
            value={settings.shadow.blur}
            format={(v) => `${v}px`}
            min={0}
            max={80}
            onValueChangeTransient={actions.setShadowBlurTransient}
            onValueCommit={actions.setShadowBlur}
            onDragChange={actions.setIsDragging}
            aria-label="Shadow blur"
          />
          <RangeSliderDebounced
            label="Offset X"
            value={settings.shadow.offsetX}
            format={(v) => `${v}px`}
            min={-50}
            max={50}
            onValueCommit={actions.setShadowOffsetX}
            onDragChange={actions.setIsDragging}
            aria-label="Shadow offset X"
          />
          <RangeSliderDebounced
            label="Offset Y"
            value={settings.shadow.offsetY}
            format={(v) => `${v}px`}
            min={-50}
            max={50}
            onValueCommit={actions.setShadowOffsetY}
            onDragChange={actions.setIsDragging}
            aria-label="Shadow offset Y"
          />
        </div>
      </ShadowPresets>
    </div>
  );
},
// Shadow uses a nested object, so we compare each field instead of the ref
(prev, next) => {
  if (prev.actions !== next.actions) return false;
  if (prev.settings.shadowPreset !== next.settings.shadowPreset) return false;
  if (prev.settings.showMockup !== next.settings.showMockup) return false;
  const a = prev.settings.shadow;
  const b = next.settings.shadow;
  return (
    a.blur === b.blur &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.opacity === b.opacity
  );
});

// ---------------------------------------------------------------------------
// Section: Properties (annotation) — only renders when an annotation is selected
// ---------------------------------------------------------------------------
const PropertiesSection = memo(function PropertiesSection({
  selectedAnnotation,
  onAnnotationUpdate,
}: {
  selectedAnnotation: Annotation | null;
  onAnnotationUpdate: (annotation: Annotation) => void;
}) {
  if (!selectedAnnotation) {
    return (
      <div className="rounded-lg border border-dashed border-foreground/[0.08] bg-foreground/[0.02] p-4 text-center">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Select an annotation to edit its properties.
        </p>
      </div>
    );
  }
  return <PropertiesPanel annotation={selectedAnnotation} onUpdate={onAnnotationUpdate} />;
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function RightSidebar({
  settings,
  actions,
  previewUrl,
  selectedAnnotation,
  onAnnotationUpdate,
}: RightSidebarProps) {
  // Stable callbacks derived from previewUrl so the store memo is happy
  const lastPreview = useRef(previewUrl);
  useEffect(() => {
    lastPreview.current = previewUrl;
  }, [previewUrl]);

  // "Set as Default" lives at the top of the sidebar so it's reachable
  // no matter which section is open. Sibling of Cancel/Copy/Export.
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const handleSaveAsDefaults = async () => {
    if (!actions.saveEffectSettingsAsDefaults || isSavingDefaults) return;
    setIsSavingDefaults(true);
    try {
      await actions.saveEffectSettingsAsDefaults();
      setJustSaved(true);
      toast.success("All settings saved as defaults");
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      toast.error("Failed to save defaults");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  return (
    <div className="px-4 min-w-0 overflow-hidden">
      {actions.saveEffectSettingsAsDefaults && (
        <div className="flex items-center justify-between gap-2 pt-1 pb-1 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Default Style
            </p>
            <p className="truncate text-[10px] text-muted-foreground/70">
              Applies to every new capture
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveAsDefaults}
            disabled={isSavingDefaults}
            aria-label="Save current settings as the default for new captures"
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5",
              "text-[11px] font-semibold transition-all duration-[var(--duration-quick)]",
              justSaved
                ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/30"
                : "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80",
              "disabled:opacity-50 disabled:pointer-events-none"
            )}
          >
            <Bookmark
              className={cn(
                "size-3.5 transition-colors",
                justSaved ? "text-green-400" : "text-muted-foreground"
              )}
              aria-hidden="true"
            />
            {justSaved ? "Saved" : "Set as Default"}
          </button>
        </div>
      )}

      <Accordion title="Background" defaultOpen>
        <BackgroundSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion title="Image" defaultOpen={false}>
        <ImageSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion title="Adjustments" defaultOpen={false}>
        <AdjustmentsSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion title="Effects" defaultOpen={false}>
        <EffectsSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion title="Border" defaultOpen={false}>
        <BorderSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion title="Shadow" defaultOpen={false}>
        <ShadowSection settings={settings} actions={actions} />
      </Accordion>

      <Accordion
        title="Properties"
        defaultOpen={!!selectedAnnotation}
        hint={selectedAnnotation ? "1 selected" : undefined}
      >
        <PropertiesSection
          selectedAnnotation={selectedAnnotation}
          onAnnotationUpdate={onAnnotationUpdate}
        />
      </Accordion>
    </div>
  );
}
