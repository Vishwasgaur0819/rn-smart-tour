import React, { useRef, useEffect, ReactElement, useContext, useCallback } from 'react';
import { View, ViewProps, LayoutChangeEvent, Dimensions } from 'react-native';
import { DapContext } from './DapContext';
import { TargetMeasurement } from './types';

/**
 * Multi-pass measurement delays (ms).
 * The first pass captures an early estimate; subsequent passes self-correct
 * after screen-transition animations and async layout shifts have settled.
 */
const MEASUREMENT_DELAYS = [100, 500, 1000];

/** Threshold in points — ignore sub-pixel drift to avoid unnecessary re-registers. */
const POSITION_THRESHOLD = 1;

interface DapTargetProps extends ViewProps {
  name: string;
  children: ReactElement;
}

export const DapTarget: React.FC<DapTargetProps> = ({ name, children, ...props }) => {
  const viewRef = useRef<View>(null);
  const context = useContext(DapContext);

  /** Holds all scheduled timer IDs so we can cancel them on re-layout or unmount. */
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** Last successfully registered measurement — used for deduplication. */
  const lastMeasurementRef = useRef<TargetMeasurement | null>(null);

  /** Clear every pending measurement timer. */
  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  /** Returns true if the new measurement differs meaningfully from the previous one. */
  const hasPositionChanged = useCallback(
    (prev: TargetMeasurement | null, next: TargetMeasurement): boolean => {
      if (!prev) return true; // First measurement — always register.
      return (
        Math.abs(prev.x - next.x) > POSITION_THRESHOLD ||
        Math.abs(prev.y - next.y) > POSITION_THRESHOLD ||
        Math.abs(prev.width - next.width) > POSITION_THRESHOLD ||
        Math.abs(prev.height - next.height) > POSITION_THRESHOLD
      );
    },
    [],
  );

  /**
   * Schedule measureInWindow calls at each delay.
   * Every invocation first cancels any previously scheduled timers so that
   * rapid-fire onLayout events don't pile up stale measurements.
   */
  const measureAndRegister = useCallback(() => {
    clearAllTimers();

    if (!viewRef.current || !context) return;

    const scheduleAtDelay = (delay: number) => {
      const id = setTimeout(() => {
        if (!viewRef.current) return;

        viewRef.current.measureInWindow((x, y, width, height) => {
          if (width <= 0 || height <= 0) return;

          const next: TargetMeasurement = { x, y, width, height };

          if (hasPositionChanged(lastMeasurementRef.current, next)) {
            lastMeasurementRef.current = next;
            context.registerTarget(name, next);
          }
        });
      }, delay);

      timersRef.current.push(id);
    };

    MEASUREMENT_DELAYS.forEach(scheduleAtDelay);
  }, [name, context, clearAllTimers, hasPositionChanged]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      measureAndRegister();
      props.onLayout?.(e);
    },
    [measureAndRegister, props.onLayout],
  );

  const unregisterTarget = context?.unregisterTarget;

  // Re-measure when the screen dimensions change (rotation, split-screen, foldables).
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', () => {
      // Reset the last measurement so the next pass always registers.
      lastMeasurementRef.current = null;
      measureAndRegister();
    });

    return () => {
      subscription.remove();
    };
  }, [measureAndRegister]);

  // Cleanup on unmount or when name changes.
  useEffect(() => {
    return () => {
      clearAllTimers();
      unregisterTarget?.(name);
    };
  }, [name, unregisterTarget, clearAllTimers]);

  // collapsable={false} is vital for Android, otherwise it gets optimized away and measure fails
  return (
    <View ref={viewRef} onLayout={handleLayout} collapsable={false} {...props}>
      {children}
    </View>
  );
};
