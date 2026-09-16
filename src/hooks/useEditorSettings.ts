import { useState, useCallback, useMemo, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { gradientOptions, type GradientOption } from "@/components/editor/BackgroundSelector";
import { resolveBackgroundPath, getDefaultBackgroundPath } from "@/lib/asset-registry";

export type BackgroundType = "transparent" | "white" | "black" | "gray" | "gradient" | "custom" | "image";

export interface ShadowSettings {
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

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
  shadow: ShadowSettings;
}

export interface EditorSettingsActions {
  setBackgroundType: (type: BackgroundType) => void;
  setCustomColor: (color: string) => void;
  setSelectedImage: (src: string) => void;
  setGradient: (gradient: GradientOption) => void;
  setBlurAmount: (amount: number) => void;
  setNoiseAmount: (amount: number) => void;
  setBorderRadius: (radius: number) => void;
  handleImageSelect: (imageSrc: string) => void;
  setShadowBlur: (blur: number) => void;
  setShadowOffsetX: (offsetX: number) => void;
  setShadowOffsetY: (offsetY: number) => void;
  setShadowOpacity: (opacity: number) => void;
}

const DEFAULT_GRADIENT = gradientOptions[0];
const DEFAULT_IMAGE = getDefaultBackgroundPath();

export function useEditorSettings(): [EditorSettings, EditorSettingsActions] {
  // Background state
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("image");
  const [customColor, setCustomColor] = useState("#667eea");
  const [selectedImageSrc, setSelectedImageSrc] = useState<string | null>(DEFAULT_IMAGE);
  
  // Store gradient as primitive values to avoid reference issues
  const [gradientId, setGradientId] = useState(DEFAULT_GRADIENT.id);
  const [gradientSrc, setGradientSrc] = useState(DEFAULT_GRADIENT.src);
  const [gradientColors, setGradientColors] = useState<[string, string]>(DEFAULT_GRADIENT.colors);
  
  // Effects state
  const [blurAmount, setBlurAmount] = useState(0);
  const [noiseAmount, setNoiseAmount] = useState(0);
  const [borderRadius, setBorderRadius] = useState(12);
  
  // Shadow state
  const [shadowBlur, setShadowBlur] = useState(33);
  const [shadowOffsetX, setShadowOffsetX] = useState(18);
  const [shadowOffsetY, setShadowOffsetY] = useState(23);
  const [shadowOpacity, setShadowOpacity] = useState(39);

  // Load default background from store on mount
  useEffect(() => {
    const loadDefaultBackground = async () => {
      try {
        const store = await Store.load("settings.json");
        const storedBgType = await store.get<BackgroundType>("defaultBackgroundType");
        const storedCustomColor = await store.get<string>("defaultCustomColor");
        const storedBg = await store.get<string>("defaultBackgroundImage");
        
        if (storedBgType) {
          setBackgroundType(storedBgType);
        }
        if (storedCustomColor) {
          setCustomColor(storedCustomColor);
        }
        if (storedBg) {
          if (storedBgType === "image") {
            const resolvedPath = resolveBackgroundPath(storedBg);
            setSelectedImageSrc(resolvedPath);
          }

          if (storedBg.startsWith("gradient-")) {
            const gradientIndex = storedBg.replace("gradient-", "");
            const gradient = gradientOptions.find(
              (option) => option.id === `mesh-${gradientIndex}`
            );

            if (gradient) {
              setGradient(gradient);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load default background from store:", err);
      }
    };
    loadDefaultBackground();
  }, []);

  // Memoized settings object - only changes when actual values change
  const settings = useMemo<EditorSettings>(() => ({
    backgroundType,
    customColor,
    selectedImageSrc,
    gradientId,
    gradientSrc,
    gradientColors,
    blurAmount,
    noiseAmount,
    borderRadius,
    shadow: {
      blur: shadowBlur,
      offsetX: shadowOffsetX,
      offsetY: shadowOffsetY,
      opacity: shadowOpacity,
    },
  }), [
    backgroundType,
    customColor,
    selectedImageSrc,
    gradientId,
    gradientSrc,
    gradientColors,
    blurAmount,
    noiseAmount,
    borderRadius,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY,
    shadowOpacity,
  ]);

  // Actions
  const setGradient = useCallback((gradient: GradientOption) => {
    setGradientId(gradient.id);
    setGradientSrc(gradient.src);
    setGradientColors(gradient.colors);
  }, []);

  const handleImageSelect = useCallback((imageSrc: string) => {
    setSelectedImageSrc(imageSrc);
    setBackgroundType("image");
  }, []);

  const setSelectedImage = useCallback((src: string) => {
    setSelectedImageSrc(src);
  }, []);

  const actions = useMemo<EditorSettingsActions>(() => ({
    setBackgroundType,
    setCustomColor,
    setSelectedImage,
    setGradient,
    setBlurAmount,
    setNoiseAmount,
    setBorderRadius,
    handleImageSelect,
    setShadowBlur,
    setShadowOffsetX,
    setShadowOffsetY,
    setShadowOpacity,
  }), [setGradient, handleImageSelect, setSelectedImage]);

  return [settings, actions];
}
