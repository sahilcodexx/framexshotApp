import { editorActions } from "@/stores/editorStore";
import { Switch } from "@/components/ui/switch";
import { isAssetId, isDataUrl, migrateStoredValue } from "@/lib/asset-registry";
import { processScreenshotWithDefaultBackground } from "@/lib/auto-process";
import { hasCompletedOnboarding } from "@/lib/onboarding";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { register, unregister, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { Store } from "@tauri-apps/plugin-store";
import { AppWindowMac, Crop, Folder, Github, Globe, Monitor, ScanText, Twitter } from "lucide-react";
import { toast } from "sonner";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardShortcut } from "./components/preferences/KeyboardShortcutManager";
import { SettingsIcon } from "./components/SettingsIcon";

// Lazy load heavy components
const ImageEditor = lazy(() => import("./components/ImageEditor").then(m => ({ default: m.ImageEditor })));
const OnboardingFlow = lazy(() => import("./components/onboarding/OnboardingFlow").then(m => ({ default: m.OnboardingFlow })));
const PreferencesPage = lazy(() => import("./components/preferences/PreferencesPage").then(m => ({ default: m.PreferencesPage })));

type AppMode = "main" | "editing" | "preferences";
type CaptureMode = "region" | "fullscreen" | "window" | "ocr";

// Loading fallback for lazy loaded components
function LoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center bg-canvas">
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg className="animate-spin size-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Loading...</span>
      </div>
    </div>
  );
}

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { id: "region", action: "Capture Region", shortcut: "CommandOrControl+Shift+2", enabled: true },
  { id: "fullscreen", action: "Capture Screen", shortcut: "CommandOrControl+Shift+F", enabled: false },
  { id: "window", action: "Capture Window", shortcut: "CommandOrControl+Shift+D", enabled: false },
  { id: "ocr", action: "OCR Region", shortcut: "CommandOrControl+Shift+O", enabled: false },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

function formatShortcut(shortcut: string): string {
  if (isMac) {
    return shortcut
      .replace(/CommandOrControl/g, "⌘")
      .replace(/Command/g, "⌘")
      .replace(/Control/g, "Ctrl")
      .replace(/Shift/g, "⇧")
      .replace(/Alt|Option/g, "⌥");
  }
  return shortcut
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Command/g, "Ctrl")
    .replace(/Control/g, "Ctrl")
    .replace(/Shift/g, "Shift")
    .replace(/Alt|Option/g, "Alt");
}

async function restoreWindowOnScreen(mouseX?: number, mouseY?: number) {
  const appWindow = getCurrentWindow();
  const windowWidth = 1200;
  const windowHeight = 800;
  await appWindow.setSize(new LogicalSize(windowWidth, windowHeight));
  if (mouseX !== undefined && mouseY !== undefined) {
    try {
      const monitors = await availableMonitors();
      
      const targetMonitor = monitors.find((monitor: any) => {
        const pos = monitor.position;
        const size = monitor.size;
        return (
          mouseX >= pos.x &&
          mouseX < pos.x + size.width &&
          mouseY >= pos.y &&
          mouseY < pos.y + size.height
        );
      });

      if (targetMonitor) {
        const scaleFactor = targetMonitor.scaleFactor;
        const physicalWindowWidth = windowWidth * scaleFactor;
        const physicalWindowHeight = windowHeight * scaleFactor;
        const centerX = targetMonitor.position.x + (targetMonitor.size.width - physicalWindowWidth) / 2;
        const centerY = targetMonitor.position.y + (targetMonitor.size.height - physicalWindowHeight) / 2;
        
        await appWindow.setPosition(new PhysicalPosition(centerX, centerY));
      } else {
        await appWindow.center();
      }
    } catch {
      await appWindow.center();
    }
  } else {
    await appWindow.center();
  }

  await appWindow.show();
  await appWindow.setFocus();
}

async function restoreWindow() {
  await restoreWindowOnScreen();
}

async function showQuickOverlay(
  screenshotPath: string,
  mouseX?: number,
  mouseY?: number,
  dataUrl?: string,
) {
  try {
    const store = await Store.load("settings.json", {
      defaults: {},
      autoSave: true,
    });
    await store.set("lastCapturePath", screenshotPath);
    await store.save();
  } catch (error) {
    console.error("Failed to persist last capture path:", error);
  }

  try {
    await invoke("show_quick_overlay", {
      screenshotPath,
      dataUrl: dataUrl || null,
      mouseX: mouseX !== undefined ? mouseX : null,
      mouseY: mouseY !== undefined ? mouseY : null,
    });
  } catch (error) {
    console.error("Failed to show quick overlay:", error);
  }
}

