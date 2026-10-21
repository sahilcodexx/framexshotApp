import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { editorActions, useEditorStore } from "@/stores/editorStore";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("drags the screenshot in frame coordinates and undoes the move", () => {
  editorActions.reset();
  let paint: FrameRequestCallback | undefined;
  const schedule = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { paint = callback; return 1; });
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
    save: vi.fn(), restore: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 440, bottom: 340, width: 440, height: 340, toJSON: () => ({}),
  });
  const preview = document.createElement("canvas");
  preview.width = 440;
  preview.height = 340;
  const { container } = render(<AnnotationCanvas
    annotations={[]} selectedAnnotation={null} selectedTool="select"
    previewCanvasRef={{ current: preview }} previewRevision={1}
    previewLayersRef={{ current: { background: preview, foreground: preview, x: 0, y: 0, scale: 1 } }}
    frameSize={{ width: 440, height: 340 }}
    imageContentRect={{ x: 20, y: 20, width: 400, height: 300 }}
    onAnnotationAdd={vi.fn()} onAnnotationUpdate={vi.fn()} onAnnotationSelect={vi.fn()}
  />);
  const canvas = container.querySelector("canvas")!;
  const updates = vi.fn();
  const unsubscribe = useEditorStore.subscribe(updates);
  fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(canvas, { clientX: 130, clientY: 120 });
  fireEvent.mouseMove(canvas, { clientX: 140, clientY: 130 });
  expect(schedule).toHaveBeenCalledTimes(1);
  paint?.(0);
  expect(updates).not.toHaveBeenCalled();
  // Pointer movement paints locally; only release writes editor state.
  expect(useEditorStore.getState().settings).toMatchObject({ imageOffsetX: 0, imageOffsetY: 0 });
  fireEvent.mouseUp(canvas);
  expect(useEditorStore.getState().settings).toMatchObject({ imageOffsetX: 40, imageOffsetY: 30 });
  expect(useEditorStore.getState().past).toHaveLength(1);
  unsubscribe();
  expect(useEditorStore.getState()._isDragging).toBe(false);
  editorActions.undo();
  expect(useEditorStore.getState().settings).toMatchObject({ imageOffsetX: 0, imageOffsetY: 0 });
});
