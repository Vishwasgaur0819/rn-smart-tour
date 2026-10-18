import { findNodeHandle } from 'react-native';
import type { TargetMeasurement as Rect } from '../types';

/** A native call that never answers (e.g. the view unmounted) resolves to null after this. */
const MEASURE_TIMEOUT_MS = 500;

/** Threshold in points — ignore sub-pixel drift. */
const POSITION_THRESHOLD = 1;

export const isSameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) <= POSITION_THRESHOLD &&
  Math.abs(a.y - b.y) <= POSITION_THRESHOLD &&
  Math.abs(a.width - b.width) <= POSITION_THRESHOLD &&
  Math.abs(a.height - b.height) <= POSITION_THRESHOLD;

export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function withTimeout<T>(run: (resolve: (value: T | null) => void) => void): Promise<T | null> {
  return new Promise(resolve => {
    let settled = false;
    const done = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), MEASURE_TIMEOUT_MS);
    try {
      run(done);
    } catch {
      done(null);
    }
  });
}

/** Window-relative rect of a host view, or null if it is not measurable or has no size. */
export function measureInWindow(ref: any): Promise<Rect | null> {
  if (typeof ref?.measureInWindow !== 'function') return Promise.resolve(null);
  return withTimeout<Rect>(done =>
    ref.measureInWindow((x: number, y: number, width: number, height: number) =>
      done(width > 0 && height > 0 ? { x, y, width, height } : null),
    ),
  );
}

/** Rect of `ref` relative to `relativeTo` (a native ref, or a node handle on older React Native). */
export function measureLayout(ref: any, relativeTo: any): Promise<Rect | null> {
  if (typeof ref?.measureLayout !== 'function' || relativeTo == null) return Promise.resolve(null);
  return withTimeout<Rect>(done =>
    ref.measureLayout(
      relativeTo,
      (x: number, y: number, width: number, height: number) => done({ x, y, width, height }),
      () => done(null),
    ),
  );
}

/**
 * Measures every frame until the rect stops changing for `frames` frames in a row
 * (or `maxMs` passes), so a target that is still moving is not shown mid-way.
 */
export async function measureStable(
  ref: any,
  { frames = 3, maxMs = 600, isCancelled }: { frames?: number; maxMs?: number; isCancelled: () => boolean },
): Promise<Rect | null> {
  const start = Date.now();
  let last = await measureInWindow(ref);
  let stableFrames = 0;

  while (stableFrames < frames && Date.now() - start < maxMs) {
    await nextFrame();
    if (isCancelled()) return null;
    const next = await measureInWindow(ref);
    stableFrames = last && next && isSameRect(last, next) ? stableFrames + 1 : 0;
    last = next;
  }
  return last;
}

/**
 * The ScrollView behind a scroll container ref. FlatList / SectionList expose it
 * through getNativeScrollRef / getScrollResponder; a ScrollView is used as-is.
 */
function resolveScrollView(ref: any): any {
  if (!ref) return null;
  if (typeof ref.scrollTo === 'function') return ref;
  const inner = ref.getNativeScrollRef?.() ?? ref.getScrollResponder?.();
  return typeof inner?.scrollTo === 'function' ? inner : null;
}

/**
 * Scrolls `target` into the middle of the scroll container if it is not fully
 * visible. Returns true if a scroll was started.
 */
export async function scrollIntoView(
  target: any,
  scrollRef: any,
  { horizontal = false, padding = 16 }: { horizontal?: boolean; padding?: number } = {},
): Promise<boolean> {
  const scrollView = resolveScrollView(scrollRef);
  if (!scrollView) return false;

  const [viewport, rect] = await Promise.all([
    measureInWindow(scrollView.getNativeScrollRef?.() ?? scrollView),
    measureInWindow(target),
  ]);
  if (!viewport || !rect) return false;

  const start = horizontal ? rect.x - viewport.x : rect.y - viewport.y;
  const size = horizontal ? rect.width : rect.height;
  const viewportSize = horizontal ? viewport.width : viewport.height;
  if (start >= padding && start + size <= viewportSize - padding) return false;

  // Content-relative position: measure against the content container. The New
  // Architecture requires a native ref here; a node handle is the fallback for
  // React Native versions without getInnerViewRef.
  const content = await measureLayout(target, scrollView.getInnerViewRef?.() ?? findNodeHandle(scrollView));
  if (!content) return false;

  const contentStart = horizontal ? content.x : content.y;
  const offset = Math.max(
    0,
    size > viewportSize - padding * 2 ? contentStart - padding : contentStart - (viewportSize - size) / 2,
  );
  scrollView.scrollTo(horizontal ? { x: offset, animated: true } : { y: offset, animated: true });
  return true;
}