function App() {
  const [mode, setMode] = useState<AppMode>("main");
  const [saveDir, setSaveDir] = useState<string>("");
  const [copyToClipboard, setCopyToClipboard] = useState(true);
  const [autoApplyBackground, setAutoApplyBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [tempScreenshotPath, setTempScreenshotPath] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(DEFAULT_SHORTCUTS);
  const [enableGlobalHotkeys, setEnableGlobalHotkeys] = useState<boolean>(true);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [tempDir, setTempDir] = useState<string>("/tmp");

  // Refs to hold current values for use in callbacks that may have stale closures
  const settingsRef = useRef({ autoApplyBackground, saveDir, copyToClipboard, tempDir });
  const registeredShortcutsRef = useRef<Set<string>>(new Set());
  const lastCaptureTimeRef = useRef(0);
  const activeCaptureModeRef = useRef<CaptureMode>("region");
  
  // Keep ref in sync with state
  useEffect(() => {
    settingsRef.current = { autoApplyBackground, saveDir, copyToClipboard, tempDir };
  }, [autoApplyBackground, saveDir, copyToClipboard, tempDir]);

  // Load settings function
  const loadSettings = useCallback(async () => {
    try {
      const store = await Store.load("settings.json", {
        defaults: {
          copyToClipboard: true,
          autoApplyBackground: false,
          enableGlobalHotkeys: true,
        },
        autoSave: true,
      });

      const savedCopyToClip = await store.get<boolean>("copyToClipboard");
      if (savedCopyToClip !== null && savedCopyToClip !== undefined) {
        setCopyToClipboard(savedCopyToClip);
      }

      const savedAutoApply = await store.get<boolean>("autoApplyBackground");
      if (savedAutoApply !== null && savedAutoApply !== undefined) {
        setAutoApplyBackground(savedAutoApply);
      }

      const savedGlobalToggle = await store.get<boolean>("enableGlobalHotkeys");
      if (savedGlobalToggle !== null && savedGlobalToggle !== undefined) {
        setEnableGlobalHotkeys(savedGlobalToggle);
      }

      const savedSaveDir = await store.get<string>("saveDir");
      if (savedSaveDir) {
        setSaveDir(savedSaveDir);
      }

      const savedShortcuts = await store.get<KeyboardShortcut[]>("keyboardShortcuts");
      if (savedShortcuts && savedShortcuts.length > 0) {
        // Merge saved shortcuts with defaults, preserving all saved values
        // Only add missing default shortcuts that don't exist in saved
        const savedIds = new Set(savedShortcuts.map((s) => s.id));
        const missingDefaults = DEFAULT_SHORTCUTS.filter((d) => !savedIds.has(d.id));
        const finalShortcuts = [...savedShortcuts, ...missingDefaults];
        setShortcuts(finalShortcuts);
      } else {
        setShortcuts(DEFAULT_SHORTCUTS);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  // Initial app setup
  useEffect(() => {
    const initializeApp = async () => {
      // First get the desktop path as the default
      let desktopPath = "";
      try {
        desktopPath = await invoke<string>("get_desktop_directory");
      } catch (err) {
        console.error("Failed to get Desktop directory:", err);
        setError(`Failed to get Desktop directory: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Get the system temp directory (canonicalized to resolve symlinks)
      try {
        const systemTempDir = await invoke<string>("get_temp_directory");
        setTempDir(systemTempDir);
      } catch (err) {
        console.error("Failed to get temp directory, using fallback:", err);
        // Keep the default /tmp fallback
      }

      // Load settings from store. The previous version awaited five store.get()
      // calls serially and also awaited the first-run saveDir write — that
      // turned the first launch into a chain of round-trips that delayed the
      // WebView's first paint. Now we fan the reads out in parallel and
      // turn the disk writes into fire-and-forget so the UI updates the
      // moment the reads return.
      try {
        const store = await Store.load("settings.json", {
          defaults: {
            copyToClipboard: true,
            autoApplyBackground: false,
          },
          autoSave: true,
        });

        const [
          savedCopyToClip,
          savedAutoApply,
          savedSaveDir,
          savedShortcuts,
          savedBackgroundImage,
        ] = await Promise.all([
          store.get<boolean>("copyToClipboard"),
          store.get<boolean>("autoApplyBackground"),
          store.get<string>("saveDir"),
          store.get<KeyboardShortcut[]>("keyboardShortcuts"),
          store.get<string>("defaultBackgroundImage"),
        ]);

        if (savedCopyToClip !== null && savedCopyToClip !== undefined) {
          setCopyToClipboard(savedCopyToClip);
        }

        if (savedAutoApply !== null && savedAutoApply !== undefined) {
          setAutoApplyBackground(savedAutoApply);
        }

        // Only use saved directory if it's a non-empty string, otherwise use desktop
        if (savedSaveDir && savedSaveDir.trim() !== "") {
          setSaveDir(savedSaveDir);
        } else {
          setSaveDir(desktopPath);
          // Fire-and-forget the default-save so the first paint isn't
          // gated on a disk write. If the write fails it's recoverable
          // (next launch falls through this branch again).
          if (desktopPath) {
            void store.set("saveDir", desktopPath).then(() => store.save());
          }
        }

        if (savedShortcuts && savedShortcuts.length > 0) {
          setShortcuts(savedShortcuts);
        }

        // Migrate legacy background image paths to asset IDs
        if (savedBackgroundImage && !isAssetId(savedBackgroundImage) && !isDataUrl(savedBackgroundImage)) {
          const migratedValue = migrateStoredValue(savedBackgroundImage);
          if (migratedValue && migratedValue !== savedBackgroundImage) {
            console.log(`Migrating background image: ${savedBackgroundImage} -> ${migratedValue}`);
            void store.set("defaultBackgroundImage", migratedValue).then(() => store.save());
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        // Still set desktop as fallback
        if (desktopPath) {
          setSaveDir(desktopPath);
        }
      }
    };

    initializeApp();

    const shouldShowOnboarding = !hasCompletedOnboarding();
    if (shouldShowOnboarding) {
      setShowOnboarding(true);
    }

    // DEV ONLY: Uncomment to test editor with any image file
    // setTempScreenshotPath("/Users/montimage/Desktop/framexshot_1768263844426.png");
    // setMode("editing");
  }, []);


  const handleCapture = useCallback(async (captureMode: CaptureMode = "region") => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < 600) {
      return;
    }
    lastCaptureTimeRef.current = now;

    if (isCapturing) return;
    
    setIsCapturing(true);
    setError(null);
    activeCaptureModeRef.current = captureMode;

    const appWindow = getCurrentWindow();
    
    // Read current settings from ref to avoid stale closure issues
    const { autoApplyBackground: shouldAutoApply, saveDir: currentSaveDir, copyToClipboard: shouldCopyToClipboard, tempDir: currentTempDir } = settingsRef.current;

    try {
      await appWindow.hide();
      // Capture Screen needs extra time for tray menu / window to fully hide, else it gets captured (see screenshot)
      const hideDelay = captureMode === "fullscreen" ? 400 : 100;
      await new Promise((resolve) => setTimeout(resolve, hideDelay));

      if (captureMode === "ocr") {
        try {
          const res = await invoke<string>("native_capture_ocr_region", {
            saveDir: currentTempDir || currentSaveDir,
          });
          if (res === "REGION_SELECTOR_OPENED" || res === "ok") {
            return;
          }
          const recognizedText = res;

          toast.success("Text copied to clipboard!", {
            description: recognizedText.length > 50 ? `${recognizedText.substring(0, 50)}...` : recognizedText,
            duration: 3000,
          });

          await appWindow.hide();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes("cancelled") || errorMessage.includes("was cancelled")) {
            await appWindow.hide();
          } else if (errorMessage.includes("already in progress")) {
            setError("Please wait for the current screenshot to complete");
            await appWindow.hide();
          } else if (
            errorMessage.toLowerCase().includes("permission") ||
            errorMessage.toLowerCase().includes("access") ||
            errorMessage.toLowerCase().includes("denied")
          ) {
            setError(
              "Screen Recording permission required. Please go to System Settings > Privacy & Security > Screen Recording and enable access for FrameXShot, then restart the app."
            );
            await restoreWindow();
          } else if (
            errorMessage.toLowerCase().includes("tesseract") ||
            errorMessage.toLowerCase().includes("program not found")
          ) {
            toast.error("Tesseract OCR not installed", {
              description: "Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki and add it to your PATH, then restart the app.",
              duration: 8000,
            });
            await restoreWindow();
          } else {
            setError(errorMessage);
            toast.error("OCR failed", {
              description: errorMessage,
              duration: 5000,
            });
            await restoreWindow();
          }
        } finally {
          setIsCapturing(false);
        }
        return;
      }

      // ─── Region capture: special path for Windows/macOS ──────────────────
      // On Linux, native_capture_interactive handles everything and returns a file path.
      // On Windows/macOS, it captures the full screen to a static, shows the region-selector
      // window, and returns "ok". The actual crop + editor load happens later via the
      // "region-selected" event listener (lines 611+). So we must early-return here.
      if (captureMode === "region") {
        const result = await invoke<string>("native_capture_interactive", {
          saveDir: currentTempDir || currentSaveDir,
        });

        // If the result is a file path (Linux), process it normally
        if (result !== "ok") {
          const screenshotPath = result;
          let mouseX: number | undefined;
          let mouseY: number | undefined;
          try {
            const [x, y] = await invoke<[number, number]>("get_mouse_position");
            mouseX = x;
            mouseY = y;
          } catch {}

          invoke("play_screenshot_sound").catch(console.error);

          if (shouldAutoApply) {
            try {
              const processedImageData =
                await processScreenshotWithDefaultBackground(screenshotPath);

              const savedPath = await invoke<string>("save_edited_image", {
                imageData: processedImageData,
                saveDir: currentSaveDir,
                copyToClip: shouldCopyToClipboard,
              });

              await appWindow.hide();
              await showQuickOverlay(savedPath, mouseX, mouseY, processedImageData);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              setError(`Failed to process screenshot: ${errorMessage}`);
              await restoreWindow();
            } finally {
              setIsCapturing(false);
            }
            return;
          }

          setTempScreenshotPath(screenshotPath);
          setMode("editing");
          try {
            await invoke("move_window_to_active_space");
          } catch {}
          await restoreWindowOnScreen(mouseX, mouseY);
          setIsCapturing(false);
          return;
        }

        // result === "ok" means Windows/macOS: region-selector window is now open.
        // The "region-selected" event listener will handle crop + editor from here.
        // Make sure the selector window is fullscreen and focused.
        try {
          const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
          const allWindows = await getAllWebviewWindows();
          const selector = allWindows.find((win) => win.label === "region-selector");
          if (selector) {
            await selector.setFullscreen(true);
            await selector.setFocus();
          }
        } catch {}
        // Don't setIsCapturing(false) here — the region-selected listener will do it
        return;
      }

      // ─── Fullscreen / Window capture ──────────────────────────────────────
      const commandMap: Record<Exclude<CaptureMode, "ocr" | "region">, string> = {
        fullscreen: "native_capture_fullscreen",
        window: "native_capture_window",
      };

      const screenshotPath = await invoke<string>(commandMap[captureMode], {
        saveDir: currentTempDir,
      });

      // Get mouse position IMMEDIATELY after screenshot completes
      // This captures where the user finished their selection
      let mouseX: number | undefined;
      let mouseY: number | undefined;
      try {
        const [x, y] = await invoke<[number, number]>("get_mouse_position");
        mouseX = x;
        mouseY = y;
      } catch {
        // Silently fail - will fall back to centering
      }

      invoke("play_screenshot_sound").catch(console.error);

      if (shouldAutoApply) {
        try {
          const processedImageData =
            await processScreenshotWithDefaultBackground(screenshotPath);

          const savedPath = await invoke<string>("save_edited_image", {
            imageData: processedImageData,
            saveDir: currentSaveDir,
            copyToClip: shouldCopyToClipboard,
          });

          await appWindow.hide();
          await showQuickOverlay(savedPath, mouseX, mouseY, processedImageData);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(`Failed to process screenshot: ${errorMessage}`);
          await restoreWindow();
        } finally {
          setIsCapturing(false);
        }
        return;
      }

      setTempScreenshotPath(screenshotPath);
      setMode("editing");
      try {
        await invoke("move_window_to_active_space");
      } catch {
      }
      await restoreWindowOnScreen(mouseX, mouseY);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("cancelled") || errorMessage.includes("was cancelled")) {
        // Only restore window if not in auto-apply mode
        if (!shouldAutoApply) {
          await restoreWindow();
        }
      } else if (errorMessage.includes("already in progress")) {
        setError("Please wait for the current screenshot to complete");
        if (!shouldAutoApply) {
          await restoreWindow();
        }
      } else if (
        errorMessage.toLowerCase().includes("permission") ||
        errorMessage.toLowerCase().includes("access") ||
        errorMessage.toLowerCase().includes("denied")
      ) {
        setError(
          "Screen Recording permission required. Please go to System Settings > Privacy & Security > Screen Recording and enable access for FrameXShot, then restart the app."
        );
        // Always show window for permission errors so user can see the message
        await restoreWindow();
      } else {
        setError(errorMessage);
        if (!shouldAutoApply) {
          await restoreWindow();
        }
      }
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  // Setup ref to hold the latest handleCapture function to prevent stale closures and avoid re-registering hotkeys
  const handleCaptureRef = useRef(handleCapture);
  useEffect(() => {
    handleCaptureRef.current = handleCapture;
  }, [handleCapture]);

  // Setup desktop global hotkeys
  useEffect(() => {
    let active = true;

    const setupHotkeys = async () => {
      try {
        if (!enableGlobalHotkeys) {
          try {
            await unregisterAll();
          } catch {}
          registeredShortcutsRef.current.clear();
          return;
        }

        try {
          await unregisterAll();
        } catch {
          const shortcutsToUnregister = Array.from(registeredShortcutsRef.current);
          if (shortcutsToUnregister.length > 0) {
            await unregister(shortcutsToUnregister).catch(() => {});
          }
        }
        registeredShortcutsRef.current.clear();

        const actionMap: Record<string, CaptureMode> = {
          "Capture Region": "region",
          "Capture Screen": "fullscreen",
          "Capture Window": "window",
          "OCR Region": "ocr",
        };

        for (const shortcut of shortcuts) {
          if (!shortcut.enabled || !active) continue;

          const action = actionMap[shortcut.action];
          if (action) {
            const hotkeyStr = shortcut.shortcut.trim();
            if (!hotkeyStr) continue;

            try {
              await register(hotkeyStr, (event) => {
                // Only trigger on KeyDown/Pressed event to avoid double-triggers on KeyUp
                if (!event || event.state === "Pressed" || !event.state) {
                  handleCaptureRef.current(action);
                }
              });
              registeredShortcutsRef.current.add(hotkeyStr);
            } catch (err) {
              console.warn(`Failed to register primary shortcut "${hotkeyStr}":`, err);

              // Fallback for Linux/Windows/Mac if CommandOrControl alias needs alternative format
              const fallbackStr = hotkeyStr.includes("CommandOrControl")
                ? hotkeyStr.replace("CommandOrControl", "Ctrl")
                : hotkeyStr.includes("Ctrl")
                ? hotkeyStr.replace("Ctrl", "CommandOrControl")
                : null;

              if (fallbackStr) {
                try {
                  await register(fallbackStr, (event) => {
                    if (!event || event.state === "Pressed" || !event.state) {
                      handleCaptureRef.current(action);
                    }
                  });
                  registeredShortcutsRef.current.add(fallbackStr);
                } catch (fallbackErr) {
                  console.error(`Failed to register fallback shortcut "${fallbackStr}":`, fallbackErr);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to setup hotkeys:", err);
      }
    };

    setupHotkeys();

    return () => {
      active = false;
      const shortcutsToUnregister = Array.from(registeredShortcutsRef.current);
      if (shortcutsToUnregister.length > 0) {
        unregister(shortcutsToUnregister).catch(console.error);
      }
      registeredShortcutsRef.current.clear();
    };
  }, [shortcuts, enableGlobalHotkeys, settingsVersion]);

  useEffect(() => {
    let unlisten1: (() => void) | null = null;
    let unlisten2: (() => void) | null = null;
    let unlisten3: (() => void) | null = null;
    let unlisten4: (() => void) | null = null;
    let unlisten5: (() => void) | null = null;
    let unlisten6: (() => void) | null = null;
    let unlisten7: (() => void) | null = null;
    let unlisten8: (() => void) | null = null;
    let unlisten9: (() => void) | null = null;
    let unlisten10: (() => void) | null = null;
    let mounted = true;

    const setupListeners = async () => {
      // Use refs to always call the latest handler without re-registering
      unlisten1 = await listen("capture-triggered", () => {
        if (mounted) handleCaptureRef.current("region");
      });
      unlisten2 = await listen("capture-fullscreen", () => {
        if (mounted) handleCaptureRef.current("fullscreen");
      });
      unlisten3 = await listen("capture-window", () => {
        if (mounted) handleCaptureRef.current("window");
      });
      unlisten4 = await listen("capture-ocr", () => {
        if (mounted) handleCaptureRef.current("ocr");
      });
      unlisten5 = await listen("open-preferences", () => {
        if (mounted) setMode("preferences");
      });
      unlisten6 = await listen("auto-apply-changed", (event: { payload: boolean }) => {
        if (mounted) {
          setAutoApplyBackground(event.payload);
        }
      });
      unlisten7 = await listen<{ path: string }>("open-editor-for-path", async (event) => {
        if (!mounted) return;
        const { path } = event.payload;
        setTempScreenshotPath(path);
        setMode("editing");
        try {
          await invoke("move_window_to_active_space");
        } catch {
        }
        await restoreWindow();
      });
      unlisten8 = await listen("show-last-capture-overlay", async () => {
        if (!mounted) return;
        try {
          const store = await Store.load("settings.json");
          const lastPath = await store.get<string>("lastCapturePath");
          if (lastPath) {
            await showQuickOverlay(lastPath);
          }
        } catch (error) {
          console.error("Failed to show last capture overlay:", error);
        }
      });
      unlisten9 = await listen<{ x: number; y: number; width: number; height: number }>("region-selected", async (event) => {
        if (!mounted) return;
        const { x, y, width, height } = event.payload;
        const { autoApplyBackground: shouldAutoApply, saveDir: currentSaveDir, copyToClipboard: shouldCopyToClipboard, tempDir: td } = settingsRef.current;
        try {
          const croppedPath = await invoke<string>("crop_and_save_region", {
            x, y, width, height,
            saveDir: td || currentSaveDir
          });
          invoke("play_screenshot_sound").catch(() => {});
          
          if (activeCaptureModeRef.current === "ocr") {
            try {
              const recognizedText = await invoke<string>("perform_ocr_on_file", { path: croppedPath });
              toast.success("Text copied to clipboard!", {
                description: recognizedText.length > 50 ? `${recognizedText.substring(0, 50)}...` : recognizedText,
                duration: 3000,
              });
              await getCurrentWindow().hide();
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              setError(`OCR failed: ${errorMessage}`);
              toast.error("OCR failed", { description: errorMessage, duration: 5000 });
              await restoreWindow();
            } finally {
              setIsCapturing(false);
            }
            return;
          }

          if (shouldAutoApply) {
            try {
              const processedImageData = await processScreenshotWithDefaultBackground(croppedPath);
              const savedPath = await invoke<string>("save_edited_image", {
                imageData: processedImageData,
                saveDir: currentSaveDir,
                copyToClip: shouldCopyToClipboard,
              });
              await getCurrentWindow().hide();
              await showQuickOverlay(savedPath);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              setError(`Failed to process screenshot: ${errorMessage}`);
              await restoreWindow();
            } finally {
              setIsCapturing(false);
            }
            return;
          }

          // Restore window FIRST so it's visible when ImageEditor mounts
          await restoreWindow();
          setTempScreenshotPath(croppedPath);
          setMode("editing");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          await restoreWindow();
        } finally {
          setIsCapturing(false);
        }
      });
      unlisten10 = await listen("region-selection-cancelled", async () => {
        if (!mounted) return;
        setIsCapturing(false);
        await restoreWindow();
      });
    };

    setupListeners();

    return () => {
      mounted = false;
      unlisten1?.();
      unlisten2?.();
      unlisten3?.();
      unlisten4?.();
      unlisten5?.();
      unlisten6?.();
      unlisten7?.();
      unlisten8?.();
      unlisten9?.();
      unlisten10?.();
    };
  }, []); // Empty dependency array - only run once on mount

  // Reload settings when coming back from preferences
  const handleSettingsChange = useCallback(async () => {
    await loadSettings();
    setSettingsVersion(v => v + 1);
  }, [loadSettings]);

  // Toggle auto-apply from main page
  const handleAutoApplyToggle = useCallback(async (checked: boolean) => {
    setAutoApplyBackground(checked);
    try {
      const store = await Store.load("settings.json");
      await store.set("autoApplyBackground", checked);
      await store.save();
    } catch (err) {
      console.error("Failed to save auto-apply setting:", err);
      toast.error("Failed to save setting");
    }
  }, []);

  const handleBackFromPreferences = useCallback(async () => {
    await loadSettings();
    setSettingsVersion(v => v + 1);
    setMode("main");
  }, [loadSettings]);

  async function handleEditorSave(editedImageData: string) {
    try {
      const savedPath = await invoke<string>("save_edited_image", {
        imageData: editedImageData,
        saveDir,
        copyToClip: copyToClipboard,
      });

      toast.success("Image saved", {
        description: savedPath,
        duration: 4000,
      });

      editorActions.reset();
      setMode("main");
      setTempScreenshotPath(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      toast.error("Failed to save image", {
        description: errorMessage,
        duration: 5000,
      });
      editorActions.reset();
      setMode("main");
    }
  }

  async function handleEditorCancel() {
    editorActions.reset();
    setMode("main");
    setTempScreenshotPath(null);
  }

  // Get shortcut display for a specific action
  const getShortcutDisplay = (actionId: string): string => {
    const shortcut = shortcuts.find(s => s.id === actionId);
    if (shortcut && shortcut.enabled) {
      return formatShortcut(shortcut.shortcut);
    }
    // Fallback to defaults
    const defaultShortcut = DEFAULT_SHORTCUTS.find(s => s.id === actionId);
    return defaultShortcut ? formatShortcut(defaultShortcut.shortcut) : "—";
  };

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-background">
      {/* Editor — always mounted when path exists, only visible in editing mode */}
      <div className={mode === "editing" ? "flex flex-1 overflow-hidden" : "hidden"}>
        {tempScreenshotPath && (
          <Suspense fallback={<LoadingFallback />}>
            <ImageEditor
              imagePath={tempScreenshotPath}
              onSave={handleEditorSave}
              onCancel={handleEditorCancel}
            />
          </Suspense>
        )}
      </div>

      {/* Onboarding — always mounted when shown */}
      <div className={showOnboarding ? "flex-1 overflow-auto" : "hidden"}>
        <Suspense fallback={<LoadingFallback />}>
          <OnboardingFlow
            onComplete={() => {
              setShowOnboarding(false);
            }}
          />
        </Suspense>
      </div>

      {/* Preferences — always mounted when shown */}
      <div className={mode === "preferences" && !showOnboarding ? "flex-1 overflow-auto" : "hidden"}>
        <Suspense fallback={<LoadingFallback />}>
          <PreferencesPage 
            onBack={handleBackFromPreferences} 
            onSettingsChange={handleSettingsChange}
          />
        </Suspense>
      </div>

      {/* Main page */}
      <div className={mode !== "editing" && !showOnboarding && mode !== "preferences" ? "flex-1 overflow-auto bg-canvas" : "hidden"}>
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-38px)] p-6 text-foreground">
          <div className="w-full max-w-xl space-y-6">
            
            {/* Minimal Framer Header Bar */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-medium tracking-[-0.03em] leading-none text-foreground">
                  FrameXShot
                </h1>
                <span className="text-[11px] font-medium text-muted-foreground tracking-tight">
                  v{__APP_VERSION__}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2.5 pr-3 border-r border-border">
                  <label htmlFor="auto-apply-toggle" className="text-xs text-muted-foreground font-medium cursor-pointer select-none">
                    Auto-apply background
                  </label>
                  <Switch
                    id="auto-apply-toggle"
                    checked={autoApplyBackground}
                    onCheckedChange={handleAutoApplyToggle}
                  />
                </div>
                <SettingsIcon onClick={() => setMode("preferences")} />
              </div>
            </div>

            {/* Main 4-Column Action Cards */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium tracking-[-0.01em] text-muted-foreground uppercase">
                  Capture Mode
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2.5">
                <button
                  onClick={() => handleCapture("region")}
                  disabled={isCapturing}
                  className="flex flex-col items-center justify-center p-3.5 gap-2 rounded-xl bg-card border border-border hover:bg-secondary hover:border-border active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group disabled:opacity-50 cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-secondary group-hover:bg-muted transition-colors duration-[var(--duration-quick)]">
                    <Crop className="size-4 text-foreground" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-xs font-medium text-foreground tracking-[-0.01em]">Region</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{getShortcutDisplay("region")}</span>
                  </div>
                </button>

                <button
                  onClick={() => handleCapture("ocr")}
                  disabled={isCapturing}
                  className="flex flex-col items-center justify-center p-3.5 gap-2 rounded-xl bg-card border border-border hover:bg-secondary hover:border-border active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group disabled:opacity-50 cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-secondary group-hover:bg-muted transition-colors duration-[var(--duration-quick)]">
                    <ScanText className="size-4 text-foreground" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-xs font-medium text-foreground tracking-[-0.01em]">OCR Text</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{getShortcutDisplay("ocr")}</span>
                  </div>
                </button>

                <button
                  onClick={() => handleCapture("fullscreen")}
                  disabled={isCapturing}
                  className="flex flex-col items-center justify-center p-3.5 gap-2 rounded-xl bg-card border border-border hover:bg-secondary hover:border-border active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group disabled:opacity-50 cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-secondary group-hover:bg-muted transition-colors duration-[var(--duration-quick)]">
                    <Monitor className="size-4 text-foreground" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-xs font-medium text-foreground tracking-[-0.01em]">Screen</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{getShortcutDisplay("fullscreen")}</span>
                  </div>
                </button>

                <button
                  onClick={() => handleCapture("window")}
                  disabled={isCapturing}
                  className="flex flex-col items-center justify-center p-3.5 gap-2 rounded-xl bg-card border border-border hover:bg-secondary hover:border-border active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group disabled:opacity-50 cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-secondary group-hover:bg-muted transition-colors duration-[var(--duration-quick)]">
                    <AppWindowMac className="size-4 text-foreground" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-xs font-medium text-foreground tracking-[-0.01em]">Window</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{getShortcutDisplay("window")}</span>
                  </div>
                </button>
              </div>
            </div>

            {isCapturing && (
              <div className="flex items-center justify-center gap-2 py-1.5 text-accent text-xs font-medium">
                <svg className="animate-spin size-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Waiting for selection...
              </div>
            )}

            {error && (
              <div className="p-3.5 bg-destructive/10 border border-destructive/20 rounded-xl space-y-1">
                <div className="font-medium text-destructive text-xs">Error</div>
                <div className="text-destructive/80 text-xs leading-relaxed text-pretty">{error}</div>
              </div>
            )}

            {/* Shortcuts Reference Panel */}
            <div className="space-y-2.5 pt-2 border-t border-border">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium tracking-[-0.01em] text-muted-foreground uppercase">
                  Keyboard Shortcuts
                </span>
                <span className="text-[11px] text-muted-foreground">Global</span>
              </div>

              <div className="p-4 rounded-xl bg-card border border-border space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Save Image</span>
                    <kbd className="px-2 py-0.5 bg-secondary border border-border rounded text-foreground font-mono text-[11px] tabular-nums">
                      Ctrl+S
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Copy Image</span>
                    <kbd className="px-2 py-0.5 bg-secondary border border-border rounded text-foreground font-mono text-[11px] tabular-nums">
                      Ctrl+Shift+C
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Undo / Redo</span>
                    <div className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-foreground font-mono text-[11px] tabular-nums">Ctrl+Z</kbd>
                      <span className="text-muted-foreground">/</span>
                      <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-foreground font-mono text-[11px] tabular-nums">Ctrl+Shift+Z</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Dismiss / Close</span>
                    <kbd className="px-2 py-0.5 bg-secondary border border-border rounded text-foreground font-mono text-[11px] tabular-nums">
                      Esc
                    </kbd>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Directory Info Panel */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium tracking-[-0.01em] text-muted-foreground uppercase">
                  Save Location
                </span>
                <button
                  onClick={() => setMode("preferences")}
                  className="text-[11px] text-accent hover:underline cursor-pointer"
                >
                  Change
                </button>
              </div>

              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border">
                <Folder className="size-4 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono text-foreground/90 truncate flex-1">
                  {saveDir || "Desktop"}
                </span>
              </div>
            </div>

            {/* About & Developer Links */}
            <div className="flex flex-col items-center justify-between gap-3 pt-3 border-t border-border/80 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span>Created with</span>
                <span className="text-red-400">♥</span>
                <span>by</span>
                <span className="font-medium text-foreground">Sahil</span>
              </div>

              <div className="flex items-center gap-4">
                <a
                  href="https://x.com/sahilcodex"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                >
                  <Twitter className="size-3.5 text-accent" />
                  <span>@sahilcodex</span>
                </a>

                <a
                  href="https://github.com/sahilcodexx"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                >
                  <Github className="size-3.5 text-foreground/80" />
                  <span>sahilcodexx</span>
                </a>

                <a
                  href="https://sahilcodex.vercel.app"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                >
                  <Globe className="size-3.5 text-emerald-400" />
                  <span>Portfolio</span>
                </a>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
