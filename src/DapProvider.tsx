import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { findNodeHandle } from 'react-native';
import { DapContext } from './DapContext';
import type { Tour, TargetMeasurement, StorageAdapter, StartTourOptions } from './types';
import { DapOverlay } from './DapOverlay';

export interface DapProviderProps {
  children: React.ReactNode;
  tours: Record<string, Tour>;
  storageAdapter?: StorageAdapter;
  /**
   * How long (ms) a step waits for its target to be measured before the tour
   * is ended (without marking it as seen). Prevents an invisible, stuck tour
   * when a step points at a target that is not on screen. Default: 3000.
   */
  missingTargetTimeoutMs?: number;
}

const STORAGE_KEY = '@rn-dap:seen_tours';
const AUTO_START_DEBOUNCE_MS = 300;
const DEFAULT_MISSING_TARGET_TIMEOUT_MS = 3000;

/** Re-measure delays (ms) after a step activates, without and with an auto-scroll. */
const REMEASURE_DELAYS = [50];
const REMEASURE_AFTER_SCROLL_DELAYS = [350, 700];

/** Threshold in points — ignore sub-pixel drift to avoid unnecessary re-renders. */
const POSITION_THRESHOLD = 1;

const isSameMeasurement = (a: TargetMeasurement, b: TargetMeasurement) =>
  Math.abs(a.x - b.x) <= POSITION_THRESHOLD &&
  Math.abs(a.y - b.y) <= POSITION_THRESHOLD &&
  Math.abs(a.width - b.width) <= POSITION_THRESHOLD &&
  Math.abs(a.height - b.height) <= POSITION_THRESHOLD;

