import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { Store } from "@tauri-apps/plugin-store";
import { gradientOptions, type GradientOption } from "@/components/editor/BackgroundSelector";
import { resolveBackgroundPath, toStorableValue } from "@/lib/asset-registry";
import { Annotation } from "@/types/annotations";
import {
  type FrameStyleId,
  type LayoutPresetId,
  type BorderPresetId,
  type ShadowPresetId,
  getShadowPreset,
  borderRadiusForPreset,
  getFrameStyle,
} from "@/lib/frame-presets";

// ============================================================================
// Types
// ============================================================================

export type WindowFrameType = "none" | "macos" | "windows";

export type BackgroundType = "transparent" | "white" | "black" | "gray" | "gradient" | "custom" | "image";

export interface ShadowSettings {
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export type { FrameStyleId, LayoutPresetId, BorderPresetId, ShadowPresetId };

export interface EditorSettings {
  backgroundType: BackgroundType;
  customColor: string;
  selectedImageSrc: string | null;
  gradientId: string;
  gradientSrc: string;
  gradientColors: [string, string];
  blurAmount: number;
  noiseAmount: number;
  borderRadius: number;
  padding?: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  shadow: ShadowSettings;
  windowFrame: WindowFrameType;
  /** Visual frame chrome style (glass, inset, outline, …) */
  frameStyle: FrameStyleId;
  /** 3D-ish layout tilt preset */
  layoutPreset: LayoutPresetId;
  /** Border corner preset (sharp / curved / round) */
  borderPreset: BorderPresetId;
  /** Named shadow look (none / spread / hug / adaptive) */
  shadowPreset: ShadowPresetId;
  /** When false, mockup chrome (macOS/Windows title bar) is hidden */
  showMockup: boolean;
  /** Custom frame padding in px (overrides the style's built-in default) */
  framePadding: number;
  /** Frame chrome opacity 0–100 (100 = fully opaque) */
  frameOpacity: number;
  /** Screenshot zoom scale 0.5–2.0 (1.0 = original size) */
  imageScale: number;
  /** Screenshot horizontal offset in px */
  imageOffsetX: number;
  /** Screenshot vertical offset in px */
  imageOffsetY: number;
  /** Image sharpening 0–100% */
  sharpness: number;
  /** Image brightness -100–100% */
  brightness: number;
  /** Image contrast -100–100% */
  contrast: number;
  /** Image saturation -100–100% */
  saturation: number;
}

// Snapshot for undo/redo - stores complete state
interface HistorySnapshot {
  settings: EditorSettings;
  annotations: Annotation[];
}

interface EditorState {
  // Settings slice
  settings: EditorSettings;
  
  // Annotations slice
  annotations: Annotation[];
  
  // History slice
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  
  // Transient state (not part of history)
  _isInitialized: boolean;
  _historyPaused: boolean;
  /** True while a slider is being dragged. The preview generator checks
   *  this to skip the expensive canvas re-render during a drag and only
   *  re-renders once on commit. Keeps the app responsive. */
  _isDragging: boolean;
}

interface EditorActions {
  // Initialization
  initialize: () => Promise<void>;

  // Settings actions - immediate updates (no history push)
  updateSettingsTransient: (updates: Partial<EditorSettings>) => void;

  // Settings actions - commit to history
  updateSettings: (updates: Partial<EditorSettings>) => void;
  setBackgroundType: (type: BackgroundType) => void;
  setCustomColor: (color: string) => void;
  setSelectedImage: (src: string) => void;
  setGradient: (gradient: GradientOption) => void;
  handleImageSelect: (imageSrc: string) => void;

  // Transient settings (during slider drag)
  setBlurAmountTransient: (amount: number) => void;
  setNoiseAmountTransient: (amount: number) => void;
  setBorderRadiusTransient: (radius: number) => void;
  setPaddingTopTransient: (padding: number) => void;
  setPaddingBottomTransient: (padding: number) => void;
  setPaddingLeftTransient: (padding: number) => void;
  setPaddingRightTransient: (padding: number) => void;
  setAllPaddingTransient: (padding: number) => void;
  setPaddingTransient: (padding: number) => void;
  setShadowBlurTransient: (blur: number) => void;
  setShadowOffsetXTransient: (offsetX: number) => void;
  setShadowOffsetYTransient: (offsetY: number) => void;
  setShadowOpacityTransient: (opacity: number) => void;
  setSharpnessTransient: (amount: number) => void;
  setBrightnessTransient: (amount: number) => void;
  setContrastTransient: (amount: number) => void;
  setSaturationTransient: (amount: number) => void;

