import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreviewGenerator } from "./usePreviewGenerator";
import { editorActions, useEditorStore } from "@/stores/editorStore";

vi.mock("@/lib/asset-registry", () => ({
  resolveBackgroundPath: () => null,
  getAssetPath: () => null,
}));
vi.mock("@/components/editor/BackgroundSelector", () => ({
  gradientOptions: [{ id: "test-gradient", src: "", colors: ["#000000", "#ffffff"] }],
}));

beforeEach(() => {
  vi.useFakeTimers();
  editorActions.reset();
  useEditorStore.setState({ _isDragging: false });
  const context = {
    beginPath: vi.fn(), roundRect: vi.fn(), closePath: vi.fn(), clip: vi.fn(),
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,preview");
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ _isDragging: false });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("updates the canvas during padding drag without encoding and encodes again on release", async () => {
  const screenshot = new Image();
  screenshot.width = 400;
  screenshot.height = 300;
  const canvasRef = { current: document.createElement("canvas") };
  const settings = { ...useEditorStore.getState().settings, paddingTop: 20, paddingBottom: 20, paddingLeft: 20, paddingRight: 20, windowFrame: "none" as const, blurAmount: 0, noiseAmount: 0 };
  const { result, rerender } = renderHook(({ padding }) => usePreviewGenerator({
    screenshotImage: screenshot,
    canvasRef,
    settings: { ...settings, paddingTop: padding, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 },
    paddingTop: padding, paddingBottom: 20, paddingLeft: 20, paddingRight: 20,
  }), { initialProps: { padding: 20 } });

  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  const revision = result.current.previewRevision;
  const encodedFrames = vi.mocked(canvasRef.current.toDataURL).mock.calls.length;
  expect(revision).toBeGreaterThan(0);
  expect(canvasRef.current.height).toBe(340);

  act(() => { useEditorStore.setState({ _isDragging: true }); });
  rerender({ padding: 80 });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.previewRevision).toBeGreaterThan(revision);
  expect(canvasRef.current.height).toBe(400);
  expect(canvasRef.current.toDataURL).toHaveBeenCalledTimes(encodedFrames);

  await act(async () => { useEditorStore.setState({ _isDragging: false }); });
  expect(canvasRef.current.toDataURL).toHaveBeenCalledTimes(encodedFrames + 1);
  expect(result.current.error).toBeNull();
  const exported = await result.current.renderHighQualityCanvas([]);
  expect(exported?.width).toBe(440);
  expect(exported?.height).toBe(400);
});

it("clears the previous frame when equal-sized transparent previews replace it", async () => {
  const screenshot = new Image();
  screenshot.width = 400;
  screenshot.height = 300;
  const canvasRef = { current: document.createElement("canvas") };
  const settings = { ...useEditorStore.getState().settings, paddingTop: 20, paddingBottom: 20, paddingLeft: 20, paddingRight: 20, windowFrame: "none" as const, blurAmount: 0, noiseAmount: 0 };
  const { rerender } = renderHook(({ transparent }) => usePreviewGenerator({
    screenshotImage: screenshot, canvasRef,
    settings: { ...settings, backgroundType: transparent ? "transparent" : "white" },
    paddingTop: 20, paddingBottom: 20, paddingLeft: 20, paddingRight: 20,
  }), { initialProps: { transparent: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  const ctx = canvasRef.current.getContext("2d")!;
  vi.mocked(ctx.clearRect).mockClear();
  rerender({ transparent: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 440, 340);
});

it("keeps frame dimensions fixed when zooming and reuses the background during pan", async () => {
  const { renderFullCanvas, getFrameDimensions, getImageContentRect } = await import("./usePreviewGenerator");
  const screenshot = new Image();
  screenshot.width = 400;
  screenshot.height = 300;
  const settings = { ...useEditorStore.getState().settings, backgroundType: "white" as const, windowFrame: "none" as const, blurAmount: 0, noiseAmount: 0 };
  const padding = { top: 20, bottom: 20, left: 20, right: 20 };
  const zoomed = { ...settings, imageScale: 0.5, imageOffsetX: 12, imageOffsetY: -8 };
  expect(getFrameDimensions(screenshot, zoomed, padding)).toEqual({ width: 440, height: 340 });
  expect(getImageContentRect(screenshot, zoomed, padding)).toMatchObject({ x: 132, y: 87, width: 200, height: 150 });
  const first = renderFullCanvas(screenshot, zoomed, padding, null);
  const ctx = first.getContext("2d")!;
  vi.mocked(ctx.fillRect).mockClear();
  const moved = renderFullCanvas(screenshot, { ...zoomed, imageOffsetX: 80 }, padding, null);
  expect(moved.width).toBe(440);
  expect(moved.height).toBe(340);
  expect(ctx.fillRect).not.toHaveBeenCalled();
  const exported = renderFullCanvas(screenshot, zoomed, padding, null, { outputScale: 4 });
  expect([exported.width, exported.height]).toEqual([1760, 1360]);
});
