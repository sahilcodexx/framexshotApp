/** Background padding slider is 0–100 mapped onto this pixel range. */
export const PADDING_SLIDER_MAX_PX = 400;

export function paddingPxToPercent(px: number): number {
  return Math.round((px / PADDING_SLIDER_MAX_PX) * 100);
}

export function paddingPercentToPx(percent: number): number {
  return Math.round((percent / 100) * PADDING_SLIDER_MAX_PX);
}
