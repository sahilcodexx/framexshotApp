import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RightSidebar } from "./RightSidebar";
import { editorActions, useEditorStore } from "@/stores/editorStore";
import type { RangeSliderDebouncedProps } from "@/components/motion/range-slider-debounced";

vi.mock("@/components/motion/range-slider-debounced", () => ({
  RangeSliderDebounced: (props: RangeSliderDebouncedProps) => (
    <div>
      <span data-testid="zoom-value">{props.value}</span>
      <button onClick={() => props.onValueChangeTransient?.(50)}>Drag to 50%</button>
      <button onClick={() => props.onValueCommit?.(50)}>Commit 50%</button>
    </div>
  ),
}));

afterEach(cleanup);

it("changes image zoom without changing canvas padding", () => {
  editorActions.reset();
  const props = {
    settings: useEditorStore.getState().settings,
    actions: editorActions,
    previewUrl: null,
    selectedAnnotation: null,
    onAnnotationUpdate: vi.fn(),
  };
  const { rerender } = render(<RightSidebar {...props} />);
  expect(screen.getByTestId("zoom-value")).toHaveTextContent("100");

  fireEvent.click(screen.getByText("Drag to 50%"));
  const liveSettings = useEditorStore.getState().settings;
  expect(liveSettings.imageScale).toBe(0.5);
  expect(liveSettings.paddingTop).toBe(props.settings.paddingTop);
  rerender(<RightSidebar {...props} settings={liveSettings} />);
  expect(screen.getByTestId("zoom-value")).toHaveTextContent("50");

  fireEvent.click(screen.getByText("Commit 50%"));
  expect(useEditorStore.getState().settings).toEqual(liveSettings);
});
