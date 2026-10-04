import { describe, it, expect } from "vitest";
import {
  PADDING_SLIDER_MAX_PX,
  paddingPercentToPx,
  paddingPxToPercent,
} from "./padding-slider";

describe("padding slider units", () => {
  it("maps 0% to 0px and 100% to the max pixel range", () => {
    expect(paddingPercentToPx(0)).toBe(0);
    expect(paddingPercentToPx(100)).toBe(PADDING_SLIDER_MAX_PX);
    expect(paddingPxToPercent(0)).toBe(0);
    expect(paddingPxToPercent(PADDING_SLIDER_MAX_PX)).toBe(100);
  });

  it("round-trips whole percents without a drag/commit jump", () => {
    for (let percent = 0; percent <= 100; percent++) {
      expect(paddingPxToPercent(paddingPercentToPx(percent))).toBe(percent);
    }
  });

  it("converts the default 100px padding to 25%", () => {
    expect(paddingPxToPercent(100)).toBe(25);
    expect(paddingPercentToPx(25)).toBe(100);
  });
});
