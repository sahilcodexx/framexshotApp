import { useState, useEffect, useCallback, useRef } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Plus, Trash2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface KeyboardShortcut {
  id: string;
  action: string;
  shortcut: string;
  enabled: boolean;
}

interface KeyboardShortcutManagerProps {
  onShortcutsChange?: (shortcuts: KeyboardShortcut[]) => void;
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
      .replace(/Control/g, "⌃")
      .replace(/Shift/g, "⇧")
      .replace(/Alt|Option/g, "⌥")
      .replace(/\+/g, "");
  }
  return shortcut
    .replace(/CommandOrControl/g, "Ctrl+")
    .replace(/Command/g, "Ctrl+")
    .replace(/Control/g, "Ctrl+")
    .replace(/Shift/g, "Shift+")
    .replace(/Alt|Option/g, "Alt+")
    .replace(/\+\+/g, "+");
}

// Convert a keyboard event to Tauri shortcut format
function keyEventToShortcut(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  
  // Build modifier string
  if (e.metaKey || e.ctrlKey) {
    parts.push("CommandOrControl");
  }
  if (e.shiftKey) {
    parts.push("Shift");
  }
  if (e.altKey) {
    parts.push("Alt");
  }
  
  // Get the key - ignore modifier-only presses
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta", "Command"].includes(key)) {
    return null; // Still waiting for the main key
  }
  
  const isFKey = key.startsWith("F") && !isNaN(parseInt(key.slice(1)));

  // Need at least one modifier for a valid shortcut (unless F-key)
  if (parts.length === 0 && !isFKey) {
    return null;
  }
  
  // Convert key to proper format
  let keyName = key.toUpperCase();
  
  // Handle special keys
  if (key === " ") keyName = "Space";
  else if (key === "ArrowUp") keyName = "Up";
  else if (key === "ArrowDown") keyName = "Down";
  else if (key === "ArrowLeft") keyName = "Left";
  else if (key === "ArrowRight") keyName = "Right";
  else if (key === "Escape") keyName = "Escape";
  else if (key === "Enter") keyName = "Enter";
  else if (key === "Tab") keyName = "Tab";
  else if (key === "Backspace") keyName = "Backspace";
  else if (key === "Delete") keyName = "Delete";
  else if (key.length === 1) keyName = key.toUpperCase();
  else if (isFKey) keyName = key;
  
  parts.push(keyName);
  
  return parts.join("+");
}

