import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import {
  loadImage,
  getBackgroundImageSrc,
  renderFullCanvas,
} from "@/hooks/usePreviewGenerator";
import { resolveBackgroundPath, getDefaultBackgroundPath } from "./asset-registry";
import { gradientOptions } from "@/components/editor/BackgroundSelector";
import {
  type BackgroundType,
  type EditorSettings,
  type FrameStyleId,
  type LayoutPresetId,
  type BorderPresetId,
  type ShadowPresetId,
  type ShadowSettings,
  type WindowFrameType,
  DEFAULT_SETTINGS,
} from "@/stores/editorStore";

export async function processScreenshotWithDefaultBackground(
  imagePath: string
): Promise<string> {
  const settings: EditorSettings = { ...DEFAULT_SETTINGS };

  try {
    const store = await Store.load("settings.json");

    const storedBgType = await store.get<BackgroundType>("defaultBackgroundType");
    const storedCustomColor = await store.get<string>("defaultCustomColor");
    const storedDefaultBg = await store.get<string>("defaultBackgroundImage");

    const storedBlur = await store.get<number>("defaultBlurAmount");
    const storedNoise = await store.get<number>("defaultNoiseAmount");
    const storedRadius = await store.get<number>("defaultBorderRadius");
    const storedShadow = await store.get<ShadowSettings>("defaultShadow");

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

    const storedPaddingTop = await store.get<number>("defaultPaddingTop");
    const storedPaddingBottom = await store.get<number>("defaultPaddingBottom");
    const storedPaddingLeft = await store.get<number>("defaultPaddingLeft");
    const storedPaddingRight = await store.get<number>("defaultPaddingRight");

    if (storedBgType) settings.backgroundType = storedBgType;
    if (storedCustomColor) settings.customColor = storedCustomColor;

    if (storedBgType === "image") {
      settings.selectedImageSrc = storedDefaultBg
        ? resolveBackgroundPath(storedDefaultBg)
        : getDefaultBackgroundPath();
    } else if (storedBgType === "gradient") {
      const normalizedId = storedDefaultBg
        ? storedDefaultBg.replace("gradient-", "mesh-")
        : "mesh-1";
      const gradient =
        gradientOptions.find(
          (option) => option.id === normalizedId || option.id === storedDefaultBg
        ) || gradientOptions[0];
      if (gradient) {
        settings.gradientId = gradient.id;
        settings.gradientSrc = gradient.src;
        settings.gradientColors = gradient.colors;
      }
    } else if (storedBgType) {
      settings.selectedImageSrc = null;
    }

    if (storedBlur !== null && storedBlur !== undefined) settings.blurAmount = storedBlur;
    if (storedNoise !== null && storedNoise !== undefined) settings.noiseAmount = storedNoise;
    if (storedRadius !== null && storedRadius !== undefined) settings.borderRadius = storedRadius;
    if (storedShadow) settings.shadow = storedShadow;

    if (storedFrameStyle) settings.frameStyle = storedFrameStyle;
    if (storedLayoutPreset) settings.layoutPreset = storedLayoutPreset;
    if (storedBorderPreset) settings.borderPreset = storedBorderPreset;
    if (storedShadowPreset) settings.shadowPreset = storedShadowPreset;
    if (storedWindowFrame) settings.windowFrame = storedWindowFrame;
    if (storedShowMockup !== null && storedShowMockup !== undefined) settings.showMockup = storedShowMockup;
    if (storedFramePadding !== null && storedFramePadding !== undefined) settings.framePadding = storedFramePadding;
    if (storedFrameOpacity !== null && storedFrameOpacity !== undefined) settings.frameOpacity = storedFrameOpacity;
    if (storedImageScale !== null && storedImageScale !== undefined) settings.imageScale = storedImageScale;
    if (storedImageOffsetX !== null && storedImageOffsetX !== undefined) settings.imageOffsetX = storedImageOffsetX;
    if (storedImageOffsetY !== null && storedImageOffsetY !== undefined) settings.imageOffsetY = storedImageOffsetY;

    if (storedPaddingTop !== null && storedPaddingTop !== undefined) settings.paddingTop = storedPaddingTop;
    if (storedPaddingBottom !== null && storedPaddingBottom !== undefined) settings.paddingBottom = storedPaddingBottom;
    if (storedPaddingLeft !== null && storedPaddingLeft !== undefined) settings.paddingLeft = storedPaddingLeft;
    if (storedPaddingRight !== null && storedPaddingRight !== undefined) settings.paddingRight = storedPaddingRight;
  } catch (err) {
    console.error("Failed to load default settings:", err);
  }

  const screenshotImage = await loadScreenshot(imagePath);

  const bgSrc = getBackgroundImageSrc(settings);
  let bgImage: HTMLImageElement | null = null;
  if (bgSrc) {
    try {
      bgImage = await loadImage(bgSrc);
    } catch (err) {
      console.warn("Failed to load default background image:", err);
    }
  }

  const avgDimension = (screenshotImage.width + screenshotImage.height) / 2;
  const padding = Math.min(Math.round(avgDimension * 0.1), 400);
  const isTransparent = settings.backgroundType === "transparent";
  const finalPadding = isTransparent ? 0 : padding;

  const canvas = renderFullCanvas(
    screenshotImage,
    settings,
    { top: finalPadding, bottom: finalPadding, left: finalPadding, right: finalPadding },
    bgImage
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.onerror = () => {
            reject(new Error("Failed to read processed image"));
          };
          reader.readAsDataURL(blob);
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      },
      "image/jpeg",
      0.9
    );
  });
}

async function loadScreenshot(imagePath: string): Promise<HTMLImageElement> {
  let assetUrl = imagePath;
  if (
    !imagePath.startsWith("data:") &&
    !imagePath.startsWith("http:") &&
    !imagePath.startsWith("https:")
  ) {
    try {
      assetUrl = await invoke<string>("read_file_as_base64", { path: imagePath });
    } catch (err) {
      console.warn("Base64 conversion failed in auto-process, falling back to convertFileSrc:", err);
      assetUrl = convertFileSrc(imagePath);
    }
  }
  return loadImage(assetUrl);
}