  // Commit settings (on slider release)
  setBlurAmount: (amount: number) => void;
  setNoiseAmount: (amount: number) => void;
  setBorderRadius: (radius: number) => void;
  setPaddingTop: (padding: number) => void;
  setPaddingBottom: (padding: number) => void;
  setPaddingLeft: (padding: number) => void;
  setPaddingRight: (padding: number) => void;
  setAllPadding: (padding: number) => void;
  setPadding: (padding: number) => void;
  setWindowFrame: (frame: WindowFrameType) => void;
  setShadowBlur: (blur: number) => void;
  setShadowOffsetX: (offsetX: number) => void;
  setShadowOffsetY: (offsetY: number) => void;
  setShadowOpacity: (opacity: number) => void;
  setSharpness: (amount: number) => void;
  setBrightness: (amount: number) => void;
  setContrast: (amount: number) => void;
  setSaturation: (amount: number) => void;
  resetImageAdjustments: () => void;

  // Frame / layout / border / shadow presets
  setFrameStyle: (style: FrameStyleId) => void;
  setLayoutPreset: (preset: LayoutPresetId) => void;
  setBorderPreset: (preset: BorderPresetId) => void;
  setShadowPreset: (preset: ShadowPresetId) => void;
  setShowMockup: (show: boolean) => void;
  // Frame chrome overrides
  setFramePaddingTransient: (padding: number) => void;
  setFramePadding: (padding: number) => void;
  setFrameOpacityTransient: (opacity: number) => void;
  setFrameOpacity: (opacity: number) => void;
  // Image scale + position
  setImageScaleTransient: (scale: number) => void;
  setImageScale: (scale: number) => void;
  setImageOffsetXTransient: (x: number) => void;
  setImageOffsetYTransient: (y: number) => void;
  setImageOffsetTransient: (x: number, y: number) => void;
  setImageOffset: (x: number, y: number) => void;
  resetImageTransform: () => void;

  // Persist effect settings as defaults
  saveEffectSettingsAsDefaults: () => Promise<void>;

  // Annotation actions
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotationTransient: (annotation: Annotation) => void;
  updateAnnotation: (annotation: Annotation) => void;
  deleteAnnotation: (id: string) => void;
  setAnnotations: (annotations: Annotation[]) => void;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  pauseHistory: () => void;
  resumeHistory: () => void;

  // Reset
  reset: () => void;

