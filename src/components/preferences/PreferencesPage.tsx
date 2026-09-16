import { useState, useEffect, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Folder, FolderOpen, Sliders, Image as ImageIcon, Keyboard, Info, Loader2, Check, Sparkles, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { BackgroundImageSelector } from "./BackgroundImageSelector";
import { KeyboardShortcutManager } from "./KeyboardShortcutManager";
import type { KeyboardShortcut } from "./KeyboardShortcutManager";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface PreferencesPageProps {
  onBack: () => void;
  onSettingsChange?: () => void;
}

interface GeneralSettings {
  saveDir: string;
  copyToClipboard: boolean;
}

type NavSection = "general" | "background" | "shortcuts" | "about";

export function PreferencesPage({ onBack, onSettingsChange }: PreferencesPageProps) {
  const [activeNav, setActiveNav] = useState<NavSection>("general");
  const [settings, setSettings] = useState<GeneralSettings>({
    saveDir: "",
    copyToClipboard: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const { theme, setTheme } = useTheme();

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load("settings.json");
        const copyToClip = await store.get<boolean>("copyToClipboard");
        const saveDir = await store.get<string>("saveDir");

        setSettings({
          saveDir: saveDir || "",
          copyToClipboard: copyToClip ?? true,
        });
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
                      placeholder="Enter path (e.g. ~/Desktop or /home/user/Pictures)"
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
                      Professional Linux Desktop Screenshot Suite with Native Canvas Editing
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
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}
