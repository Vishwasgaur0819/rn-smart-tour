import { useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { shallowEqual } from '../core/store';
import type { TourEngine, TourEngineState } from '../core/TourEngine';
import type { TourApi, TourCatalogEntry, TourStatus } from '../types';
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
  if (state.paused) return 'paused';
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

const selectToursRevision = (state: TourEngineState) => state.toursRevision;

const normalize = (text: string) => text.toLowerCase();

/**
 * Tours for a help list ("How do I…?"), optionally of one `kind` and matching a
 * search `query` (every word must appear in the title, description or keywords).
 * Tours without a `title` are left out.
 */
export function useTourCatalog({
  kind,
  query = '',
}: { kind?: 'tour' | 'walkthrough'; query?: string } = {}): TourCatalogEntry[] {
  const engine = useTourEngine();
  const revision = useTourState(selectToursRevision);

  return useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return engine
      .getTours()
      .filter(tour => tour.title && (!kind || (tour.kind ?? 'tour') === kind))
      .filter(tour => {
        const haystack = normalize(
          [tour.title, tour.description, ...(tour.keywords ?? [])].filter(Boolean).join(' '),
        );
        return words.every(word => haystack.includes(word));
      })
      .map(tour => ({
        id: tour.id,
        title: tour.title as string,
        description: tour.description,
        kind: tour.kind ?? 'tour',
      }));
    // `revision` changes when the tours do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, kind, query, revision]);
}

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
      emit: engine.emit,
      pauseTour: engine.pauseTour,
      resumeTour: engine.resumeTour,
      status,
      activeTour: tourId ? engine.getTour(tourId) : null,
      currentStepIndex: stepIndex,
      seenTours: seen,
    }),
    [engine, tourId, stepIndex, seen, status],
  );
}
