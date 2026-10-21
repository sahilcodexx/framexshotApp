import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";
import { DEFAULT_EXPORT_PREFS } from "@/lib/export-settings";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("chooses size and format with custom menus and exports the selection", async () => {
  const onExport = vi.fn();
  function Editor() {
    const [prefs, setPrefs] = useState(DEFAULT_EXPORT_PREFS);
    return <ExportDialog open onOpenChange={vi.fn()} prefs={prefs} onPrefsChange={setPrefs}
      frameSize={{ width: 1200, height: 800 }} previewUrl={null} isSaving={false}
      onExport={() => onExport(prefs)} />;
  }
  render(<Editor />);
  expect(document.querySelector("select")).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Export size" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /3×/ }));
  expect(screen.getByText("3,600 × 2,400 px")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "Export format" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /AVIF/ }));
  fireEvent.change(screen.getByRole("slider", { name: "Export quality" }), { target: { value: "75" } });
  fireEvent.click(screen.getByRole("button", { name: "Export AVIF" }));
  expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ scale: 3, format: "avif", quality: 75 }));
});

it("counts down estimated time, refines the estimate and prevents duplicate exports", () => {
  vi.useFakeTimers();
  const props = { open: true, onOpenChange: vi.fn(), prefs: { ...DEFAULT_EXPORT_PREFS, format: "avif" as const }, onPrefsChange: vi.fn(),
    frameSize: { width: 1200, height: 800 }, previewUrl: null, isSaving: true, onExport: vi.fn() };
  const estimate = { seconds: 30, updatedAt: Date.now() };
  const { rerender } = render(<ExportDialog {...props} estimate={estimate} stage="resizing" />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Resizing image…");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("≈ 28s left")).toBeInTheDocument();
  rerender(<ExportDialog {...props} estimate={{ seconds: 20, updatedAt: Date.now() }} stage="encoding" />);
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("≈ 18s left")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Encoding AVIF…");
  expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Export size" })).toBeDisabled();
});

it("shows export errors and blocks sizes that exceed the allocation limit", () => {
  render(<ExportDialog open onOpenChange={vi.fn()} prefs={{ ...DEFAULT_EXPORT_PREFS, scale: 4 }} onPrefsChange={vi.fn()}
    frameSize={{ width: 4144, height: 2464 }} previewUrl={null} isSaving={false} onExport={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("100 megapixels");
  expect(screen.getByRole("button", { name: "Export PNG" })).toBeDisabled();
});

it("does not show a false zero-second countdown when an estimate is exceeded", () => {
  vi.useFakeTimers();
  render(<ExportDialog open onOpenChange={vi.fn()} prefs={DEFAULT_EXPORT_PREFS} onPrefsChange={vi.fn()}
    frameSize={{ width: 1200, height: 800 }} previewUrl={null} isSaving stage="encoding"
    estimate={{ seconds: 1, updatedAt: Date.now() }} onExport={vi.fn()} />);
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("Longer than estimated")).toBeInTheDocument();
  expect(screen.getByText(/Taking longer than estimated/)).toBeInTheDocument();
});
