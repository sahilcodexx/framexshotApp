import { useState, useEffect, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FileText, Folder, FolderOpen, Sliders, Image as ImageIcon, Keyboard, Info, Loader2, Check, Sparkles, Moon, Sun, Power, EyeOff, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RangeSliderDebounced } from "@/components/motion/range-slider-debounced";
import { BackgroundImageSelector } from "./BackgroundImageSelector";
import { KeyboardShortcutManager } from "./KeyboardShortcutManager";
import type { KeyboardShortcut } from "./KeyboardShortcutManager";
import { useTheme } from "@/hooks/useTheme";
import { buildFilenameFromTemplate, DEFAULT_FILENAME_TEMPLATE, EXPORT_SCALES, type SaveFormat } from "@/lib/export-settings";
import { getAutostartState, setAutostart } from "@/lib/autostart";
import { checkForUpdate, installUpdate, relaunchApp, type UpdateCheck } from "@/lib/updater";
import { cn } from "@/lib/utils";

interface PreferencesPageProps {
  onBack: () => void;
  onSettingsChange?: () => void;
}

interface GeneralSettings {
  saveDir: string;
  copyToClipboard: boolean;
  saveFormat: SaveFormat;
  saveQuality: number;
  saveScale: number;
  filenameTemplate: string;
}

type NavSection = "general" | "background" | "shortcuts" | "about";

// Sample date for the filename-template preview line; module scope keeps the
// three token samples on the same render consistent.
const NOW = new Date();

