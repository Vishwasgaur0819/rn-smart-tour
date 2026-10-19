import { TourEngine } from './TourEngine';
import type { TourEngineState } from './TourEngine';
import type { StartTourOptions, StorageAdapter, Tour, TourContext } from '../types';

/** Tour actions and state, usable outside React (deep links, push notification handlers, …). */
export interface TourController {
  startTour: (tourId: string, options?: StartTourOptions) => void;
  stopTour: (markAsSeen?: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetTour: (tourId: string) => void;
  resetAll: () => void;
  /** Report that something happened, for steps with `advanceOn: { event }`. */
  emit: (event: string) => void;
  pauseTour: () => void;
  resumeTour: () => void;
  getState: () => TourEngineState;
  subscribe: (listener: () => void) => () => void;
}

export interface TourControllerOptions {
  tours: Record<string, Tour>;
  /** Persists seen tours (AsyncStorage, MMKV, …). Read when the TourProvider mounts. */
  storageAdapter?: StorageAdapter;
  missingTargetTimeoutMs?: number;
  context?: TourContext;
  onStartBlocked?: (tour: Tour, reason: string) => void;
}

/**
 * Creates a controller to pass to `<TourProvider controller={…}>`, so tours can
 * also be started from outside React:
 *
 * ```ts
 * export const tours = createTourController({ tours: TOURS, storageAdapter });
 * // in a notification handler:
 * tours.startTour('new-feature', { force: true });
 * ```
 */
export function createTourController({
  tours,
  storageAdapter,
  missingTargetTimeoutMs,
  context,
  onStartBlocked,
}: TourControllerOptions): TourController {
  return new TourEngine({ tours, storage: storageAdapter, missingTargetTimeoutMs, context, onStartBlocked });
}

export const isTourEngine = (controller: TourController): controller is TourEngine =>
  controller instanceof TourEngine;