export function KeyboardShortcutManager({ onShortcutsChange }: KeyboardShortcutManagerProps) {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(DEFAULT_SHORTCUTS);
  const [isRecording, setIsRecording] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recordedShortcut, setRecordedShortcut] = useState<string | null>(null);
  const [enableGlobalHotkeys, setEnableGlobalHotkeys] = useState<boolean>(true);
  const recordedShortcutRef = useRef<string | null>(null);
  const recordingRef = useRef<HTMLButtonElement>(null);

  // Load shortcuts & global hotkeys toggle on mount
  useEffect(() => {
    const loadShortcuts = async () => {
      try {
        const store = await Store.load("settings.json");
        const savedShortcuts = await store.get<KeyboardShortcut[]>("keyboardShortcuts");
        const savedGlobalToggle = await store.get<boolean>("enableGlobalHotkeys");

        if (savedGlobalToggle !== null && savedGlobalToggle !== undefined) {
          setEnableGlobalHotkeys(savedGlobalToggle);
        }

        if (savedShortcuts && Array.isArray(savedShortcuts)) {
          const mergedShortcuts = DEFAULT_SHORTCUTS.map((defaultShortcut) => {
            const saved = savedShortcuts.find((s) => s.id === defaultShortcut.id);
            return saved ? { ...defaultShortcut, ...saved } : defaultShortcut;
          });

          setShortcuts(mergedShortcuts);
          onShortcutsChange?.(mergedShortcuts);
        } else {
          setShortcuts(DEFAULT_SHORTCUTS);
          onShortcutsChange?.(DEFAULT_SHORTCUTS);
        }
      } catch (err) {
        console.error("Failed to load shortcuts:", err);
      }
    };
    loadShortcuts();
  }, []);

  const handleToggleGlobalHotkeys = useCallback(async (checked: boolean) => {
    setEnableGlobalHotkeys(checked);
    try {
      const store = await Store.load("settings.json");
      await store.set("enableGlobalHotkeys", checked);
      await store.save();
      toast.success(checked ? "App global hotkeys enabled" : "Global hotkeys disabled (Xwayland grab released)");
    } catch (err) {
      console.error("Failed to save global hotkey toggle:", err);
    }
  }, []);

  // Keyboard recording effect
  useEffect(() => {
    if (!isRecording || !editingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === "Escape") {
        setIsRecording(false);
        setEditingId(null);
        setRecordedShortcut(null);
        recordedShortcutRef.current = null;
        return;
      }

      const shortcut = keyEventToShortcut(e);
      if (shortcut) {
        recordedShortcutRef.current = shortcut;
        setRecordedShortcut(shortcut);
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const finalShortcut = recordedShortcutRef.current;
      if (finalShortcut && editingId) {
        const newShortcuts = shortcuts.map((s) =>
          s.id === editingId ? { ...s, shortcut: finalShortcut } : s
        );
        setShortcuts(newShortcuts);
        
        try {
          const store = await Store.load("settings.json");
          await store.set("keyboardShortcuts", newShortcuts);
          await store.save();
          onShortcutsChange?.(newShortcuts);
          toast.success("Shortcut updated");
        } catch (err) {
          console.error("Failed to save shortcuts:", err);
          toast.error("Failed to save shortcuts");
        }

        recordedShortcutRef.current = null;
        setIsRecording(false);
        setEditingId(null);
        setRecordedShortcut(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isRecording, editingId, shortcuts, onShortcutsChange]);

  const saveShortcuts = useCallback(async (newShortcuts: KeyboardShortcut[]) => {
    try {
      const store = await Store.load("settings.json");
      await store.set("keyboardShortcuts", newShortcuts);
      await store.save();
      onShortcutsChange?.(newShortcuts);
    } catch (err) {
      console.error("Failed to save shortcuts:", err);
      toast.error("Failed to save shortcuts");
    }
  }, [onShortcutsChange]);

  const handleStartRecording = useCallback((shortcut: KeyboardShortcut) => {
    setEditingId(shortcut.id);
    setRecordedShortcut(null);
    setIsRecording(true);
    // Focus the recording button to capture keyboard events
    setTimeout(() => recordingRef.current?.focus(), 0);
  }, []);

  const handleCancelRecording = useCallback(() => {
    setIsRecording(false);
    setEditingId(null);
    setRecordedShortcut(null);
  }, []);

  const handleToggle = useCallback(async (id: string) => {
    const newShortcuts = shortcuts.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    setShortcuts(newShortcuts);
    await saveShortcuts(newShortcuts);
  }, [shortcuts, saveShortcuts]);

  const handleDelete = useCallback(async (id: string) => {
    const newShortcuts = shortcuts.filter((s) => s.id !== id);
    setShortcuts(newShortcuts);
    await saveShortcuts(newShortcuts);
    toast.success("Shortcut removed");
  }, [shortcuts, saveShortcuts]);

  const handleAdd = useCallback(() => {
    const newId = `custom-${Date.now()}`;
    const newShortcut: KeyboardShortcut = {
      id: newId,
      action: "New Action",
      shortcut: "CommandOrControl+Shift+5",
      enabled: false,
    };
    const newShortcuts = [...shortcuts, newShortcut];
    setShortcuts(newShortcuts);
    saveShortcuts(newShortcuts);
    // Start recording for the new shortcut
    setTimeout(() => handleStartRecording(newShortcut), 100);
  }, [shortcuts, saveShortcuts, handleStartRecording]);

  return (
    <div className="space-y-4">
      {/* Global Hotkeys Master Switch */}
      <div className="p-3.5 bg-card border border-border rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-white">App Global Hotkeys</span>
            <p className="text-[11px] text-muted-foreground">
              {enableGlobalHotkeys
                ? "Listening for global key combinations"
                : "Disabled — Xwayland keyboard grab released for Hyprland/Wayland"}
            </p>
          </div>
          <Switch
            checked={enableGlobalHotkeys}
            onCheckedChange={handleToggleGlobalHotkeys}
            aria-label="Toggle App Global Hotkeys"
          />
        </div>

        {/* Hyprland / Wayland Native Binding Hint */}
        <div className="p-2.5 bg-[#1a1f26] border border-[#2a3442] rounded-lg text-[11px] text-[#93c5fd] flex items-start gap-2 mt-2">
          <Terminal className="size-4 text-[#60a5fa] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-[#bfdbfe]">Hyprland / Wayland Binds:</p>
            <p className="text-[#93c5fd]/90 font-mono text-[10px] bg-[#0f172a] px-2 py-1 rounded border border-[#1e293b]">
              bind = $mainMod SHIFT, 2, exec, framexshot --capture-region
            </p>
            <p className="text-[#93c5fd]/80 text-[10px]">
              If Hyprland keybinds stop when opening FrameXShot, turn off "App Global Hotkeys" above to prevent Xwayland grabs, and add <code className="bg-[#0f172a] px-1 py-0.5 rounded font-mono">framexshot --capture-region</code> directly to hyprland.conf!
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Shortcut Bindings
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAdd}
          className="rounded-full text-xs h-7 px-3 font-medium"
        >
          <Plus className="size-3 mr-1" aria-hidden="true" />
          Add Shortcut
        </Button>
      </div>

      <div className="space-y-2.5">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.id} className="p-3 bg-secondary/80 border border-border/80 rounded-xl hover:border-border transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                {editingId === shortcut.id && isRecording ? (
                  <div className="flex items-center gap-2">
                    <button
                      ref={recordingRef}
                      className="flex-1 px-3 py-1.5 bg-card border-2 border-accent rounded-lg text-foreground text-xs font-mono focus:outline-none animate-pulse text-left"
                      autoFocus
                    >
                      {recordedShortcut ? formatShortcut(recordedShortcut) : "Press shortcut keys..."}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelRecording}
                      className="rounded-full text-xs h-7"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 pr-2">
                    <span className="text-xs font-medium text-foreground">{shortcut.action}</span>
                    <button
                      onClick={() => handleStartRecording(shortcut)}
                      className="px-2.5 py-1 bg-card border border-border rounded-lg text-foreground font-mono text-xs tabular-nums hover:border-accent transition-colors"
                      title="Click to record new shortcut"
                    >
                      {formatShortcut(shortcut.shortcut)}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggle(shortcut.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border",
                    shortcut.enabled
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {shortcut.enabled ? "Enabled" : "Disabled"}
                </button>
                {shortcut.id.startsWith("custom-") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(shortcut.id)}
                    className="size-7 rounded-full text-red-400 hover:text-red-300 hover:bg-red-950/30"
                    aria-label="Delete shortcut"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
