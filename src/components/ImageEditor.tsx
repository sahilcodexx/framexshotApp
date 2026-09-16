import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Loader2, Redo2, Undo2 } from "lucide-react";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AnnotationToolbar } from "./editor/AnnotationToolbar";
import { AnnotationCanvas } from "./editor/AnnotationCanvas";
import { RightSidebar } from "./editor/RightSidebar";
import { Annotation, ToolType } from "@/types/annotations";
import { usePreviewGenerator } from "@/hooks/usePreviewGenerator";
import {
  useEditorStore,
  useBackgroundType,
  useBlurAmount,
  useAnnotations,
  useCanUndo,
  useCanRedo,
  useSelectedImageSrc,
  useGradientId,
  useWindowFrame,
  useFrameStyle,
  useLayoutPreset,
  useBorderPreset,
  useShadowPreset,
  useShowMockup,
  useNoiseAmount,
  useBorderRadius,
  usePaddingTop,
  usePaddingBottom,
  usePaddingLeft,
  usePaddingRight,
  useShadowBlur,
  useShadowOffsetX,
  useShadowOffsetY,
  useShadowOpacity,
  useFramePadding,
  useFrameOpacity,
  useImageScale,
  useImageOffsetX,
  useImageOffsetY,
  useSharpness,
  useBrightness,
  useContrast,
  useSaturation,
  editorActions,
} from "@/stores";
import type { EditorSettings } from "@/stores/editorStore";

interface ImageEditorProps {
  imagePath: string;
  onSave: (editedImageData: string) => void;
  onCancel: () => void;
}

