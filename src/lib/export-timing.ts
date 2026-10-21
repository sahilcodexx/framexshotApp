import type { ExportPrefs } from "./export-settings";

const TIMING_KEY = "framexshot-export-timing-v1";
// Initial estimates only; completed exports calibrate these rates on this machine.
const INITIAL_SECONDS_PER_MP = { png: 0.2, jpeg: 0.1, webp: 0.3, avif: 0.8 };

function qualityFactor(prefs: ExportPrefs) {
  return prefs.format === "png" ? 1 : 0.5 + prefs.quality / 100;
}

function loadRates(): Record<string, number> {
  try {
    const rates: unknown = JSON.parse(window.localStorage.getItem(TIMING_KEY) || "{}");
    return rates && typeof rates === "object" && !Array.isArray(rates) ? rates as Record<string, number> : {};
  } catch { return {}; }
}

export function estimateExportSeconds(width: number, height: number, prefs: ExportPrefs): number {
  const rate = loadRates()[prefs.format];
  const secondsPerMp = typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate : INITIAL_SECONDS_PER_MP[prefs.format];
  return Math.max(3, Math.ceil(2 + width * height * prefs.scale ** 2 / 1_000_000 * secondsPerMp * qualityFactor(prefs)));
}

export function recordExportTiming(width: number, height: number, prefs: ExportPrefs, seconds: number) {
  const work = width * height * prefs.scale ** 2 / 1_000_000 * qualityFactor(prefs);
  if (!Number.isFinite(work) || work <= 0 || !Number.isFinite(seconds) || seconds <= 0) return;
  const rates = loadRates();
  const rate = Math.max(0.01, seconds - 2) / work;
  const previous = rates[prefs.format];
  rates[prefs.format] = typeof previous === "number" && Number.isFinite(previous) && previous > 0
    ? previous * 0.5 + rate * 0.5 : rate;
  try { window.localStorage.setItem(TIMING_KEY, JSON.stringify(rates)); } catch { /* Export still succeeds when storage is unavailable. */ }
}

export function formatExportTime(seconds: number): string {
  seconds = Math.max(1, Math.ceil(seconds));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