export const DapProvider: React.FC<DapProviderProps> = ({
  children,
  tours,
  storageAdapter,
  missingTargetTimeoutMs = DEFAULT_MISSING_TARGET_TIMEOUT_MS,
}) => {
  const [targets, setTargets] = useState<Record<string, TargetMeasurement>>({});
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [seenTours, setSeenTours] = useState<Record<string, boolean>>({});
  const [isStorageLoaded, setIsStorageLoaded] = useState(!storageAdapter);

  /**
   * Refs mirror the latest props/state so the public callbacks can stay stable
   * and never act on a stale closure (e.g. two quick taps on "Next").
   */
  const toursRef = useRef(tours);
  toursRef.current = tours;
  const storageAdapterRef = useRef(storageAdapter);
  storageAdapterRef.current = storageAdapter;
  const seenToursRef = useRef<Record<string, boolean>>({});
  const activeTourIdRef = useRef<string | null>(null);
  const stepIndexRef = useRef(0);

  /** Work requested before storage finished loading; run in order once it has. */
  const isStorageLoadedRef = useRef(!storageAdapter);
  const pendingOpsRef = useRef<Array<() => void>>([]);

  /**
   * Tours stopped during this session. They are not auto-started again until the
   * next app launch (or a resetTour call); startTour still works for them.
   */
  const stoppedThisSessionRef = useRef<Set<string>>(new Set());

  /** Map of target IDs to their native component references (for measuring). */
  const targetRefs = useRef<Record<string, any>>({});
  /** Reference to the active ScrollView (if any) for auto-scrolling. */
  const scrollRef = useRef<any>(null);

  const whenStorageReady = useCallback((op: () => void) => {
    if (isStorageLoadedRef.current) {
      op();
    } else {
      pendingOpsRef.current.push(op);
    }
  }, []);

  // Load seen tours once on mount. The adapter is read from a ref so passing an
  // inline object does not reload storage (and overwrite state) on every render.
  useEffect(() => {
    const adapter = storageAdapterRef.current;
    if (!adapter) return;
    let cancelled = false;

    const loadStorage = async () => {
      let stored: Record<string, boolean> = {};
      try {
        const raw = await adapter.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
          stored = parsed;
        }
      } catch (e) {
        console.error('[rn-smart-tour] failed to load storage', e);
      }
      if (cancelled) return;

      seenToursRef.current = stored;
      setSeenTours(stored);
      isStorageLoadedRef.current = true;
      setIsStorageLoaded(true);

      const ops = pendingOpsRef.current;
      pendingOpsRef.current = [];
      ops.forEach(op => op());
    };
    loadStorage();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistSeenTours = useCallback((next: Record<string, boolean>) => {
    seenToursRef.current = next;
    setSeenTours(next);
    const adapter = storageAdapterRef.current;
    if (adapter) {
      Promise.resolve()
        .then(() => adapter.setItem(STORAGE_KEY, JSON.stringify(next)))
        .catch(e => {
          console.error('[rn-smart-tour] failed to save storage', e);
        });
    }
  }, []);

  const registerTarget = useCallback((id: string, measurement: TargetMeasurement, ref?: any) => {
    setTargets(prev => ({ ...prev, [id]: measurement }));
    if (ref) {
      targetRefs.current[id] = ref;
    }
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    setTargets(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete targetRefs.current[id];
  }, []);

  /** Measure a registered target again and store the result if it moved. */
  const remeasureTarget = useCallback((id: string) => {
    const ref = targetRefs.current[id];
    if (!ref?.measureInWindow) return;

    ref.measureInWindow((x: number, y: number, width: number, height: number) => {
      // Ignore results for a target that unmounted (or remounted) meanwhile.
      if (targetRefs.current[id] !== ref || width <= 0 || height <= 0) return;

      const next = { x, y, width, height };
      setTargets(prev => (prev[id] && isSameMeasurement(prev[id], next) ? prev : { ...prev, [id]: next }));
    });
  }, []);

  const _registerScrollRef = useCallback((ref: any) => {
    scrollRef.current = ref;
  }, []);

  const _unregisterScrollRef = useCallback((ref: any) => {
    if (scrollRef.current === ref) {
      scrollRef.current = null;
    }
  }, []);

  /**
   * Calculates the relative position of a target to the registered ScrollView
   * and triggers a native scrollTo call. Returns true if a scroll was requested.
   */
  const scrollToTarget = useCallback((targetId: string): boolean => {
    const target = targetRefs.current[targetId];
    const scroll = scrollRef.current;

    if (!target?.measureLayout || !scroll) return false;

    // Measure relative to the ScrollView's content container: that gives a
    // content-relative y whatever the current scroll offset. The New Architecture
    // requires a native ref here (a numeric node handle only logs a warning), so
    // findNodeHandle is just a fallback for React Native versions without getInnerViewRef.
    const relativeTo = scroll.getInnerViewRef?.() ?? findNodeHandle(scroll);

    if (!relativeTo) return false;

    try {
      target.measureLayout(
        relativeTo,
        (_x: number, y: number) => {
          // Scroll target into view with some top padding
          scroll.scrollTo({ y: Math.max(0, y - 100), animated: true });
        },
        () => {
          // Expected when the target is not inside the registered DapScrollView
          // (e.g. a header button): there is nothing to scroll, so stay silent.
        },
      );
      return true;
    } catch (e) {
      // Fallback if measureLayout isn't available on the component ref directly
      console.warn('[rn-smart-tour] measureLayout failed', e);
      return false;
    }
  }, []);

  const requestScroll = useCallback(
    (targetId: string) => {
      if (scrollToTarget(targetId)) {
        REMEASURE_AFTER_SCROLL_DELAYS.forEach(delay => setTimeout(() => remeasureTarget(targetId), delay));
      }
    },
    [scrollToTarget, remeasureTarget],
  );

  const startTour = useCallback(
    (tourId: string, options?: StartTourOptions) => {
      whenStorageReady(() => {
        const tour = toursRef.current[tourId];
        if (!tour) {
          console.warn(`[rn-smart-tour] Tour with id ${tourId} not found.`);
          return;
        }
        if (tour.steps.length === 0) {
          console.warn(`[rn-smart-tour] Tour with id ${tourId} has no steps.`);
          return;
        }
        if (seenToursRef.current[tourId] && !options?.force) return;

        activeTourIdRef.current = tourId;
        stepIndexRef.current = 0;
        setActiveTourId(tourId);
        setCurrentStepIndex(0);
      });
    },
    [whenStorageReady],
  );

  const stopTour = useCallback(
    (markAsSeen = true) => {
      const currentTourId = activeTourIdRef.current;
      if (!currentTourId) return;

      activeTourIdRef.current = null;
      stepIndexRef.current = 0;
      stoppedThisSessionRef.current.add(currentTourId);
      if (markAsSeen) {
        persistSeenTours({ ...seenToursRef.current, [currentTourId]: true });
      }
      setActiveTourId(null);
      setCurrentStepIndex(0);
    },
    [persistSeenTours],
  );

  const nextStep = useCallback(() => {
    const currentTourId = activeTourIdRef.current;
    if (!currentTourId) return;

    const tour = toursRef.current[currentTourId];
    if (!tour) {
      stopTour(false);
      return;
    }

    const index = stepIndexRef.current;
    if (index < tour.steps.length - 1) {
      stepIndexRef.current = index + 1;
      setCurrentStepIndex(index + 1);
    } else {
      // Finished the last step
      stopTour(true);
    }
  }, [stopTour]);

  const prevStep = useCallback(() => {
    const index = stepIndexRef.current;
    if (activeTourIdRef.current && index > 0) {
      stepIndexRef.current = index - 1;
      setCurrentStepIndex(index - 1);
    }
  }, []);

  const resetTour = useCallback(
    (tourId: string) => {
      whenStorageReady(() => {
        stoppedThisSessionRef.current.delete(tourId);
        if (!seenToursRef.current[tourId]) return;
        const next = { ...seenToursRef.current };
        delete next[tourId];
        persistSeenTours(next);
      });
    },
    [whenStorageReady, persistSeenTours],
  );

  const resetAll = useCallback(() => {
    whenStorageReady(() => {
      stoppedThisSessionRef.current.clear();
      persistSeenTours({});
    });
  }, [whenStorageReady, persistSeenTours]);

  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-Start Engine — debounced so multi-pass measurements can settle.
  useEffect(() => {
    if (!isStorageLoaded || activeTourId) return;
    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }
    autoStartTimerRef.current = setTimeout(() => {
      for (const tourId of Object.keys(tours)) {
        const tour = tours[tourId];
        if (
          tour.autoStart &&
          !seenTours[tourId] &&
          !stoppedThisSessionRef.current.has(tourId) &&
          tour.steps.length > 0 &&
          targets[tour.steps[0].targetId]
        ) {
          startTour(tourId);
          break; // Start only one auto-tour at a time
        }
      }
    }, AUTO_START_DEBOUNCE_MS);
    return () => {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
      }
    };
  }, [targets, tours, seenTours, isStorageLoaded, activeTourId, startTour]);

  const activeTour = activeTourId ? tours[activeTourId] ?? null : null;
  const activeStep = activeTour?.steps[currentStepIndex];
  const isActiveTargetReady = !!(activeStep && targets[activeStep.targetId]);

  // When a step activates (or its target appears): scroll it into view if needed,
  // then measure it again so the highlight matches where the target is now.
  useEffect(() => {
    if (!activeStep || !isActiveTargetReady) return;
    const id = activeStep.targetId;
    const delays = scrollToTarget(id) ? REMEASURE_AFTER_SCROLL_DELAYS : REMEASURE_DELAYS;
    const timers = delays.map(delay => setTimeout(() => remeasureTarget(id), delay));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId, currentStepIndex, isActiveTargetReady]);

  // Missing-target watchdog: never leave an active tour that renders nothing.
  useEffect(() => {
    if (!activeTourId) return;
    if (!activeStep) {
      stopTour(false);
      return;
    }
    if (isActiveTargetReady) return;

    const timer = setTimeout(() => {
      if (__DEV__) {
        console.warn(
          `[rn-smart-tour] Target "${activeStep.targetId}" for step ${currentStepIndex + 1} of tour ` +
            `"${activeTourId}" was not found within ${missingTargetTimeoutMs}ms. Ending the tour.`,
        );
      }
      stopTour(false);
    }, missingTargetTimeoutMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId, currentStepIndex, isActiveTargetReady, missingTargetTimeoutMs, stopTour]);

  const contextValue = useMemo(
    () => ({
      registerTarget,
      unregisterTarget,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      resetTour,
      resetAll,
      activeTour,
      currentStepIndex,
      targets,
      seenTours,
      requestScroll,
      _registerScrollRef,
      _unregisterScrollRef,
    }),
    [
      registerTarget,
      unregisterTarget,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      resetTour,
      resetAll,
      activeTour,
      currentStepIndex,
      targets,
      seenTours,
      requestScroll,
      _registerScrollRef,
      _unregisterScrollRef,
    ],
  );

  return (
    <DapContext.Provider value={contextValue}>
      {children}
      <DapOverlay />
    </DapContext.Provider>
  );
};