export function ImageEditor({ imagePath, onSave, onCancel }: ImageEditorProps) {
  const backgroundType = useBackgroundType();
  const blurAmount = useBlurAmount();
  const annotations = useAnnotations();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const selectedImageSrc = useSelectedImageSrc();
  const gradientId = useGradientId();
  const windowFrame = useWindowFrame();
  const frameStyle = useFrameStyle();
  const layoutPreset = useLayoutPreset();
  const borderPreset = useBorderPreset();
  const shadowPreset = useShadowPreset();
  const showMockup = useShowMockup();
  const noiseAmount = useNoiseAmount();
  const borderRadius = useBorderRadius();
  const paddingTop = usePaddingTop();
  const paddingBottom = usePaddingBottom();
  const paddingLeft = usePaddingLeft();
  const paddingRight = usePaddingRight();
  const shadowBlur = useShadowBlur();
  const shadowOffsetX = useShadowOffsetX();
  const shadowOffsetY = useShadowOffsetY();
  const shadowOpacity = useShadowOpacity();
  const framePadding = useFramePadding();
  const frameOpacity = useFrameOpacity();
  const imageScale = useImageScale();
  const imageOffsetX = useImageOffsetX();
  const imageOffsetY = useImageOffsetY();
  const sharpness = useSharpness();
  const brightness = useBrightness();
  const contrast = useContrast();
  const saturation = useSaturation();
  const shadow = useMemo(() => ({ blur: shadowBlur, offsetX: shadowOffsetX, offsetY: shadowOffsetY, opacity: shadowOpacity }), [shadowBlur, shadowOffsetX, shadowOffsetY, shadowOpacity]);
  const customColor = useEditorStore((s: { settings: { customColor: string } }) => s.settings.customColor);

  const settings = useMemo(() => ({
    backgroundType: backgroundType as EditorSettings['backgroundType'],
    customColor,
    selectedImageSrc,
    gradientId,
    gradientSrc: '',
    gradientColors: ['#667eea', '#764ba2'] as [string, string],
    blurAmount,
    noiseAmount,
    borderRadius,
    paddingTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    shadow,
    windowFrame,
    frameStyle,
    layoutPreset,
    borderPreset,
    shadowPreset,
    showMockup,
    framePadding,
    frameOpacity,
    imageScale,
    imageOffsetX,
    imageOffsetY,
    sharpness,
    brightness,
    contrast,
    saturation,
  }), [backgroundType, customColor, selectedImageSrc, gradientId, blurAmount, noiseAmount, borderRadius, paddingTop, paddingBottom, paddingLeft, paddingRight, shadow, windowFrame, frameStyle, layoutPreset, borderPreset, shadowPreset, showMockup, framePadding, frameOpacity, imageScale, imageOffsetX, imageOffsetY, sharpness, brightness, contrast, saturation]);

  const actions = editorActions;
  
  const [screenshotImage, setScreenshotImage] = useState<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [tempDir, setTempDir] = useState<string>("/private/tmp");

   const [selectedTool, setSelectedTool] = useState<ToolType>("select");
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { previewUrl, error: previewError, renderHighQualityCanvas } = usePreviewGenerator({
    screenshotImage,
    settings,
    canvasRef,
    paddingTop: settings.paddingTop,
    paddingBottom: settings.paddingBottom,
    paddingLeft: settings.paddingLeft,
    paddingRight: settings.paddingRight,
    imagePath,
  });

  const error = loadError || previewError;

  useEffect(() => {
    editorActions.initialize();
  }, []);

  useEffect(() => {
    editorActions.initialize();
  }, []);

  useEffect(() => {
    const restoreWindowState = async () => {
      try {
        const appWindow = getCurrentWindow();
        await Promise.all([
          appWindow.setFullscreen(false),
          appWindow.setAlwaysOnTop(false),
        ]);
      } catch (err) {
        console.error("Failed to restore window state:", err);
      }
    };
    restoreWindowState();

    invoke<string>("get_temp_directory")
      .then((dir) => setTempDir(dir))
      .catch((err) => console.error("Failed to get temp directory:", err));
  }, []);

  useEffect(() => {
    setLoadError(null);
    setImageLoaded(false);
    setScreenshotImage(null);

    if (!imagePath) {
      setLoadError("No image path provided");
      return;
    }

    let isMounted = true;

    const setupImage = async () => {
      let finalSrc = imagePath;
      if (!imagePath.startsWith("data:") && !imagePath.startsWith("http:") && !imagePath.startsWith("https:")) {
        try {
          finalSrc = await invoke<string>("read_file_as_base64", { path: imagePath });
        } catch (err) {
          console.warn("Base64 read failed, falling back to convertFileSrc:", err);
          finalSrc = convertFileSrc(imagePath);
        }
      }

      if (!isMounted) return;

      const img = new Image();
      if (finalSrc.startsWith("http") || finalSrc.startsWith("asset:")) {
        img.crossOrigin = "anonymous";
      }

      img.onload = async () => {
        if (!isMounted) return;
        setScreenshotImage(img);
        setImageLoaded(true);

        // Respect user-saved default padding — don't auto-change after "Set as Default"
        try {
          const store = await Store.load("settings.json");
          const savedTop = await store.get<number>("defaultPaddingTop");
          if (savedTop !== null && savedTop !== undefined) {
            return;
          }
        } catch {
          // fall through to auto padding if store read fails
        }

        const avgDimension = (img.width + img.height) / 2;
        const defaultPadding = Math.min(Math.round(avgDimension * 0.1), 400);
        actions.setPaddingTopTransient(defaultPadding);
        actions.setPaddingBottomTransient(defaultPadding);
        actions.setPaddingLeftTransient(defaultPadding);
        actions.setPaddingRightTransient(defaultPadding);
      };

      img.onerror = () => {
        if (!isMounted) return;
        setLoadError(`Failed to load image from: ${imagePath}`);
      };

      img.src = finalSrc;
    };

    setupImage();

    return () => {
      isMounted = false;
    };
  }, [imagePath, actions]);

  const handleSave = useCallback(async () => {
    if (!screenshotImage || isSaving || isCopying) return;
    
    setIsSaving(true);
    try {
      const highQualityCanvas = await renderHighQualityCanvas(annotations, imagePath);
      
      if (!highQualityCanvas) {
        setIsSaving(false);
        return;
      }

      highQualityCanvas.toBlob(
        (blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onloadend = () => {
              onSave(reader.result as string);
              setIsSaving(false);
            };
            reader.onerror = () => {
              setLoadError("Failed to read image data");
              setIsSaving(false);
            };
            reader.readAsDataURL(blob);
          } else {
            setIsSaving(false);
          }
        },
        "image/png",
        1.0
      );
    } catch (err) {
      setLoadError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
      setIsSaving(false);
    }
  }, [screenshotImage, annotations, renderHighQualityCanvas, onSave, isSaving, isCopying, imagePath]);

  const handleCopy = useCallback(async () => {
    if (!screenshotImage || isSaving || isCopying) return;
    
    setIsCopying(true);
    try {
      const highQualityCanvas = await renderHighQualityCanvas(annotations, imagePath);
      
      if (!highQualityCanvas) {
        setIsCopying(false);
        return;
      }

      const dataUrl = highQualityCanvas.toDataURL("image/png");
      
      await invoke<string>("save_edited_image", {
        imageData: dataUrl,
        saveDir: tempDir,
        copyToClip: true,
      });
      
      toast.success("Screenshot copied to clipboard!", {
        duration: 2000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setLoadError(`Failed to copy: ${errorMessage}`);
      toast.error("Failed to copy", {
        description: errorMessage,
        duration: 3000,
      });
    } finally {
      setIsCopying(false);
    }
  }, [screenshotImage, annotations, renderHighQualityCanvas, isSaving, isCopying, tempDir, imagePath]);

  const handleAnnotationAdd = useCallback((annotation: Annotation) => {
    actions.addAnnotation(annotation);
    setSelectedAnnotation(annotation);
    if (annotation.type !== "number") {
      setSelectedTool("select");
    }
  }, [actions]);

  const handleAnnotationUpdate = useCallback((annotation: Annotation) => {
    actions.updateAnnotation(annotation);
    setSelectedAnnotation(annotation);
  }, [actions]);

  const handleAnnotationDelete = useCallback((id: string) => {
    actions.deleteAnnotation(id);
    setSelectedAnnotation((prev) => prev?.id === id ? null : prev);
  }, [actions]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedAnnotation) {
      handleAnnotationDelete(selectedAnnotation.id);
    }
  }, [selectedAnnotation, handleAnnotationDelete]);

  const handleUndo = useCallback(() => {
    actions.undo();
    setSelectedAnnotation(null);
  }, [actions]);

  const handleRedo = useCallback(() => {
    actions.redo();
    setSelectedAnnotation(null);
  }, [actions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedAnnotation) {
          e.preventDefault();
          handleAnnotationDelete(selectedAnnotation.id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAnnotation, handleAnnotationDelete]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (imageLoaded && !isSaving && !isCopying) {
          handleSave();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && e.shiftKey) {
        e.preventDefault();
        if (imageLoaded && !isSaving && !isCopying) {
          handleCopy();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.metaKey || e.ctrlKey) && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        handleRedo();
      }
      if (e.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageLoaded, isSaving, isCopying, handleSave, handleCopy, handleUndo, handleRedo, onCancel]);

  return (
    <div className="flex flex-col w-full h-full bg-background text-foreground font-sans select-none">
      <TitleBar />

      <div className="flex flex-1 min-h-0 bg-canvas">
        <div className="flex-1 flex flex-col relative overflow-hidden bg-canvas">
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-popover/90 backdrop-blur-xl p-1.5 rounded-full border border-border shadow-md">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className="size-8 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs bg-popover border-border">Undo ⌘Z</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRedo}
                    disabled={!canRedo}
                    className="size-8 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Redo2 className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs bg-popover border-border">Redo ⌘⇧Z</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="w-[1px] h-4 bg-border mx-2" />

            <AnnotationToolbar
              selectedTool={selectedTool}
              onToolSelect={setSelectedTool}
              onDelete={selectedAnnotation ? handleDeleteSelected : undefined}
            />
          </div>

          <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 overflow-hidden min-w-0 min-h-0 relative">
            <div className="relative w-full h-full flex items-center justify-center min-w-0 min-h-0 z-10">
              {previewUrl ? (
                <AnnotationCanvas
                  annotations={annotations}
                  selectedAnnotation={selectedAnnotation}
                  selectedTool={selectedTool}
                  previewUrl={previewUrl}
                  showTransparencyGrid={settings.backgroundType === "transparent"}
                  onAnnotationAdd={handleAnnotationAdd}
                  onAnnotationUpdate={handleAnnotationUpdate}
                  onAnnotationSelect={setSelectedAnnotation}
                  onAnnotationDelete={handleAnnotationDelete}
                  onToolSelect={setSelectedTool}
                />
              ) : imageLoaded ? (
                <div className="flex items-center justify-center text-muted-foreground text-sm">Generating preview...</div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center text-center text-destructive p-5">
                  <p className="mb-1 text-sm font-medium">Could not load image</p>
                  <small className="text-xs opacity-70">{error}</small>
                </div>
              ) : (
                <div className="flex items-center justify-center text-muted-foreground text-sm gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Loading image...
                </div>
              )}
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-popover/90 backdrop-blur-xl px-1.5 py-1.5 rounded-full border border-border shadow-lg">
            <Button
              variant="ghost"
              onClick={onCancel}
              className="h-8 rounded-full text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 hover:text-destructive hover:border-destructive/30 px-4"
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              onClick={handleCopy}
              disabled={!imageLoaded || isSaving || isCopying}
              className="h-8 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent hover:border-border px-4 disabled:opacity-40"
            >
              {isCopying ? <Loader2 className="size-3.5 animate-spin" /> : "Copy"}
            </Button>
            <Button
              variant="default"
              onClick={handleSave}
              disabled={!imageLoaded || isSaving || isCopying}
              className="h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold px-5 disabled:opacity-50 shadow-sm"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : "Export"}
            </Button>
          </div>
        </div>

        <div className="w-[318px] xl:w-[358px] shrink-0 p-3 -mt-8 flex flex-col bg-canvas min-w-0">
          <div className="flex-1 flex flex-col min-h-0 rounded-2xl border border-border bg-card shadow-sm dark:shadow-xl overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
              <div className="pt-3 pb-4">
                <RightSidebar
                  settings={settings}
                  actions={actions}
                  previewUrl={previewUrl}
                  selectedAnnotation={selectedAnnotation}
                  onAnnotationUpdate={handleAnnotationUpdate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
