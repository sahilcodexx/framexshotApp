import { describe, it, expect } from "vitest";
import {
  buildFilenameFromTemplate,
  buildExportFilename,
  DEFAULT_FILENAME_TEMPLATE,
  mimeForFormat,
} from "./export-settings";

describe("buildFilenameFromTemplate", () => {
  const now = new Date(2026, 9, 1, 14, 30, 5); // Oct 1 2026, 14:30:05 local

  it("resolves %date and %time tokens", () => {
    expect(buildFilenameFromTemplate("%date_%time", now)).toBe("2026-10-01_14-30-05");
  });

  it("replaces repeated tokens", () => {
    expect(buildFilenameFromTemplate("%date/%date", now)).toBe("2026-10-01 2026-10-01");
  });

  it("leaves plain text untouched", () => {
    expect(buildFilenameFromTemplate("my shot", now)).toBe("my shot");
  });

  it("strips filesystem-forbidden characters", () => {
    expect(buildFilenameFromTemplate('a/b\\c:d*e?f"g<h>i|j', now)).toBe("a b c d e f g h i j");
  });

  it("collapses whitespace and trims dots", () => {
    expect(buildFilenameFromTemplate("  spaced   out  ", now)).toBe("spaced out");
    // Dots-only names are wiped, then the framexshot fallback applies.
    expect(buildFilenameFromTemplate("...", now)).toBe("framexshot");
  });

  it("falls back to 'framexshot' when nothing usable remains", () => {
    expect(buildFilenameFromTemplate("/\\:*?\"<>|", now)).toBe("framexshot");
  });

  it("caps length at 120 characters", () => {
    expect(buildFilenameFromTemplate("x".repeat(500), now)).toHaveLength(120);
  });
});

describe("buildExportFilename", () => {
  it("is undefined for the default template (Rust default naming stays)", async () => {
    // Store plugin without Tauri backend rejects Store.load — prefs fall back
    // to defaults, whose template is the default one.
    await expect(buildExportFilename()).resolves.toBeUndefined();
  });
});

describe("mimeForFormat", () => {
  it("maps formats to mimes", () => {
    expect(mimeForFormat("png")).toBe("image/png");
    expect(mimeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeForFormat("webp")).toBe("image/webp");
  });
});

describe("DEFAULT_FILENAME_TEMPLATE", () => {
  it("contains only known tokens", () => {
    expect(DEFAULT_FILENAME_TEMPLATE).toMatch(/^(%date|%time|[^%])*$/);
  });
});
