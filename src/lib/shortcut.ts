import { isMac } from "@/lib/platform";

/**
 * Map a keyboard event's physical key (`event.code`) to the token used in
 * Tauri shortcut strings (`CommandOrControl+Shift+2`).
 *
 * `event.key` is the wrong source for this: with Shift held, Digit2 becomes
 * `"@"` (or `"` on some layouts), so Ctrl+Shift+2 would never match the stored
 * `"…+2"` binding. `event.code` is layout-independent.
 */
export function keyNameFromEvent(e: KeyboardEvent): string | null {
  const { code, key } = e;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return null;
  }

  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F\d{1,2}$/.test(code)) return code;

  const named: Record<string, string> = {
    Space: "Space",
    Escape: "Escape",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  };
  if (named[code]) return named[code];

  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Convert a keydown into a Tauri shortcut string, or null while still waiting for a non-modifier. */
export function keyboardEventToShortcut(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  const keyName = keyNameFromEvent(e);
  if (!keyName) return null;

  const isFKey = /^F\d{1,2}$/.test(keyName);
  if (parts.length === 0 && !isFKey) return null;

  parts.push(keyName);
  return parts.join("+");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.isContentEditable);
}

type ShortcutMods = {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
};

function parseShortcut(shortcut: string, mac: boolean): ShortcutMods | null {
  const tokens = shortcut
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const key = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1).map((t) => t.toLowerCase());

  let ctrl = false;
  let meta = false;
  let shift = false;
  let alt = false;

  for (const m of mods) {
    if (m === "commandorcontrol" || m === "cmdorctrl") {
      if (mac) meta = true;
      else ctrl = true;
    } else if (m === "control" || m === "ctrl") {
      ctrl = true;
    } else if (m === "command" || m === "meta" || m === "super") {
      meta = true;
    } else if (m === "shift") {
      shift = true;
    } else if (m === "alt" || m === "option") {
      alt = true;
    }
  }

  return { ctrl, meta, shift, alt, key };
}

/**
 * True when `e` is the given Tauri shortcut. `mac` defaults to the running
 * platform so CommandOrControl means Ctrl on Linux/Windows and Meta on macOS.
 */
export function eventMatchesShortcut(
  e: KeyboardEvent,
  shortcut: string,
  opts: { mac?: boolean } = {}
): boolean {
  const wanted = parseShortcut(shortcut, opts.mac ?? isMac);
  if (!wanted) return false;

  if (e.ctrlKey !== wanted.ctrl) return false;
  if (e.metaKey !== wanted.meta) return false;
  if (e.shiftKey !== wanted.shift) return false;
  if (e.altKey !== wanted.alt) return false;

  const pressed = keyNameFromEvent(e);
  if (!pressed) return false;
  return pressed.toUpperCase() === wanted.key.toUpperCase();
}