  // Transient UI flags (not part of history)
  setIsDragging: (dragging: boolean) => void;
}

export type EditorStore = EditorState & EditorActions;

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE = 50;
const DEFAULT_GRADIENT = gradientOptions[0];

export const DEFAULT_SETTINGS: EditorSettings = {
  backgroundType: "white",
  customColor: "#667eea",
  selectedImageSrc: null,
  gradientId: DEFAULT_GRADIENT.id,
  gradientSrc: DEFAULT_GRADIENT.src,
  gradientColors: DEFAULT_GRADIENT.colors,
  blurAmount: 0,
  noiseAmount: 20,
  borderRadius: 12,
  padding: 100,
  paddingTop: 100,
  paddingBottom: 100,
  paddingLeft: 100,
  paddingRight: 100,
  shadow: {
    blur: 33,
    offsetX: 18,
    offsetY: 23,
    opacity: 39,
  },
  windowFrame: "none",
  frameStyle: "default",
  layoutPreset: "flat",
  borderPreset: "curved",
  shadowPreset: "spread",
  showMockup: true,
  framePadding: 0,
  frameOpacity: 100,
  imageScale: 1.0,
  imageOffsetX: 0,
  imageOffsetY: 0,
  sharpness: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

const INITIAL_STATE: EditorState = {
  settings: DEFAULT_SETTINGS,
  annotations: [],
  past: [],
  future: [],
  _isInitialized: false,
  _historyPaused: false,
  _isDragging: false,
};

// ============================================================================
// Store
// ============================================================================

export const useEditorStore = create<EditorStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...INITIAL_STATE,

      // ========================================
      // Initialization
      // ========================================
      initialize: async () => {
        if (get()._isInitialized) return;

        try {
          const store = await Store.load("settings.json");

          // Load background settings
          const storedBgType = await store.get<BackgroundType>("defaultBackgroundType");
          const storedCustomColor = await store.get<string>("defaultCustomColor");
          const storedBg = await store.get<string>("defaultBackgroundImage");

          // Load effect settings
          const storedBlurAmount = await store.get<number>("defaultBlurAmount");
          const storedNoiseAmount = await store.get<number>("defaultNoiseAmount");
          const storedBorderRadius = await store.get<number>("defaultBorderRadius");
          const storedShadow = await store.get<ShadowSettings>("defaultShadow");
          const storedSharpness = await store.get<number>("defaultSharpness");
          const storedBrightness = await store.get<number>("defaultBrightness");
          const storedContrast = await store.get<number>("defaultContrast");
          const storedSaturation = await store.get<number>("defaultSaturation");

          // Load style settings
          const storedFrameStyle = await store.get<FrameStyleId>("defaultFrameStyle");
          const storedLayoutPreset = await store.get<LayoutPresetId>("defaultLayoutPreset");
          const storedBorderPreset = await store.get<BorderPresetId>("defaultBorderPreset");
          const storedShadowPreset = await store.get<ShadowPresetId>("defaultShadowPreset");
          const storedWindowFrame = await store.get<WindowFrameType>("defaultWindowFrame");
          const storedShowMockup = await store.get<boolean>("defaultShowMockup");
          const storedFramePadding = await store.get<number>("defaultFramePadding");
          const storedFrameOpacity = await store.get<number>("defaultFrameOpacity");
          const storedImageScale = await store.get<number>("defaultImageScale");
          const storedImageOffsetX = await store.get<number>("defaultImageOffsetX");
          const storedImageOffsetY = await store.get<number>("defaultImageOffsetY");

          // Load padding defaults
          const storedPaddingTop = await store.get<number>("defaultPaddingTop");
          const storedPaddingBottom = await store.get<number>("defaultPaddingBottom");
          const storedPaddingLeft = await store.get<number>("defaultPaddingLeft");
          const storedPaddingRight = await store.get<number>("defaultPaddingRight");

          set((state) => {
            // Apply background settings from preferences only
            if (storedBgType) {
              state.settings.backgroundType = storedBgType;
            }
            if (storedCustomColor) {
              state.settings.customColor = storedCustomColor;
            }
            if (storedBg) {
              if (storedBgType === "image") {
                const resolvedPath = resolveBackgroundPath(storedBg);
                state.settings.selectedImageSrc = resolvedPath;
              }

              if (storedBgType === "gradient" || (storedBg && (storedBg.startsWith("gradient-") || storedBg.startsWith("mesh-")))) {
                const normalizedId = storedBg ? storedBg.replace("gradient-", "mesh-") : "mesh-1";
                const gradient = gradientOptions.find(
                  (option) => option.id === normalizedId || option.id === storedBg
                ) || gradientOptions[0];

                if (gradient) {
                  state.settings.gradientId = gradient.id;
                  state.settings.gradientSrc = gradient.src;
                  state.settings.gradientColors = gradient.colors;
                }
              }
            } else if (storedBgType) {
              // If background type is set but no image, ensure selectedImageSrc is null
              if (storedBgType !== "image" && storedBgType !== "gradient") {
                state.settings.selectedImageSrc = null;
              }
            }

            // Apply effect settings (padding is calculated dynamically, not loaded from defaults)
            if (storedBlurAmount !== null && storedBlurAmount !== undefined) {
              state.settings.blurAmount = storedBlurAmount;
            }
            if (storedNoiseAmount !== null && storedNoiseAmount !== undefined) {
              state.settings.noiseAmount = storedNoiseAmount;
            }
            if (storedBorderRadius !== null && storedBorderRadius !== undefined) {
              state.settings.borderRadius = storedBorderRadius;
            }
            if (storedShadow) {
              state.settings.shadow = storedShadow;
            }
            if (storedSharpness !== null && storedSharpness !== undefined) {
              state.settings.sharpness = storedSharpness;
            }
            if (storedBrightness !== null && storedBrightness !== undefined) {
              state.settings.brightness = storedBrightness;
            }
            if (storedContrast !== null && storedContrast !== undefined) {
              state.settings.contrast = storedContrast;
            }
            if (storedSaturation !== null && storedSaturation !== undefined) {
              state.settings.saturation = storedSaturation;
            }

            // Apply style settings
            if (storedFrameStyle) state.settings.frameStyle = storedFrameStyle;
            if (storedLayoutPreset) state.settings.layoutPreset = storedLayoutPreset;
            if (storedBorderPreset) state.settings.borderPreset = storedBorderPreset;
            if (storedShadowPreset) state.settings.shadowPreset = storedShadowPreset;
            if (storedWindowFrame) state.settings.windowFrame = storedWindowFrame;
            if (storedShowMockup !== null && storedShowMockup !== undefined) {
              state.settings.showMockup = storedShowMockup;
            }
            if (storedFramePadding !== null && storedFramePadding !== undefined) {
              state.settings.framePadding = storedFramePadding;
            }
            if (storedFrameOpacity !== null && storedFrameOpacity !== undefined) {
              state.settings.frameOpacity = storedFrameOpacity;
            }
            if (storedImageScale !== null && storedImageScale !== undefined) {
              state.settings.imageScale = storedImageScale;
            }
            if (storedImageOffsetX !== null && storedImageOffsetX !== undefined) {
              state.settings.imageOffsetX = storedImageOffsetX;
            }
            if (storedImageOffsetY !== null && storedImageOffsetY !== undefined) {
              state.settings.imageOffsetY = storedImageOffsetY;
            }

            // Apply padding defaults
            if (storedPaddingTop !== null && storedPaddingTop !== undefined) {
              state.settings.paddingTop = storedPaddingTop;
            }
            if (storedPaddingBottom !== null && storedPaddingBottom !== undefined) {
              state.settings.paddingBottom = storedPaddingBottom;
            }
            if (storedPaddingLeft !== null && storedPaddingLeft !== undefined) {
              state.settings.paddingLeft = storedPaddingLeft;
            }
            if (storedPaddingRight !== null && storedPaddingRight !== undefined) {
              state.settings.paddingRight = storedPaddingRight;
            }

            state._isInitialized = true;
          });
        } catch (err) {
          console.error("Failed to load default settings from store:", err);
          set((state) => {
            state._isInitialized = true;
          });
        }
      },

      // ========================================
      // Settings - Transient (no history)
      // ========================================
      updateSettingsTransient: (updates) => {
        set((state) => {
          Object.assign(state.settings, updates);
        });
      },

      // ========================================
      // Settings - With History
      // ========================================
      updateSettings: (updates) => {
        const state = get();
        if (!state._historyPaused) {
          get().pushHistory();
        }
        set((state) => {
          Object.assign(state.settings, updates);
          state.future = [];
        });
      },

      setBackgroundType: (type) => {
        get().updateSettings({ backgroundType: type });
      },

      setWindowFrame: (frame) => {
        get().updateSettings({ windowFrame: frame, showMockup: frame !== "none" });
      },

      setFrameStyle: (style) => {
        // Reset frame overrides to the new style's built-in defaults
        const styleDef = getFrameStyle(style);
        get().updateSettings({
          frameStyle: style,
          framePadding: styleDef.padding,
          frameOpacity: 100,
        });
      },

      setLayoutPreset: (preset) => {
        get().updateSettings({ layoutPreset: preset });
      },

      setBorderPreset: (preset) => {
        const radius = borderRadiusForPreset(preset);
        get().updateSettings({ borderPreset: preset, borderRadius: radius });
      },

      setShadowPreset: (preset) => {
        const shadow = getShadowPreset(preset);
        // Keep current opacity if user already tuned it and preset isn't "none"
        const currentOpacity = get().settings.shadow.opacity;
        get().updateSettings({
          shadowPreset: preset,
          shadow: {
            ...shadow,
            opacity: preset === "none" ? 0 : currentOpacity || shadow.opacity,
          },
        });
      },

      setFramePaddingTransient: (padding) => {
        set((state) => {
          state.settings.framePadding = padding;
        });
      },

      setFramePadding: (padding) => {
        get().updateSettings({ framePadding: padding });
      },

      setFrameOpacityTransient: (opacity) => {
        set((state) => {
          state.settings.frameOpacity = opacity;
        });
      },

      setFrameOpacity: (opacity) => {
        get().updateSettings({ frameOpacity: opacity });
      },

      setImageScaleTransient: (scale) => {
        set((state) => { state.settings.imageScale = scale; });
      },

      setImageScale: (scale) => {
        get().updateSettings({ imageScale: scale });
      },

      setImageOffsetXTransient: (x) => {
        set((state) => { state.settings.imageOffsetX = x; });
      },

      setImageOffsetYTransient: (y) => {
        set((state) => { state.settings.imageOffsetY = y; });
      },

      setImageOffsetTransient: (x, y) => {
        set((state) => {
          state.settings.imageOffsetX = x;
          state.settings.imageOffsetY = y;
        });
      },

      setImageOffset: (x, y) => {
        get().updateSettings({ imageOffsetX: x, imageOffsetY: y });
      },

      resetImageTransform: () => {
        get().updateSettings({ imageScale: 1.0, imageOffsetX: 0, imageOffsetY: 0 });
      },

      setShowMockup: (show) => {
        const state = get();
        // Hiding mockup forces frame to none visually; restoring uses last non-none or macos
        if (!show) {
          get().updateSettings({ showMockup: false });
        } else {
          const frame =
            state.settings.windowFrame === "none" ? "macos" : state.settings.windowFrame;
          get().updateSettings({ showMockup: true, windowFrame: frame });
        }
      },

      setCustomColor: (color) => {
        get().updateSettings({ customColor: color });
      },

      setSelectedImage: (src) => {
        get().updateSettings({ selectedImageSrc: src });
      },

      setGradient: (gradient) => {
        get().updateSettings({
          backgroundType: "gradient",
          selectedImageSrc: null,
          gradientId: gradient.id,
          gradientSrc: gradient.src,
          gradientColors: gradient.colors,
        });
      },

      handleImageSelect: (imageSrc) => {
        get().updateSettings({
          selectedImageSrc: imageSrc,
          backgroundType: "image",
        });
      },

      // ========================================
      // Slider Settings - Transient (during drag)
      // ========================================
      setBlurAmountTransient: (amount) => {
        set((state) => {
          state.settings.blurAmount = amount;
        });
      },

      setNoiseAmountTransient: (amount) => {
        set((state) => {
          state.settings.noiseAmount = amount;
        });
      },

      setBorderRadiusTransient: (radius) => {
        set((state) => {
          state.settings.borderRadius = radius;
        });
      },

      setPaddingTopTransient: (padding) => {
        set((state) => {
          state.settings.paddingTop = padding;
        });
      },

      setPaddingBottomTransient: (padding) => {
        set((state) => {
          state.settings.paddingBottom = padding;
        });
      },

      setPaddingLeftTransient: (padding) => {
        set((state) => {
          state.settings.paddingLeft = padding;
        });
      },

      setPaddingRightTransient: (padding) => {
        set((state) => {
          state.settings.paddingRight = padding;
        });
      },

      setAllPaddingTransient: (padding) => {
        set((state) => {
          state.settings.paddingTop = padding;
          state.settings.paddingBottom = padding;
          state.settings.paddingLeft = padding;
          state.settings.paddingRight = padding;
          state.settings.padding = padding;
        });
      },

      setPaddingTransient: (padding) => {
        get().setAllPaddingTransient(padding);
      },

      setShadowBlurTransient: (blur) => {
        set((state) => {
          state.settings.shadow.blur = blur;
        });
      },

      setShadowOffsetXTransient: (offsetX) => {
        set((state) => {
          state.settings.shadow.offsetX = offsetX;
        });
      },

      setShadowOffsetYTransient: (offsetY) => {
        set((state) => {
          state.settings.shadow.offsetY = offsetY;
        });
      },

      setShadowOpacityTransient: (opacity) => {
        set((state) => {
          state.settings.shadow.opacity = opacity;
        });
      },

      setSharpnessTransient: (amount) => {
        set((state) => {
          state.settings.sharpness = amount;
        });
      },

      setBrightnessTransient: (amount) => {
        set((state) => {
          state.settings.brightness = amount;
        });
      },

      setContrastTransient: (amount) => {
        set((state) => {
          state.settings.contrast = amount;
        });
      },

      setSaturationTransient: (amount) => {
        set((state) => {
          state.settings.saturation = amount;
        });
      },

      // ========================================
      // Slider Settings - Commit (on release)
      // ========================================
      setBlurAmount: (amount) => {
        get().updateSettings({ blurAmount: amount });
      },

      setNoiseAmount: (amount) => {
        get().updateSettings({ noiseAmount: amount });
      },

      setBorderRadius: (radius) => {
        // Manual radius edit → treat as custom "curved" preset
        get().updateSettings({ borderRadius: radius, borderPreset: "curved" });
      },

      setPaddingTop: (padding) => {
        get().updateSettings({ paddingTop: padding });
      },

      setPaddingBottom: (padding) => {
        get().updateSettings({ paddingBottom: padding });
      },

      setPaddingLeft: (padding) => {
        get().updateSettings({ paddingLeft: padding });
      },

      setPaddingRight: (padding) => {
        get().updateSettings({ paddingRight: padding });
      },

      setAllPadding: (padding) => {
        get().updateSettings({ 
          paddingTop: padding, 
          paddingBottom: padding, 
          paddingLeft: padding, 
          paddingRight: padding,
          padding: padding,
        });
      },

      setPadding: (padding) => {
        get().setAllPadding(padding);
      },

      setShadowBlur: (blur) => {
        get().pushHistory();
        set((s) => {
          s.settings.shadow.blur = blur;
          s.future = [];
        });
      },

      setShadowOffsetX: (offsetX) => {
        get().pushHistory();
        set((state) => {
          state.settings.shadow.offsetX = offsetX;
          state.future = [];
        });
      },

      setShadowOffsetY: (offsetY) => {
        get().pushHistory();
        set((state) => {
          state.settings.shadow.offsetY = offsetY;
          state.future = [];
        });
      },

      setShadowOpacity: (opacity) => {
        get().pushHistory();
        set((state) => {
          state.settings.shadow.opacity = opacity;
          // Re-enable a shadow look if opacity is raised from none
          if (opacity > 0 && state.settings.shadowPreset === "none") {
            state.settings.shadowPreset = "spread";
          }
          if (opacity === 0) {
            state.settings.shadowPreset = "none";
          }
          state.future = [];
        });
      },

      setSharpness: (amount) => {
        get().updateSettings({ sharpness: amount });
      },

      setBrightness: (amount) => {
        get().updateSettings({ brightness: amount });
      },

      setContrast: (amount) => {
        get().updateSettings({ contrast: amount });
      },

      setSaturation: (amount) => {
        get().updateSettings({ saturation: amount });
      },

      resetImageAdjustments: () => {
        get().updateSettings({
          sharpness: 0,
          brightness: 0,
          contrast: 0,
          saturation: 0,
        });
      },

      // ========================================
      // Persist Effect Settings
      // ========================================
      saveEffectSettingsAsDefaults: async () => {
        const state = get();
        try {
          const store = await Store.load("settings.json");

          // Background settings
          const { backgroundType, selectedImageSrc, customColor, gradientId } = state.settings;
          await store.set("defaultBackgroundType", backgroundType);
          if (backgroundType === "image") {
            const storableImage = selectedImageSrc ? toStorableValue(selectedImageSrc) : null;
            await store.set("defaultBackgroundImage", storableImage);
          } else if (backgroundType === "gradient") {
            const storableGradient = gradientId.replace("mesh-", "gradient-");
            await store.set("defaultBackgroundImage", storableGradient);
          } else if (backgroundType === "custom") {
            await store.set("defaultCustomColor", customColor);
            await store.set("defaultBackgroundImage", null);
          } else {
            await store.set("defaultBackgroundImage", null);
          }

          // Effect settings
          await store.set("defaultBlurAmount", state.settings.blurAmount);
          await store.set("defaultNoiseAmount", state.settings.noiseAmount);
          await store.set("defaultBorderRadius", state.settings.borderRadius);
          await store.set("defaultShadow", state.settings.shadow);
          await store.set("defaultSharpness", state.settings.sharpness);
          await store.set("defaultBrightness", state.settings.brightness);
          await store.set("defaultContrast", state.settings.contrast);
          await store.set("defaultSaturation", state.settings.saturation);

          // Padding — all four sides. The user explicitly adjusts the
          // padding slider and expects "Set as Default" to remember it.
          await store.set("defaultPaddingTop", state.settings.paddingTop);
          await store.set("defaultPaddingBottom", state.settings.paddingBottom);
          await store.set("defaultPaddingLeft", state.settings.paddingLeft);
          await store.set("defaultPaddingRight", state.settings.paddingRight);

          // Style settings
          await store.set("defaultFrameStyle", state.settings.frameStyle);
          await store.set("defaultLayoutPreset", state.settings.layoutPreset);
          await store.set("defaultBorderPreset", state.settings.borderPreset);
          await store.set("defaultShadowPreset", state.settings.shadowPreset);
          await store.set("defaultWindowFrame", state.settings.windowFrame);
          await store.set("defaultShowMockup", state.settings.showMockup);
          await store.set("defaultFramePadding", state.settings.framePadding);
          await store.set("defaultFrameOpacity", state.settings.frameOpacity);
          await store.set("defaultImageScale", state.settings.imageScale);
          await store.set("defaultImageOffsetX", state.settings.imageOffsetX);
          await store.set("defaultImageOffsetY", state.settings.imageOffsetY);
          await store.save();
        } catch (err) {
          console.error("Failed to save effect settings as defaults:", err);
          throw err;
        }
      },

      // ========================================
      // Annotations
      // ========================================
      addAnnotation: (annotation) => {
        get().pushHistory();
        set((state) => {
          state.annotations.push(annotation);
          state.future = [];
        });
      },

      updateAnnotationTransient: (annotation) => {
        set((state) => {
          const index = state.annotations.findIndex((a) => a.id === annotation.id);
          if (index !== -1) {
            state.annotations[index] = annotation;
          }
        });
      },

      updateAnnotation: (annotation) => {
        get().pushHistory();
        set((state) => {
          const index = state.annotations.findIndex((a) => a.id === annotation.id);
          if (index !== -1) {
            state.annotations[index] = annotation;
          }
          state.future = [];
        });
      },

      deleteAnnotation: (id) => {
        get().pushHistory();
        set((state) => {
          state.annotations = state.annotations.filter((a) => a.id !== id);
          state.future = [];
        });
      },

      setAnnotations: (annotations) => {
        get().pushHistory();
        set((state) => {
          state.annotations = annotations;
          state.future = [];
        });
      },

      // ========================================
      // History
      // ========================================
      pushHistory: () => {
        const state = get();
        if (state._historyPaused) return;
        
        const snapshot: HistorySnapshot = {
          settings: structuredClone(state.settings),
          annotations: structuredClone(state.annotations),
        };
        
        set((s) => {
          if (s.past.length >= MAX_HISTORY_SIZE) {
            s.past = [...s.past.slice(1), snapshot];
          } else {
            s.past = [...s.past, snapshot];
          }
        });
      },

      pauseHistory: () => {
        set((state) => {
          state._historyPaused = true;
        });
      },

      resumeHistory: () => {
        set((state) => {
          state._historyPaused = false;
        });
      },

      setIsDragging: (dragging) => {
        set((state) => {
          state._isDragging = dragging;
        });
      },

      undo: () => {
        const state = get();
        if (state.past.length === 0) return;

        const previous = state.past[state.past.length - 1];
        const currentSnapshot: HistorySnapshot = {
          settings: structuredClone(state.settings),
          annotations: structuredClone(state.annotations),
        };

        set((s) => {
          s.past = s.past.slice(0, -1);
          s.future = [currentSnapshot, ...s.future].slice(0, MAX_HISTORY_SIZE);
          s.settings = previous.settings;
          s.annotations = previous.annotations;
        });
      },

      redo: () => {
        const state = get();
        if (state.future.length === 0) return;

        const next = state.future[0];
        const currentSnapshot: HistorySnapshot = {
          settings: structuredClone(state.settings),
          annotations: structuredClone(state.annotations),
        };

        set((s) => {
          s.future = s.future.slice(1);
          s.past = [...s.past, currentSnapshot].slice(-MAX_HISTORY_SIZE);
          s.settings = next.settings;
          s.annotations = next.annotations;
        });
      },

      // ========================================
      // Reset
      // ========================================
      reset: () => {
        set((state) => {
          state.settings = structuredClone(DEFAULT_SETTINGS);
          state.annotations = [];
          state.past = [];
          state.future = [];
          state._isInitialized = false;
        });
      },
    }))
  )
);

