import type { TargetMeasurement as Rect, TourStep } from '../types';

/** Gap (pts) between the target highlight and the tooltip card. */
const TOOLTIP_GAP = 10;
/** Minimum distance between the card and the screen edges. */
const EDGE_PADDING = 16;
/** Narrowest card worth showing beside a target for 'left' / 'right'; otherwise it goes above/below. */
const MIN_SIDE_WIDTH = 160;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export interface TooltipPlacement {
  left: number;
  top: number;
  width: number;
}

/**
 * Where to put the tooltip card. Uses the card's measured height, prefers the
 * step's `position`, and flips to the other side when it doesn't fit.
 */
export function placeTooltip({
  rect,
  cardHeight,
  screenWidth,
  screenHeight,
  position = 'bottom',
  width,
}: {
  rect: Rect;
  cardHeight: number;
  screenWidth: number;
  screenHeight: number;
  position?: TourStep['position'];
  width: number;
}): TooltipPlacement {
  const cardWidth = Math.min(width, screenWidth - EDGE_PADDING * 2);
  const centeredTop = clamp(
    rect.y + rect.height / 2 - cardHeight / 2,
    EDGE_PADDING,
    screenHeight - EDGE_PADDING - cardHeight,
  );

  if (position === 'left' || position === 'right') {
    const room =
      position === 'left'
        ? rect.x - TOOLTIP_GAP - EDGE_PADDING
        : screenWidth - (rect.x + rect.width) - TOOLTIP_GAP - EDGE_PADDING;
    if (room >= Math.min(cardWidth, MIN_SIDE_WIDTH)) {
      const sideWidth = Math.min(cardWidth, room);
      return {
        left: position === 'left' ? rect.x - TOOLTIP_GAP - sideWidth : rect.x + rect.width + TOOLTIP_GAP,
        top: centeredTop,
        width: sideWidth,
      };
    }
    // Not enough room beside the target: fall through to below/above.
  }

  const below = rect.y + rect.height + TOOLTIP_GAP;
  const above = rect.y - TOOLTIP_GAP - cardHeight;
  const fitsBelow = below + cardHeight <= screenHeight - EDGE_PADDING;
  const fitsAbove = above >= EDGE_PADDING;

  let top: number;
  if (position === 'top') {
    top = fitsAbove ? above : fitsBelow ? below : NaN;
  } else {
    top = fitsBelow ? below : fitsAbove ? above : NaN;
  }
  if (Number.isNaN(top)) {
    // Fits neither way (e.g. a very tall target): use the roomier side, kept on screen.
    const roomBelow = screenHeight - (rect.y + rect.height);
    top = clamp(roomBelow >= rect.y ? below : above, EDGE_PADDING, screenHeight - EDGE_PADDING - cardHeight);
  }

  return {
    left: clamp(
      rect.x + rect.width / 2 - cardWidth / 2,
      EDGE_PADDING,
      screenWidth - cardWidth - EDGE_PADDING,
    ),
    top,
    width: cardWidth,
  };
}
