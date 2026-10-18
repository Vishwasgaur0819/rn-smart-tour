import React, { useCallback, useContext, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, ViewProps } from 'react-native';
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
export const TourTarget: React.FC<TourTargetProps> = ({ name, children, onLayout, ...props }) => {
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

  // Spread props first so a caller's collapsable cannot replace ours
  // (collapsable={false} keeps a real native view to measure on Android).
  return (
    <View {...props} ref={viewRef} onLayout={handleLayout} collapsable={false}>
      {children}
    </View>
  );
};
