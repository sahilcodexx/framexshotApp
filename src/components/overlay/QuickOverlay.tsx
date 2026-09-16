import { Button } from "@/components/ui/button";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Store } from "@tauri-apps/plugin-store";
import { Check, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Reveal } from "@/lib/motion";

// Motion tokens (mirror --duration-* / --ease-* from src/index.css)
const MOTION_DURATION = {
  quick: 0.15, // --duration-quick (150ms)
  fast: 0.25, // --duration-fast (250ms)
} as const;

type OverlayEventPayload = {
  path: string;
  data_url?: string | null;
};

type QuickOverlayState = {
  path: string | null;
  createdAt: string | null;
};

const LAST_CAPTURE_KEY = "lastCapturePath";

export function QuickOverlay() {
  const [state, setState] = useState<QuickOverlayState>({
    path: null,
    createdAt: null,
  });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const store = await Store.load("settings.json");
        const savedPath = await store.get<string>(LAST_CAPTURE_KEY);

        setState((prev) => ({
          ...prev,
          path: savedPath ?? null,
          createdAt: savedPath ? new Date().toISOString() : prev.createdAt,
        }));
      } catch (error) {
        console.error("Failed to load overlay state:", error);
      }
    };

    const configureWindow = async () => {
      try {
        const win = getCurrentWindow();
        await Promise.all([win.setAlwaysOnTop(true), win.setResizable(true)]);
      } catch (error) {
        console.error("Failed to configure overlay window:", error);
      }
    };

    loadInitialState();
    configureWindow();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    const setupListener = async () => {
      unlisten = await listen<OverlayEventPayload>(
        "overlay-show-capture",
        (event) => {
          if (!isMounted) return;
          
          if (event.payload.data_url) {
            setDataUrl(event.payload.data_url);
            setImageLoaded(true);
            setImageError(false);
          } else {
            setDataUrl(null);
            setImageLoaded(false);
            setImageError(false);
          }

          setState((prev) => ({
            ...prev,
            path: event.payload.path,
            createdAt: new Date().toISOString(),
          }));
        },
      );
    };

    setupListener();

    return () => {
      isMounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!state.path) {
      setIsFadingOut(false);
      return;
    }

    setIsFadingOut(false);

    const fadeDelayMs = 5000;
    const fadeDurationMs = 180;

    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, fadeDelayMs);

    const hideTimer = window.setTimeout(() => {
      const win = getCurrentWindow();
      win
        .hide()
        .catch((error) => {
          console.error("Failed to hide quick overlay window:", error);
        });
    }, fadeDelayMs + fadeDurationMs);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [state.path]);

  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!state.path) {
      setDataUrl(null);
      setImageLoaded(false);
      setImageError(false);
      return;
    }

    if (state.path.startsWith("data:")) {
      setDataUrl(state.path);
      setImageLoaded(true);
      setImageError(false);
      return;
    }

    // Bulletproof image loading via Rust read_file_as_base64
    invoke<string>("read_file_as_base64", { path: state.path })
      .then((url) => {
        if (isMounted) {
          setDataUrl(url);
          setImageLoaded(true);
          setImageError(false);
        }
      })
      .catch((err) => {
        console.error("Failed to read image as base64 for overlay:", err);
        if (isMounted) {
          setDataUrl(convertFileSrc(state.path!));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [state.path]);

  const handleCopy = useCallback(async () => {
    if (!state.path || isCopying) return;
    setIsCopying(true);
    try {
      await invoke("copy_image_file_to_clipboard", { path: state.path });
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 700);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      toast.error("Failed to copy", {
        description: message,
      });
    } finally {
      setIsCopying(false);
    }
  }, [state.path, isCopying]);

  const imageSrc = dataUrl || (state.path ? (state.path.startsWith("data:") ? state.path : convertFileSrc(state.path)) : null);

  return (
    <main className="h-dvh w-dvw bg-background text-foreground flex flex-col overflow-hidden">
      {state.path ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isFadingOut ? 0 : 1 }}
          transition={{ duration: MOTION_DURATION.quick, ease: "easeOut" }}
          className="flex flex-col h-full"
        >
          <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/5">
            {imageError && !dataUrl ? (
              <div className="flex size-full items-center justify-center bg-muted/40">
                <ImageIcon className="size-12 text-muted-foreground" />
              </div>
            ) : (
              <Reveal
                key={state.path}
                className="size-full"
                duration={MOTION_DURATION.fast * 1000}
              >
                <img
                  alt="Latest capture preview"
                  src={imageSrc || undefined}
                  className="size-full object-contain"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => {
                    if (!dataUrl) {
                      setImageError(true);
                      setImageLoaded(false);
                    }
                  }}
                />
              </Reveal>
            )}
            {!imageLoaded && !dataUrl && !imageError && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
                <div className="size-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              </div>
            )}
          </div>
          <div className="p-1.5 bg-background/95 border-t border-border flex flex-col gap-1 shrink-0">
            <motion.div
              animate={copied ? { y: -2 } : { y: 0 }}
              transition={{ duration: MOTION_DURATION.quick }}
            >
              <Button
                size="sm"
                variant="cta"
                className="mx-auto w-28 justify-center py-1.5 text-[11px] font-medium"
                onClick={handleCopy}
                disabled={isCopying}
              >
                <Check className="mr-1.5 size-3" aria-hidden="true" />
                {copied ? "Copied" : "Copy image"}
              </Button>
            </motion.div>
          </div>
        </motion.div>
      ) : (
        <div className="flex size-full items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-sm font-medium text-foreground text-balance">
              No recent capture
            </p>
            <p className="text-xs text-muted-foreground text-pretty">
              Take a screenshot with FrameXShot to see it here instantly.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

