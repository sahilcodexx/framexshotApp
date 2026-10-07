import { describe, expect, it } from "vitest";
import {
  eventMatchesShortcut,
  isTypingTarget,
  keyNameFromEvent,
  keyboardEventToShortcut,
} from "./shortcut";

function evt(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("keyNameFromEvent", () => {
  it("uses event.code for shifted digit keys", () => {
    // US layout: Shift+2 produces "@", but the binding is "+2".
    const e = evt({ key: "@", code: "Digit2", shiftKey: true, ctrlKey: true });
    expect(keyNameFromEvent(e)).toBe("2");
  });

  it("maps letter codes to A–Z", () => {
    expect(keyNameFromEvent(evt({ key: "f", code: "KeyF" }))).toBe("F");
  });

  it("maps F-keys from code", () => {
    expect(keyNameFromEvent(evt({ key: "F12", code: "F12" }))).toBe("F12");
  });
});

describe("keyboardEventToShortcut", () => {
  it("records Ctrl+Shift+2 as CommandOrControl+Shift+2, not +@", () => {
    const e = evt({
      key: "@",
      code: "Digit2",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(keyboardEventToShortcut(e)).toBe("CommandOrControl+Shift+2");
  });

  it("returns null for modifier-only presses", () => {
    expect(keyboardEventToShortcut(evt({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
  });
});

describe("eventMatchesShortcut", () => {
  const region = "CommandOrControl+Shift+2";

  it("matches Ctrl+Shift+2 on Linux/Windows even when key is @", () => {
    const e = evt({
      key: "@",
      code: "Digit2",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, region, { mac: false })).toBe(true);
  });

  it("matches the Ctrl fallback spelling", () => {
    const e = evt({
      key: "2",
      code: "Digit2",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, "Ctrl+Shift+2", { mac: false })).toBe(true);
  });

  it("does not match without Control", () => {
    const e = evt({
      key: "@",
      code: "Digit2",
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, region, { mac: false })).toBe(false);
  });

  it("does not match a different digit", () => {
    const e = evt({
      key: "#",
      code: "Digit3",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, region, { mac: false })).toBe(false);
  });

  it("matches Command+Shift+2 on macOS", () => {
    const e = evt({
      key: "@",
      code: "Digit2",
      metaKey: true,
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, region, { mac: true })).toBe(true);
  });

  it("matches letter shortcuts via KeyF", () => {
    const e = evt({
      key: "F",
      code: "KeyF",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(eventMatchesShortcut(e, "CommandOrControl+Shift+F", { mac: false })).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it("is true for input and textarea", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
  });

  it("is false for buttons and the document body", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });
});
