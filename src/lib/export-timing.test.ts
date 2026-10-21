import { afterEach, expect, it } from "vitest";
import { DEFAULT_EXPORT_PREFS } from "./export-settings";
import { estimateExportSeconds, formatExportTime, recordExportTiming } from "./export-timing";

afterEach(() => window.localStorage.clear());

it.each(["png", "jpeg", "webp", "avif"] as const)("estimates %s from output pixel count and learns this machine's timing", (format) => {
  const prefs = { ...DEFAULT_EXPORT_PREFS, format };
  const original = estimateExportSeconds(2000, 1000, prefs);
  expect(estimateExportSeconds(2000, 1000, { ...prefs, scale: 3 })).toBeGreaterThan(original);
  recordExportTiming(2000, 1000, { ...prefs, scale: 3 }, 20);
  expect(estimateExportSeconds(2000, 1000, { ...prefs, scale: 3 })).toBe(20);
});

it("ignores corrupt timing data and invalid measurements", () => {
  window.localStorage.setItem("framexshot-export-timing-v1", "broken");
  const baseline = estimateExportSeconds(2000, 1000, DEFAULT_EXPORT_PREFS);
  recordExportTiming(0, 0, DEFAULT_EXPORT_PREFS, 10);
  recordExportTiming(100, 100, DEFAULT_EXPORT_PREFS, NaN);
  expect(estimateExportSeconds(2000, 1000, DEFAULT_EXPORT_PREFS)).toBe(baseline);
});

it("formats a countdown without showing zero before work is done", () => {
  expect(formatExportTime(0.4)).toBe("1s");
  expect(formatExportTime(75)).toBe("1m 15s");
});