export function PreferencesPage({ onBack, onSettingsChange }: PreferencesPageProps) {
  const [activeNav, setActiveNav] = useState<NavSection>("general");
  const [settings, setSettings] = useState<GeneralSettings>({
    saveDir: "",
    copyToClipboard: true,
    saveFormat: "png",
    saveQuality: 90,
    saveScale: 1,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  });
  // Draft quality for instant slider feedback; persisted on commit.
  const [quality, setQuality] = useState(90);
  const [isLoading, setIsLoading] = useState(true);
  // Launch-at-login is owned by the OS, not by `settings.json`, so it is held
  // separately from `GeneralSettings` and read back from Rust on mount.
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [startHiddenToTray, setStartHiddenToTray] = useState(true);
  // Set when the platform cannot report the state (locked-down desktop, or a
  // build without the autostart plugin). The switches are disabled rather than
  // shown as off, so "unknown" is never mistaken for "disabled".
  const [autostartUnavailable, setAutostartUnavailable] = useState(false);
  const { theme, setTheme } = useTheme();

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load("settings.json");
        const copyToClip = await store.get<boolean>("copyToClipboard");
        const saveDir = await store.get<string>("saveDir");
        const saveFormat = await store.get<SaveFormat>("saveFormat");
        const saveQuality = await store.get<number>("saveQuality");
        const saveScale = await store.get<number>("saveScale");
        const filenameTemplate = await store.get<string>("filenameTemplate");

        setSettings({
          saveDir: saveDir || "",
          copyToClipboard: copyToClip ?? true,
          saveFormat: saveFormat === "jpeg" || saveFormat === "webp" ? saveFormat : "png",
          saveQuality:
            typeof saveQuality === "number" && saveQuality >= 1 && saveQuality <= 100
              ? Math.round(saveQuality)
              : 90,
          saveScale: saveScale === 0.5 || saveScale === 2 ? saveScale : 1,
          filenameTemplate: filenameTemplate?.trim() ? filenameTemplate : DEFAULT_FILENAME_TEMPLATE,
        });
        setQuality(
          typeof saveQuality === "number" && saveQuality >= 1 && saveQuality <= 100
            ? Math.round(saveQuality)
            : 90
        );

        // Read separately from the store: this is the OS registration, not a
        // preference we own. A failure here must not block the rest of the
        // page from loading.
        try {
          const autostart = await getAutostartState();
          setLaunchAtLogin(autostart.enabled);
          setStartHiddenToTray(autostart.startHidden);
        } catch (err) {
          console.error("Failed to read autostart state:", err);
          setAutostartUnavailable(true);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));

      try {
        const store = await Store.load("settings.json");
        await store.set(key, value);
        await store.save();
        onSettingsChange?.();
      } catch (err) {
        console.error(`Failed to save ${key}:`, err);
        toast.error(`Failed to save setting`);
      }
    },
    [onSettingsChange]
  );

  const applyAutostart = useCallback(
    async (next: { enabled: boolean; startHidden: boolean }) => {
      // Optimistic so the switch reacts on the same frame as the click; the
      // OS state is authoritative and replaces it a moment later.
      setLaunchAtLogin(next.enabled);
      setStartHiddenToTray(next.startHidden);

      try {
        const actual = await setAutostart(next.enabled, next.startHidden);
        setLaunchAtLogin(actual.enabled);
        setStartHiddenToTray(actual.startHidden);

        // The OS refused to register the app even though the call succeeded.
        // Snapping the switch back is the only honest thing to show.
        if (actual.enabled !== next.enabled) {
          toast.error(
            actual.enabled
              ? "Could not turn off launch at login"
              : "Could not enable launch at login"
          );
        } else {
          toast.success(
            actual.enabled
              ? next.startHidden
                ? "FrameXShot will start hidden in the tray at login"
                : "FrameXShot will open at login"
              : "Launch at login turned off"
          );
        }
      } catch (err) {
        console.error("Failed to update autostart:", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to update launch at login"
        );
        // Re-read rather than guessing: the flag file is written before the OS
        // call, so startHidden may genuinely have changed even though the
        // enable/disable failed.
        try {
          const actual = await getAutostartState();
          setLaunchAtLogin(actual.enabled);
          setStartHiddenToTray(actual.startHidden);
        } catch {
          setLaunchAtLogin(!next.enabled);
        }
      }
    },
    []
  );

  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleCheckForUpdate = useCallback(async () => {
    setIsChecking(true);
    setUpdateError(null);
    try {
      setUpdate(await checkForUpdate());
    } catch (err) {
      // Distinguish "could not check" from "up to date" — showing a confident
      // "You're up to date" to someone who is offline is a lie.
      setUpdate(null);
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsChecking(false);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    const version = update?.latestVersion;
    if (!version) return;

    const confirmed = window.confirm(
      `Install FrameXShot ${version}?\n\nThe app will close and reopen when it's done.`
    );
    if (!confirmed) return;

    setIsInstalling(true);
    setUpdateError(null);
    try {
      await installUpdate(version);
      // The running process is still the old binary until this returns.
      await relaunchApp();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setIsInstalling(false);
    }
  }, [update]);

  const handleShortcutsChange = useCallback(
    (_shortcuts: KeyboardShortcut[]) => {
      onSettingsChange?.();
    },
    [onSettingsChange]
  );

  const handleImageSelect = useCallback(
    async (_imageSrc: string) => {
      try {
        onSettingsChange?.();
      } catch (err) {
        console.error("Failed to save default background:", err);
        toast.error("Failed to save default background");
      }
    },
    [onSettingsChange]
  );

  const handleBrowseFolder = useCallback(async () => {
    try {
      const selectedPath = await invoke<string | null>("select_folder_dialog", {
        defaultPath: settings.saveDir,
      });
      if (selectedPath) {
        updateSetting("saveDir", selectedPath);
        toast.success("Save directory updated");
      }
    } catch (err) {
      console.error("Failed to open folder picker:", err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [settings.saveDir, updateSetting]);

  if (isLoading) {
    return (
      <main className="h-full flex items-center justify-center bg-canvas text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-accent" />
          Loading settings...
        </div>
      </main>
    );
  }

  const navItems: { id: NavSection; label: string; icon: React.ReactNode; description: string }[] = [
    { id: "general", label: "General", icon: <Sliders className="size-4" />, description: "Save path & clipboard options" },
    { id: "background", label: "Default Background", icon: <ImageIcon className="size-4" />, description: "Wallpaper & gradient presets" },
    { id: "shortcuts", label: "Shortcuts", icon: <Keyboard className="size-4" />, description: "Global hotkeys & keybindings" },
    { id: "about", label: "About", icon: <Info className="size-4" />, description: "App details & build version" },
  ];

  return (
    <main className="h-full flex flex-col md:flex-row bg-canvas text-foreground overflow-hidden font-sans select-none">
      {/* Sidebar Navigation Panel */}
      <aside className="w-full md:w-64 shrink-0 bg-sidebar border-b md:border-b-0 md:border-r border-sidebar-border/60 flex flex-col justify-between p-4">
        <div className="space-y-5">
          {/* Header Back Button & App Title */}
          <div className="flex items-center gap-3 pb-2 border-b border-border/40">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="size-8 rounded-full bg-secondary hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              aria-label="Back to main"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
            <div>
              <h1 className="text-sm font-semibold tracking-[-0.02em] text-foreground">
                Settings
              </h1>
              <p className="text-[11px] text-muted-foreground">FrameXShot</p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-xl font-medium text-xs flex items-center justify-between transition-all duration-150 group",
                    isActive
                      ? "bg-card text-foreground font-semibold shadow-sm border border-border/80"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn("transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {isActive && <div className="size-1.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Info */}
        <div className="pt-4 border-t border-border/30 px-2 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>FrameXShot OS</span>
          <span className="font-mono text-[10px] text-muted-foreground/70">v{__APP_VERSION__}</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="flex-1 overflow-y-auto sidebar-scroll p-6 md:p-8 bg-canvas [contain:content]">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Section Header */}
          <div className="pb-3 border-b border-border/40">
            <h2 className="text-2xl font-medium leading-[0.95] tracking-[-0.04em] text-foreground">
              {navItems.find((n) => n.id === activeNav)?.label}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {navItems.find((n) => n.id === activeNav)?.description}
            </p>
          </div>

          {/* Section 1: General Settings */}
          {activeNav === "general" && (
            <Card className="rounded-xl border border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-sm font-semibold tracking-[-0.01em] text-foreground flex items-center gap-2">
                  <Sliders className="size-4 text-accent" />
                  Save & Clipboard Options
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-6">
                {/* Save Directory */}
                <div className="space-y-2">
                  <label
                    htmlFor="save-dir"
                    className="text-xs font-medium text-foreground flex items-center gap-2"
                  >
                    <Folder className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    Save Directory Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="save-dir"
                      type="text"
                      value={settings.saveDir}
                      onChange={(e) => updateSetting("saveDir", e.target.value)}
                      placeholder={"Enter path (e.g. ~/Pictures or C:\\Users\\You\\Pictures)"}
                      className="flex-1 px-3 py-2 bg-secondary border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent font-mono text-xs transition-colors"
                    />
                    <Button
                      type="button"
                      variant="default"
                      onClick={handleBrowseFolder}
                      className="rounded-xl px-3.5 text-xs font-medium flex items-center gap-1.5 shadow-sm shrink-0"
                    >
                      <FolderOpen className="size-3.5" />
                      Browse Folder
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Captured screenshots will automatically save to this directory location.
                  </p>
                </div>

                {/* Export Format */}
                <div className="flex items-center justify-between py-2 border-t border-border/30 pt-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">Export format</p>
                    <p className="text-[11px] text-muted-foreground">
                      Clipboard copies always use PNG for maximum compatibility
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
                    {(["png", "jpeg", "webp"] as SaveFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => updateSetting("saveFormat", fmt)}
                        aria-pressed={settings.saveFormat === fmt}
                        className={cn(
                          "rounded-full px-3 py-1 text-[11px] font-medium uppercase transition-colors",
                          settings.saveFormat === fmt
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Export Scale */}
                <div className="flex items-center justify-between py-2 border-t border-border/30 pt-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">Export scale</p>
                    <p className="text-[11px] text-muted-foreground">
                      Output size multiplier — 0.5× halves file size, 2× for retina posts
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
                    {EXPORT_SCALES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateSetting("saveScale", s)}
                        aria-pressed={settings.saveScale === s}
                        className={cn(
                          "rounded-full px-3 py-1 text-[11px] font-medium tabular-nums transition-colors",
                          settings.saveScale === s
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality (lossy formats only) */}
                {settings.saveFormat !== "png" && (
                  <div className="py-2 border-t border-border/30 pt-4">
                    <RangeSliderDebounced
                      label="Quality"
                      value={quality}
                      min={1}
                      max={100}
                      step={1}
                      showTicks={false}
                      format={(v) => `${v}%`}
                      onValueChangeTransient={(v) => setQuality(v)}
                      onValueCommit={(v) => updateSetting("saveQuality", v)}
                      aria-label="Export quality"
                    />
                  </div>
                )}

                {/* Filename Template */}
                <div className="space-y-2 py-2 border-t border-border/30 pt-4">
                  <label
                    htmlFor="filename-template"
                    className="text-xs font-medium text-foreground flex items-center gap-2"
                  >
                    <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    Filename template
                  </label>
                  <input
                    id="filename-template"
                    type="text"
                    value={settings.filenameTemplate}
                    onChange={(e) => setSettings((prev) => ({ ...prev, filenameTemplate: e.target.value }))}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || DEFAULT_FILENAME_TEMPLATE;
                      updateSetting("filenameTemplate", v);
                    }}
                    placeholder={DEFAULT_FILENAME_TEMPLATE}
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent font-mono text-xs transition-colors"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Tokens: <code className="font-mono text-foreground/80">%date</code> → {buildFilenameFromTemplate("%date", NOW)} · <code className="font-mono text-foreground/80">%time</code> → {buildFilenameFromTemplate("%time", NOW)}
                    <br />
                    Preview: <span className="font-mono text-foreground/80">{buildFilenameFromTemplate(settings.filenameTemplate, NOW)}.png</span>
                  </p>
                </div>

                {/* Copy to Clipboard */}
                <div className="flex items-center justify-between py-2 border-t border-border/30 pt-4">
                  <div className="space-y-0.5">
                    <label
                      htmlFor="copy-clipboard"
                      className="text-xs font-medium text-foreground cursor-pointer block"
                    >
                      Copy screenshot to clipboard
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Automatically copies the screenshot image to system clipboard upon saving
                    </p>
                  </div>
                  <Switch
                    id="copy-clipboard"
                    checked={settings.copyToClipboard}
                    onCheckedChange={(checked) => updateSetting("copyToClipboard", checked)}
                  />
                </div>

                {/* Theme */}
                <div className="flex items-center justify-between py-2 border-t border-border/30 pt-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">
                      Appearance
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Switch between dark and light theme
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
                    <button
                      type="button"
                      onClick={() => setTheme("dark")}
                      aria-label="Dark theme"
                      aria-pressed={theme === "dark"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-[var(--duration-quick)]",
                        theme === "dark"
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Moon className="size-3" aria-hidden="true" />
                      Dark
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme("light")}
                      aria-label="Light theme"
                      aria-pressed={theme === "light"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-[var(--duration-quick)]",
                        theme === "light"
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Sun className="size-3" aria-hidden="true" />
                      Light
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Startup / Launch at login */}
          {activeNav === "general" && (
            <Card className="rounded-xl border border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-sm font-semibold tracking-[-0.01em] text-foreground flex items-center gap-2">
                  <Power className="size-4 text-accent" />
                  Startup
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-2">
                <div className="flex items-center justify-between py-2">
                  <div className="space-y-0.5 pr-4">
                    <label
                      htmlFor="launch-at-login"
                      className="text-xs font-medium text-foreground cursor-pointer block"
                    >
                      Launch at login
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      {autostartUnavailable
                        ? "Unavailable — your system did not report a startup-app state"
                        : "Start FrameXShot automatically when you sign in"}
                    </p>
                  </div>
                  <Switch
                    id="launch-at-login"
                    checked={launchAtLogin}
                    disabled={autostartUnavailable}
                    onCheckedChange={(checked) =>
                      applyAutostart({ enabled: checked, startHidden: startHiddenToTray })
                    }
                  />
                </div>

                <div
                  className={cn(
                    "flex items-center justify-between py-2 border-t border-border/30 pt-4 transition-opacity",
                    !launchAtLogin && "opacity-50"
                  )}
                >
                  <div className="space-y-0.5 pr-4">
                    <label
                      htmlFor="start-hidden"
                      className="text-xs font-medium text-foreground flex items-center gap-2 cursor-pointer"
                    >
                      <EyeOff className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Start hidden to tray
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      At login, stay in the menu bar / tray instead of opening the window
                    </p>
                  </div>
                  <Switch
                    id="start-hidden"
                    checked={startHiddenToTray}
                    disabled={!launchAtLogin || autostartUnavailable}
                    onCheckedChange={(checked) =>
                      applyAutostart({ enabled: launchAtLogin, startHidden: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section 2: Default Background */}
          {activeNav === "background" && (
            <Card className="rounded-xl border border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-sm font-semibold tracking-[-0.01em] text-foreground flex items-center gap-2">
                  <ImageIcon className="size-4 text-accent" />
                  Default Background Presets
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <BackgroundImageSelector onImageSelect={handleImageSelect} />
              </CardContent>
            </Card>
          )}

          {/* Section 3: Keyboard Shortcuts */}
          {activeNav === "shortcuts" && (
            <div className="space-y-6">
              <Card className="rounded-xl border border-border bg-card shadow-sm">
                <CardHeader className="pb-3 border-b border-border/40">
                  <CardTitle className="text-sm font-semibold tracking-[-0.01em] text-foreground flex items-center gap-2">
                    <Keyboard className="size-4 text-accent" />
                    Global Capture Hotkeys
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <KeyboardShortcutManager onShortcutsChange={handleShortcutsChange} />
                </CardContent>
              </Card>

              {/* Reference */}
              <Card className="rounded-xl border border-border bg-card shadow-sm">
                <CardHeader className="pb-3 border-b border-border/40">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Editor Keybindings Reference
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Save Image</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        ⌘S
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Copy Image</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        ⇧⌘C
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Undo Action</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        ⌘Z
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Redo Action</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        ⇧⌘Z
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Delete Selected</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        ⌫
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Close Window</span>
                      <kbd className="px-2 py-0.5 bg-secondary border border-border rounded-md text-foreground font-mono text-[11px] tabular-nums">
                        Esc
                      </kbd>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 4: About */}
          {activeNav === "about" && (
            <Card className="rounded-xl border border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-sm font-semibold tracking-[-0.01em] text-foreground flex items-center gap-2">
                  <Sparkles className="size-4 text-accent" />
                  Application Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-border/30">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">FrameXShot</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Professional Desktop Screenshot Suite with Native Canvas Editing
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-secondary border border-border text-xs font-mono text-foreground">
                    v{__APP_VERSION__}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                  <div className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-400" />
                    <span>Built with Tauri v2, React 19, Vite, and Rust xcap capture pipeline.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-400" />
                    <span>100% Local Processing — Zero network requests & full data privacy.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="size-3.5 text-emerald-400" />
                    <span>High-Performance Canvas Rendering & GPU Accelerated Compositing.</span>
                  </div>
                </div>

                {/* Updates */}
                <div className="pt-5 border-t border-border/30 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Updates</p>
                      <p className="text-[11px] text-muted-foreground">
                        {update === null
                          ? "Check whether a newer version is available"
                          : update.updateAvailable
                            ? `FrameXShot ${update.latestVersion} is available`
                            : `You're on the latest version (${update.currentVersion})`}
                      </p>
                    </div>

                    {update?.updateAvailable && update.canSelfUpdate ? (
                      <Button
                        type="button"
                        variant="default"
                        onClick={handleInstallUpdate}
                        disabled={isInstalling}
                        className="rounded-xl px-3.5 text-xs font-medium flex items-center gap-1.5 shrink-0"
                      >
                        {isInstalling ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        {isInstalling ? "Installing…" : "Install"}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCheckForUpdate}
                        disabled={isChecking || isInstalling}
                        className="rounded-xl px-3.5 text-xs font-medium flex items-center gap-1.5 shrink-0"
                      >
                        {isChecking ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        {isChecking ? "Checking…" : update?.updateAvailable ? "Re-check" : "Check"}
                      </Button>
                    )}
                  </div>

                  {/* A package manager owns this install — say so, rather than
                      offering a self-update that the manager would undo. */}
                  {update && !update.canSelfUpdate && (
                    <div className="rounded-xl border border-border bg-secondary/50 px-3 py-2.5 space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        Installed via{" "}
                        <span className="font-medium text-foreground">
                          {update.installMethod.replace("_", " ")}
                        </span>
                        , which manages updates itself. Run:
                      </p>
                      <code className="block font-mono text-[11px] text-foreground bg-background border border-border rounded-lg px-2 py-1.5 overflow-x-auto">
                        {update.manualUpdateHint}
                      </code>
                    </div>
                  )}

                  {updateError && (
                    <p className="text-[11px] text-destructive">
                      Could not check for updates: {updateError}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}
