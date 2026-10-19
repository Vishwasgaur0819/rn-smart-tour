import React, { useCallback, useContext, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent, ViewProps } from 'react-native';
import { PRESS_SLOP } from '../core/TourEngine';
import { TourEngineContext, TourScopeContext, TourScrollableContext } from './context';

export interface TourTargetProps extends ViewProps {
  /** Matches `targetId` in a tour step. */
  name: string;
  children?: React.ReactNode;
}

/**
 * Marks an element a tour step can point at. It only registers a ref: nothing is
 * measured, and nothing re-renders, until a step that targets it becomes current.
 */
export const TourTarget: React.FC<TourTargetProps> = ({
  name,
  children,
  onLayout,
  onTouchStart,
  onTouchEnd,
  ...props
}) => {
  const engine = useContext(TourEngineContext);
  const scope = useContext(TourScopeContext);
  const scrollable = useContext(TourScrollableContext);
  const viewRef = useRef<View>(null);

  useEffect(() => {
    if (!engine) return;
    return engine.registerTarget(name, { ref: viewRef, scope, scrollable });
  }, [engine, name, scope, scrollable]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      engine?.notifyTargetLayout(name);
      onLayout?.(e);
    },
    [engine, name, onLayout],
  );

  // Taps on the element (for steps with advanceOn: 'press'). Touch events reach this
  // view even though a child button handles the press; a touch that moved (a scroll
  // or drag) isn't a tap.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      onTouchStart?.(e);
    },
    [onTouchStart],
  );
  const handleTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (
        start &&
        Math.abs(e.nativeEvent.pageX - start.x) < PRESS_SLOP &&
        Math.abs(e.nativeEvent.pageY - start.y) < PRESS_SLOP
      ) {
        engine?.notifyTargetPress(name);
      }
      onTouchEnd?.(e);
    },
    [engine, name, onTouchEnd],
  );

  // Spread props first so a caller's collapsable cannot replace ours
  // (collapsable={false} keeps a real native view to measure on Android).
  return (
    <View
      {...props}
      ref={viewRef}
      onLayout={handleLayout}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      collapsable={false}>
      {children}
    </View>
  );
};