// ============================================================================
// Selectors (for optimized re-renders)
// ============================================================================

// Settings selectors
export const useSettings = () => useEditorStore((state) => state.settings);
export const useCustomColor = () => useEditorStore((state) => state.settings.customColor);
export const useBackgroundType = () => useEditorStore((state) => state.settings.backgroundType);
export const useBlurAmount = () => useEditorStore((state) => state.settings.blurAmount);
export const useNoiseAmount = () => useEditorStore((state) => state.settings.noiseAmount);
export const useBorderRadius = () => useEditorStore((state) => state.settings.borderRadius);
export const usePaddingTop = () => useEditorStore((state) => state.settings.paddingTop);
export const usePaddingBottom = () => useEditorStore((state) => state.settings.paddingBottom);
export const usePaddingLeft = () => useEditorStore((state) => state.settings.paddingLeft);
export const usePaddingRight = () => useEditorStore((state) => state.settings.paddingRight);
export const usePadding = () => useEditorStore((state) => state.settings.padding ?? state.settings.paddingTop);
export const useShadow = () => useEditorStore((state) => state.settings.shadow);
export const useShadowBlur = () => useEditorStore((state) => state.settings.shadow.blur);
export const useShadowOffsetX = () => useEditorStore((state) => state.settings.shadow.offsetX);
export const useShadowOffsetY = () => useEditorStore((state) => state.settings.shadow.offsetY);
export const useShadowOpacity = () => useEditorStore((state) => state.settings.shadow.opacity);
export const useSelectedImageSrc = () => useEditorStore((state) => state.settings.selectedImageSrc);
export const useGradientId = () => useEditorStore((state) => state.settings.gradientId);
export const useWindowFrame = () => useEditorStore((state) => state.settings.windowFrame);
export const useFrameStyle = () => useEditorStore((state) => state.settings.frameStyle);
export const useLayoutPreset = () => useEditorStore((state) => state.settings.layoutPreset);
export const useBorderPreset = () => useEditorStore((state) => state.settings.borderPreset);
export const useShadowPreset = () => useEditorStore((state) => state.settings.shadowPreset);
export const useShowMockup = () => useEditorStore((state) => state.settings.showMockup);
export const useFramePadding = () => useEditorStore((state) => state.settings.framePadding);
export const useFrameOpacity = () => useEditorStore((state) => state.settings.frameOpacity);
export const useImageScale = () => useEditorStore((state) => state.settings.imageScale);
export const useImageOffsetX = () => useEditorStore((state) => state.settings.imageOffsetX);
export const useImageOffsetY = () => useEditorStore((state) => state.settings.imageOffsetY);
export const useSharpness = () => useEditorStore((state) => state.settings.sharpness ?? 0);
export const useBrightness = () => useEditorStore((state) => state.settings.brightness ?? 0);
export const useContrast = () => useEditorStore((state) => state.settings.contrast ?? 0);
export const useSaturation = () => useEditorStore((state) => state.settings.saturation ?? 0);

