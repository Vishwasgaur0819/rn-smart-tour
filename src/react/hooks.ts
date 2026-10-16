import { useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { shallowEqual } from '../core/store';
import type { TourEngine, TourEngineState } from '../core/TourEngine';
import type { TourApi, TourStatus } from '../types';
import { TourEngineContext } from './context';

export function useTourEngine(): TourEngine {
  const engine = useContext(TourEngineContext);
  if (!engine) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return engine;
}

/**
 * Subscribes to a slice of the tour state. The component re-renders only when
 * the selected value changes (compared with `isEqual`, shallow by default).
 */
export function useTourState<T>(
  selector: (state: TourEngineState) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const engine = useTourEngine();
  const cache = useRef<{ state: TourEngineState; selector: typeof selector; value: T } | null>(null);

  const getSnapshot = () => {
    const state = engine.getState();
    const cached = cache.current;
    if (cached && cached.state === state && cached.selector === selector) return cached.value;
    const value = selector(state);
    // Keep the previous value when equal, so React sees a stable snapshot.
    const next = cached && isEqual(cached.value, value) ? cached.value : value;
    cache.current = { state, selector, value: next };
    return next;
  };

  return useSyncExternalStore(engine.subscribe, getSnapshot, getSnapshot);
}

export const getStatus = (state: TourEngineState): TourStatus => {
  if (!state.tourId) return 'idle';
  const { presented } = state;
  return presented && presented.tourId === state.tourId && presented.stepIndex === state.stepIndex
    ? 'active'
    : 'waiting';
};

const selectTourSummary = (state: TourEngineState) => ({
  tourId: state.tourId,
  stepIndex: state.stepIndex,
  seen: state.seen,
  status: getStatus(state),
});

/** Tour actions and the running tour. Re-renders only when those change, not on measurements. */
export function useTour(): TourApi {
  const engine = useTourEngine();
  const { tourId, stepIndex, seen, status } = useTourState(selectTourSummary);

  return useMemo(
    () => ({
      startTour: engine.startTour,
      stopTour: engine.stopTour,
      nextStep: engine.nextStep,
      prevStep: engine.prevStep,
      resetTour: engine.resetTour,
      resetAll: engine.resetAll,
      status,
      activeTour: tourId ? engine.getTour(tourId) : null,
      currentStepIndex: stepIndex,
      seenTours: seen,
    }),
    [engine, tourId, stepIndex, seen, status],
  );
}
