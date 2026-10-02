import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Loader2, Redo2, Undo2, Crop } from "lucide-react";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AnnotationToolbar } from "./editor/AnnotationToolbar";
import { AnnotationCanvas } from "./editor/AnnotationCanvas";
import { RightSidebar } from "./editor/RightSidebar";
import { Annotation, ToolType } from "@/types/annotations";
import {
  usePreviewGenerator,
  getFrameDimensions,
  getImageContentRect,
  frameToImagePoint,
  type ImageContentRect,
} from "@/hooks/usePreviewGenerator";
import {
  cropCanvasToDataUrl,
  normalizeSelection,
  rebaseAnnotationsForCrop,
  resolveSourcePath,
} from "@/lib/crop-selection";
import type { CropRegion } from "@/types/annotations";
import {
  buildFilenameFromTemplate,
  canvasToDataUrl,
  loadExportPrefs,
} from "@/lib/export-settings";
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
  useSourceIndex,
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
  /** `filename` is the user's template-resolved base name (no extension). */
  onSave: (editedImageData: string, filename?: string) => void;
  onCancel: () => void;
}

/** Captures kept in the source-image list before the oldest is dropped. */
const MAX_SOURCE_CAPTURES = 3;

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

  // Per-capture list of source-image versions: the original capture, then one
  // entry per crop.
  //
  // Crop is destructive, so the previous image has to be kept for undo to have
  // anything to restore. The store tracks only the INDEX (see HistorySnapshot)
  // because copying a multi-megabyte data URL into 50 history snapshots would
  // be a memory leak — the images live here and are resolved on demand.
  //
  // Keyed BY CAPTURE rather than reset when the capture changes: ImageEditor
  // stays mounted across captures (AGENTS.md Change 13), and keying means no
  // reset effect is needed at all. A `sourceIndex` left over from a previous
  // capture simply misses the new (shorter) list and falls back to the
  // original image, and self-corrects on the first crop of the new capture.
  const [sourcesByCapture, setSourcesByCapture] = useState<
    Array<{ path: string; list: string[] }>
  >([]);
  const sourceIndex = useSourceIndex();
  const sourceList = sourcesByCapture.find((e) => e.path === imagePath)?.list;
  // Index 0 is the original capture by definition — see resolveSourcePath.
  const sourcePath = resolveSourcePath(sourceList ?? [], sourceIndex, imagePath);

  // Tagging the loaded image and its error with the path they belong to gets
  // the "reset on new capture" behaviour by derivation — a new path is
  // automatically not-yet-loaded and error-free — which removes the
  // synchronous setState from the load effect and, more importantly, the
  // window in which a new capture could render the PREVIOUS capture's image.
  const [loadedImage, setLoadedImage] = useState<{
    path: string;
    image: HTMLImageElement;
  } | null>(null);
  const [reportedError, setReportedError] = useState<{
    path: string;
    message: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [tempDir, setTempDir] = useState<string>("/private/tmp");

  const [selectedTool, setSelectedTool] = useState<ToolType>("select");
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const screenshotImage =
    loadedImage && loadedImage.path === sourcePath ? loadedImage.image : null;
  // `imageLoaded` was always set in lockstep with `screenshotImage`, so it is
  // simply that, derived.
  const imageLoaded = screenshotImage !== null;
  const loadError =
    !sourcePath
      ? null
      : reportedError && reportedError.path === sourcePath
        ? reportedError.message
        : null;

  const reportError = useCallback(
    (message: string) => {
      if (sourcePath) setReportedError({ path: sourcePath, message });
    },
    [sourcePath]
  );

  const { previewUrl, error: previewError, renderHighQualityCanvas } = usePreviewGenerator({
    screenshotImage,
    settings,
    canvasRef,
    paddingTop: settings.paddingTop,
    paddingBottom: settings.paddingBottom,
    paddingLeft: settings.paddingLeft,
    paddingRight: settings.paddingRight,
  });

  const error = loadError || previewError;

  // ── Destructive crop ────────────────────────────────────────────────────
  //
  // The pending selection is stored in SOURCE IMAGE pixels — that is the space
  // `cropCanvasToDataUrl` cuts in, so nothing has to round-trip back through
  // frame coordinates when the crop is actually applied. The canvas works in
  // frame coords, so the two are mapped at the boundary.
  const [cropSelection, setCropSelection] = useState<CropRegion | null>(null);
  const [cropSelectionFrame, setCropSelectionFrame] = useState<CropRegion | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const padding = useMemo(
    () => ({ top: paddingTop, bottom: paddingBottom, left: paddingLeft, right: paddingRight }),
    [paddingTop, paddingBottom, paddingLeft, paddingRight]
  );

  const imageContentRect: ImageContentRect | null = useMemo(
    () => (screenshotImage ? getImageContentRect(screenshotImage, settings, padding) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror of the getFrameDimensions memo: these primitives plus `settings.crop`-free layout inputs are exactly what getImageContentRect reads.
    [
      screenshotImage,
      settings.imageScale,
      settings.layoutPreset,
      settings.frameStyle,
      settings.framePadding,
      settings.windowFrame,
      settings.showMockup,
      settings.imageOffsetX,
      settings.imageOffsetY,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
    ]
  );

  /** A finished drag, in frame coords -> normalize into source-image px. */
  const handleCropSelect = useCallback(
    (frameRect: CropRegion | null) => {
      setCropSelectionFrame(frameRect);
      if (!frameRect || !screenshotImage || !imageContentRect) {
        setCropSelection(null);
        return;
      }
      const topLeft = frameToImagePoint(imageContentRect, { x: frameRect.x, y: frameRect.y });
      const bottomRight = frameToImagePoint(imageContentRect, {
        x: frameRect.x + frameRect.width,
        y: frameRect.y + frameRect.height,
      });
      setCropSelection(
        normalizeSelection(
          {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
          },
          screenshotImage.width,
          screenshotImage.height
        )
      );
    },
    [screenshotImage, imageContentRect]
  );

  /**
   * Apply the selection: cut the pixels out of the source image and swap it in.
   *
   * The new image becomes the editor's source, which is the single input
   * everything else derives from — so the frame, canvas, background, padding
   * and every effect recompute around the SMALLER image automatically. That is
   * what makes the background follow the crop instead of staying sized to the
   * original.
   */
  const handleApplyCrop = useCallback(async () => {
    if (!cropSelection || !screenshotImage || !imageContentRect) return;

    const before = annotations.length;
    const confirmed = window.confirm(
      `Crop to ${Math.round(cropSelection.width)} \u00d7 ${Math.round(cropSelection.height)}?\n\nThe rest of the image is deleted. You can undo this with \u2318Z.`
    );
    if (!confirmed) return;

    setIsCropping(true);
    try {
      const dataUrl = cropCanvasToDataUrl(
        screenshotImage,
        screenshotImage.width,
        screenshotImage.height,
        cropSelection
      );

      // Re-base annotations onto the surviving pixels before swapping.
      // `getImageContentRect` is asked where the CROPPED image will land by
      // passing it the cropped dimensions — same helper, same layout math the
      // renderer uses, so the two cannot drift apart.
      const nextRect = getImageContentRect(
        { width: cropSelection.width, height: cropSelection.height },
        settings,
        padding
      );
      const rebased = rebaseAnnotationsForCrop(
        annotations,
        { x: imageContentRect.x, y: imageContentRect.y },
        { x: nextRect.x, y: nextRect.y },
        { width: nextRect.width, height: nextRect.height }
      );
      // ONE history entry must cover both the image swap and the re-based
      // annotations, or a single Ctrl+Z would land in the middle of a crop.
      //
      // `setAnnotations` pushes its own snapshot, so history is paused around
      // it; the snapshot that matters is pushed FIRST, while the store still
      // holds the pre-crop source index and annotations.
      actions.pushHistory();
      if (rebased.length !== before) {
        actions.pauseHistory();
        try {
          actions.setAnnotations(rebased);
        } finally {
          actions.resumeHistory();
        }
      }

      // Drop the selection and hand the user back to the pointer tool.
      // Without this the Crop tool stayed active after applying, leaving the
      // bottom-bar Crop button on screen with nothing to apply.
      setCropSelection(null);
      setCropSelectionFrame(null);
      setSelectedTool("select");

      setSourcesByCapture((prev) => {
        const next = prev.map((e) =>
          e.path === imagePath ? { ...e, list: [...e.list, dataUrl] } : e
        );
        // Keep only the three most recent captures. Each entry holds a full
        // base64 image, so keeping every capture for the life of the session
        // would grow without bound.
        const kept = next.some((e) => e.path === imagePath)
          ? next
          : [...next, { path: imagePath, list: [dataUrl] }];
        return kept.slice(-MAX_SOURCE_CAPTURES);
      });
      // +1 because index 0 is reserved for the original capture.
      actions.setSourceIndex((sourceList?.length ?? 0) + 1);
    } catch (err) {
      reportError(`Failed to crop: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCropping(false);
    }
  }, [cropSelection, screenshotImage, imageContentRect, annotations, settings, padding, actions, reportError, sourceList, imagePath]);

  // Logical (full-resolution) frame size — what the composed image measures
  // BEFORE preview-tier scaling. Passed to AnnotationCanvas so the on-screen
  // canvas keeps a constant size across the 900px-drag ↔ 1400px-rest preview
  // tiers, and so annotation coordinates stay in one stable space.
  const frameDimensions = useMemo(
    () =>
      screenshotImage
        ? getFrameDimensions(screenshotImage, settings, {
            top: paddingTop,
            bottom: paddingBottom,
            left: paddingLeft,
            right: paddingRight,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `settings` is rebuilt every render; the primitive fields below are exactly the inputs getFrameDimensions reads (imageScale, layoutPreset, frameStyle, framePadding, crop + the padding values passed explicitly).
    [
      screenshotImage,
      settings.imageScale,
      settings.layoutPreset,
      settings.frameStyle,
      settings.framePadding,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
    ]
  );

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
    // No reset block here: `screenshotImage`, `imageLoaded` and `loadError` are
    // all derived from `imagePath` above, so changing it resets them already.
    if (!sourcePath) {
      return;
    }

    let isMounted = true;

    const setupImage = async () => {
      let finalSrc = sourcePath;
      if (!sourcePath.startsWith("data:") && !sourcePath.startsWith("http:") && !sourcePath.startsWith("https:")) {
        try {
          finalSrc = await invoke<string>("read_file_as_base64", { path: sourcePath });
        } catch (err) {
          console.warn("Base64 read failed, falling back to convertFileSrc:", err);
          finalSrc = convertFileSrc(sourcePath);
        }
      }

      if (!isMounted) return;

      const img = new Image();
      if (finalSrc.startsWith("http") || finalSrc.startsWith("asset:")) {
        img.crossOrigin = "anonymous";
      }

      img.onload = async () => {
        if (!isMounted) return;
        setLoadedImage({ path: sourcePath, image: img });

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
        reportError(`Failed to load image from: ${sourcePath}`);
      };

      img.src = finalSrc;
    };

    setupImage();

    return () => {
      isMounted = false;
    };
  }, [sourcePath, actions, reportError]);

  const handleSave = useCallback(async () => {
    if (!screenshotImage || isSaving || isCopying) return;
    
    setIsSaving(true);
    try {
      // Scale comes from export prefs so the composite renders at output size.
      const prefs = await loadExportPrefs();
      const highQualityCanvas = await renderHighQualityCanvas(annotations, sourcePath, {
        outputScale: prefs.scale,
      });
      
      if (!highQualityCanvas) {
        setIsSaving(false);
        return;
      }

      // The encoder's actual mime wins — WebKitGTK may fall back to PNG for a
      // requested type it cannot encode.
      const { dataUrl } = await canvasToDataUrl(highQualityCanvas, prefs);
      onSave(dataUrl, buildFilenameFromTemplate(prefs.filenameTemplate));
    } catch (err) {
      reportError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [screenshotImage, annotations, renderHighQualityCanvas, onSave, isSaving, isCopying, sourcePath, reportError]);

  const handleCopy = useCallback(async () => {
    if (!screenshotImage || isSaving || isCopying) return;
    
    setIsCopying(true);
    try {
      // Clipboard copies are always PNG at logical 1x — format/scale prefs
      // only affect files on disk.
      const highQualityCanvas = await renderHighQualityCanvas(annotations, sourcePath, {
        outputScale: 1,
      });
      
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
      reportError(`Failed to copy: ${errorMessage}`);
      toast.error("Failed to copy", {
        description: errorMessage,
        duration: 3000,
      });
    } finally {
      setIsCopying(false);
    }
  }, [screenshotImage, annotations, renderHighQualityCanvas, isSaving, isCopying, tempDir, sourcePath, reportError]);

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
                  frameSize={frameDimensions}
                  cropSelection={cropSelectionFrame}
                  imageContentRect={imageContentRect ?? null}
                  onCropSelect={handleCropSelect}
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
            {/* Appears only once there is a selection to apply. Crop is
                destructive, so it is never a default-visible action. */}
            {cropSelection && (
              <Button
                variant="default"
                onClick={handleApplyCrop}
                disabled={isCropping || !imageLoaded}
                className="h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold px-5 disabled:opacity-50 shadow-sm"
              >
                {isCropping ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <>
                    <Crop className="size-3.5" />
                    Crop
                  </>
                )}
              </Button>
            )}
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
