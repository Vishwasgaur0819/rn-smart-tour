import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { findNodeHandle } from 'react-native';
import { DapContext } from './DapContext';
import { Tour, TargetMeasurement, StorageAdapter } from './types';
import { DapOverlay } from './DapOverlay';

export interface DapProviderProps {
  children: React.ReactNode;
  tours: Record<string, Tour>;
  storageAdapter?: StorageAdapter;
}

const STORAGE_KEY = '@rn-dap:seen_tours';
const AUTO_START_DEBOUNCE_MS = 300;

export const DapProvider: React.FC<DapProviderProps> = ({ children, tours, storageAdapter }) => {
  const [targets, setTargets] = useState<Record<string, TargetMeasurement>>({});
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [seenTours, setSeenTours] = useState<Record<string, boolean>>({});
  const [isStorageLoaded, setIsStorageLoaded] = useState(!storageAdapter);

  const activeTourIdRef = useRef(activeTourId);
  activeTourIdRef.current = activeTourId;

  const tourIdJustStoppedRef = useRef<string | null>(null);

  /** Map of target IDs to their native component references (for measureLayout). */
  const targetRefs = useRef<Record<string, any>>({});
  /** Reference to the active ScrollView (if any) for auto-scrolling. */
  const scrollRef = useRef<any>(null);

  // Load seen tours on mount if a storage adapter is provided
  useEffect(() => {
    const loadStorage = async () => {
      if (storageAdapter) {
        try {
          const stored = await storageAdapter.getItem(STORAGE_KEY);
          if (stored) {
            setSeenTours(JSON.parse(stored));
          }
        } catch (e) {
          console.error('[rn-dap] failed to load storage', e);
        }
        setIsStorageLoaded(true);
      }
    };
    loadStorage();
  }, [storageAdapter]);

  const saveSeenTour = useCallback(async (tourId: string) => {
    setSeenTours(prev => {
      const nextSeen = { ...prev, [tourId]: true };
      if (storageAdapter) {
        Promise.resolve(storageAdapter.setItem(STORAGE_KEY, JSON.stringify(nextSeen))).catch(e => {
          console.error('[rn-dap] failed to save storage', e);
        });
      }
      return nextSeen;
    });
  }, [storageAdapter]);

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

  const _registerScrollRef = useCallback((ref: any) => {
    scrollRef.current = ref;
  }, []);

  /**
   * Calculates the relative position of a target to the registered ScrollView
   * and triggers a native scrollTo call.
   */
  const requestScroll = useCallback((targetId: string) => {
    const target = targetRefs.current[targetId];
    const scroll = scrollRef.current;

    if (!target || !scroll) return;

    // Use measureLayout for scrollable positioning calculation
    const targetHandle = findNodeHandle(target);
    const scrollHandle = findNodeHandle(scroll);

    if (targetHandle && scrollHandle) {
         try {
            target.measureLayout(
                scrollHandle,
                (_x: number, y: number) => {
                    // Scroll target into view with some top padding
                    scroll.scrollTo({ y: Math.max(0, y - 100), animated: true });
                },
                () => {
                    console.warn(`[rn-dap] Failed to measure layout for target: ${targetId}`);
                }
            );
         } catch (e) {
             // Fallback if measureLayout isn't available on the component ref directly
             console.warn('[rn-dap] measureLayout failed', e);
         }
    }
  }, []);

  const startTour = useCallback((tourId: string) => {
    if (tours[tourId] && !seenTours[tourId]) {
      setActiveTourId(tourId);
      setCurrentStepIndex(0);
    } else if (!tours[tourId]) {
      console.warn(`[rn-dap] Tour with id ${tourId} not found.`);
    }
  }, [tours, seenTours]);

  const stopTour = useCallback((markAsSeen = true) => {
    const currentTourId = activeTourIdRef.current;
    if (currentTourId) {
      if (markAsSeen) {
        saveSeenTour(currentTourId);
      }
      tourIdJustStoppedRef.current = currentTourId;
    }
    setActiveTourId(null);
    setCurrentStepIndex(0);
  }, [saveSeenTour]);

  const nextStep = useCallback(() => {
    if (activeTourId && tours[activeTourId]) {
      const tour = tours[activeTourId];
      if (currentStepIndex < tour.steps.length - 1) {
        setCurrentStepIndex(prev => prev + 1);
      } else {
        stopTour(true);
      }
    }
  }, [activeTourId, currentStepIndex, tours, stopTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isStorageLoaded || activeTourId) return;
    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }
    autoStartTimerRef.current = setTimeout(() => {
      for (const tourId of Object.keys(tours)) {
        const tour = tours[tourId];
        const wasJustStopped = tourIdJustStoppedRef.current === tourId;
        if (tour.autoStart && !seenTours[tourId] && !wasJustStopped && tour.steps.length > 0) {
          const firstTargetId = tour.steps[0].targetId;
          if (targets[firstTargetId]) {
            startTour(tourId);
            break;
          }
        }
      }
      if (tourIdJustStoppedRef.current && seenTours[tourIdJustStoppedRef.current]) {
        tourIdJustStoppedRef.current = null;
      }
    }, AUTO_START_DEBOUNCE_MS);
    return () => {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
      }
    };
  }, [targets, tours, seenTours, isStorageLoaded, activeTourId, startTour]);

  const activeTour = activeTourId ? tours[activeTourId] : null;

  const contextValue = useMemo(() => ({
    registerTarget,
    unregisterTarget,
    startTour,
    stopTour,
    nextStep,
    prevStep,
    activeTour,
    currentStepIndex,
    targets,
    seenTours,
    requestScroll,
    _registerScrollRef
  }), [
    registerTarget,
    unregisterTarget,
    startTour,
    stopTour,
    nextStep,
    prevStep,
    activeTour,
    currentStepIndex,
    targets,
    seenTours,
    requestScroll,
    _registerScrollRef
  ]);

  return (
    <DapContext.Provider value={contextValue}>
      {children}
      <DapOverlay />
    </DapContext.Provider>
  );
};