// Annotation selectors
export const useAnnotations = () => useEditorStore((state) => state.annotations);

// History selectors
export const useCanUndo = () => useEditorStore((state) => state.past.length > 0);
export const useCanRedo = () => useEditorStore((state) => state.future.length > 0);

// Actions - accessed directly from store to ensure stable references
// These functions are defined once in the store and never change
export const editorActions = {
  get initialize() { return useEditorStore.getState().initialize; },
  get setBackgroundType() { return useEditorStore.getState().setBackgroundType; },
  get setWindowFrame() { return useEditorStore.getState().setWindowFrame; },
  get setFrameStyle() { return useEditorStore.getState().setFrameStyle; },
  get setLayoutPreset() { return useEditorStore.getState().setLayoutPreset; },
  get setBorderPreset() { return useEditorStore.getState().setBorderPreset; },
  get setShadowPreset() { return useEditorStore.getState().setShadowPreset; },
  get setShowMockup() { return useEditorStore.getState().setShowMockup; },
  get setFramePaddingTransient() { return useEditorStore.getState().setFramePaddingTransient; },
  get setFramePadding() { return useEditorStore.getState().setFramePadding; },
  get setFrameOpacityTransient() { return useEditorStore.getState().setFrameOpacityTransient; },
  get setFrameOpacity() { return useEditorStore.getState().setFrameOpacity; },
  get setImageScaleTransient() { return useEditorStore.getState().setImageScaleTransient; },
  get setImageScale() { return useEditorStore.getState().setImageScale; },
  get setImageOffsetXTransient() { return useEditorStore.getState().setImageOffsetXTransient; },
  get setImageOffsetYTransient() { return useEditorStore.getState().setImageOffsetYTransient; },
  get setImageOffsetTransient() { return useEditorStore.getState().setImageOffsetTransient; },
  get setImageOffset() { return useEditorStore.getState().setImageOffset; },
  get resetImageTransform() { return useEditorStore.getState().resetImageTransform; },
  get setCustomColor() { return useEditorStore.getState().setCustomColor; },
  get setSelectedImage() { return useEditorStore.getState().setSelectedImage; },
  get setGradient() { return useEditorStore.getState().setGradient; },
  get handleImageSelect() { return useEditorStore.getState().handleImageSelect; },
  get setBlurAmount() { return useEditorStore.getState().setBlurAmount; },
  get setBlurAmountTransient() { return useEditorStore.getState().setBlurAmountTransient; },
  get setNoiseAmount() { return useEditorStore.getState().setNoiseAmount; },
  get setNoiseAmountTransient() { return useEditorStore.getState().setNoiseAmountTransient; },
  get setBorderRadius() { return useEditorStore.getState().setBorderRadius; },
  get setBorderRadiusTransient() { return useEditorStore.getState().setBorderRadiusTransient; },
  get setPaddingTop() { return useEditorStore.getState().setPaddingTop; },
  get setPaddingTopTransient() { return useEditorStore.getState().setPaddingTopTransient; },
  get setPaddingBottom() { return useEditorStore.getState().setPaddingBottom; },
  get setPaddingBottomTransient() { return useEditorStore.getState().setPaddingBottomTransient; },
  get setPaddingLeft() { return useEditorStore.getState().setPaddingLeft; },
  get setPaddingLeftTransient() { return useEditorStore.getState().setPaddingLeftTransient; },
  get setPaddingRight() { return useEditorStore.getState().setPaddingRight; },
  get setPaddingRightTransient() { return useEditorStore.getState().setPaddingRightTransient; },
  get setAllPadding() { return useEditorStore.getState().setAllPadding; },
  get setAllPaddingTransient() { return useEditorStore.getState().setAllPaddingTransient; },
  get setPadding() { return useEditorStore.getState().setPadding; },
  get setPaddingTransient() { return useEditorStore.getState().setPaddingTransient; },
  get setShadowBlur() { return useEditorStore.getState().setShadowBlur; },
  get setShadowBlurTransient() { return useEditorStore.getState().setShadowBlurTransient; },
  get setShadowOffsetX() { return useEditorStore.getState().setShadowOffsetX; },
  get setShadowOffsetXTransient() { return useEditorStore.getState().setShadowOffsetXTransient; },
  get setShadowOffsetY() { return useEditorStore.getState().setShadowOffsetY; },
  get setShadowOffsetYTransient() { return useEditorStore.getState().setShadowOffsetYTransient; },
  get setShadowOpacity() { return useEditorStore.getState().setShadowOpacity; },
  get setShadowOpacityTransient() { return useEditorStore.getState().setShadowOpacityTransient; },
  get setSharpness() { return useEditorStore.getState().setSharpness; },
  get setSharpnessTransient() { return useEditorStore.getState().setSharpnessTransient; },
  get setBrightness() { return useEditorStore.getState().setBrightness; },
  get setBrightnessTransient() { return useEditorStore.getState().setBrightnessTransient; },
  get setContrast() { return useEditorStore.getState().setContrast; },
  get setContrastTransient() { return useEditorStore.getState().setContrastTransient; },
  get setSaturation() { return useEditorStore.getState().setSaturation; },
  get setSaturationTransient() { return useEditorStore.getState().setSaturationTransient; },
  get resetImageAdjustments() { return useEditorStore.getState().resetImageAdjustments; },
  get saveEffectSettingsAsDefaults() { return useEditorStore.getState().saveEffectSettingsAsDefaults; },
  get addAnnotation() { return useEditorStore.getState().addAnnotation; },
  get updateAnnotation() { return useEditorStore.getState().updateAnnotation; },
  get updateAnnotationTransient() { return useEditorStore.getState().updateAnnotationTransient; },
  get deleteAnnotation() { return useEditorStore.getState().deleteAnnotation; },
  get setAnnotations() { return useEditorStore.getState().setAnnotations; },
  get undo() { return useEditorStore.getState().undo; },
  get redo() { return useEditorStore.getState().redo; },
  get pushHistory() { return useEditorStore.getState().pushHistory; },
  get pauseHistory() { return useEditorStore.getState().pauseHistory; },
  get resumeHistory() { return useEditorStore.getState().resumeHistory; },
  get reset() { return useEditorStore.getState().reset; },
  get setIsDragging() { return useEditorStore.getState().setIsDragging; },
};

// Hook version - returns the stable actions object
export const useEditorActions = () => editorActions;
