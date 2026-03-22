import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { DapContext } from './DapContext';
import { Tour, TargetMeasurement, StorageAdapter } from './types';
import { DapOverlay } from './DapOverlay';

export interface DapProviderProps {
  children: React.ReactNode;
  tours: Record<string, Tour>;
  storageAdapter?: StorageAdapter; // Accept MMKV, AsyncStorage, etc.
}

const STORAGE_KEY = '@rn-dap:seen_tours';

/**
 * Debounce delay (ms) before auto-starting a tour after a target registers.
 * This gives the multi-pass measurement in DapTarget time to settle on the
 * final coordinates before the overlay is shown.
 */
const AUTO_START_DEBOUNCE_MS = 300;

export const DapProvider: React.FC<DapProviderProps> = ({ children, tours, storageAdapter }) => {
  const [targets, setTargets] = useState<Record<string, TargetMeasurement>>({});
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [seenTours, setSeenTours] = useState<Record<string, boolean>>({});
  const [isStorageLoaded, setIsStorageLoaded] = useState(!storageAdapter);

  // Ref to avoid stale closures — always holds the latest activeTourId.
  const activeTourIdRef = useRef(activeTourId);
  activeTourIdRef.current = activeTourId;

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
        // Safe side-effect here for async storage, as long as it's fire-and-forget
        Promise.resolve(storageAdapter.setItem(STORAGE_KEY, JSON.stringify(nextSeen))).catch(e => {
          console.error('[rn-dap] failed to save storage', e);
        });
      }
      return nextSeen;
    });
  }, [storageAdapter]);

  const registerTarget = useCallback((id: string, measurement: TargetMeasurement) => {
    setTargets(prev => ({ ...prev, [id]: measurement }));
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    setTargets(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const startTour = useCallback((tourId: string) => {
    if (tours[tourId] && !seenTours[tourId]) {
      setActiveTourId(tourId);
      setCurrentStepIndex(0);
    } else if (!tours[tourId]) {
      console.warn(`[rn-dap] Tour with id ${tourId} not found.`);
    }
  }, [tours, seenTours]);

  // Uses activeTourIdRef to avoid stale closures and prevent cascading re-renders.
  const stopTour = useCallback((markAsSeen = true) => {
    const currentTourId = activeTourIdRef.current;
    if (currentTourId && markAsSeen) {
      saveSeenTour(currentTourId);
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
        // Finished the last step
        stopTour(true);
      }
    }
  }, [activeTourId, currentStepIndex, tours, stopTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  /** Timer ref for debounced auto-start. */
  const autoStartTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-Start Engine — debounced so multi-pass measurements can settle.
  useEffect(() => {
    // Wait until storage is loaded, and ensure no tour is currently running
    if (!isStorageLoaded || activeTourId) return;

    // Clear any previously scheduled auto-start
    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }

    autoStartTimerRef.current = setTimeout(() => {
      for (const tourId of Object.keys(tours)) {
        const tour = tours[tourId];
        if (tour.autoStart && !seenTours[tourId] && tour.steps.length > 0) {
          const firstTargetId = tour.steps[0].targetId;

          // If the first target of an unread, auto-starting tour is mounted
          if (targets[firstTargetId]) {
            startTour(tourId);
            break; // Start only one auto-tour at a time
          }
        }
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
    seenTours
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
    seenTours
  ]);

  return (
    <DapContext.Provider value={contextValue}>
      {children}
      <DapOverlay />
    </DapContext.Provider>
  );
};
