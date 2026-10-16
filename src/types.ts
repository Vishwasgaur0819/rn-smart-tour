export interface TargetMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TourStep {
  targetId: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * Runs before the step looks for its target, e.g. to navigate to the screen
   * that contains it. The step waits for a returned promise.
   */
  beforeEnter?: () => void | Promise<void>;
  /**
   * What to do if the target is not on screen within the timeout:
   * 'end' (default) ends the tour without marking it seen; 'skip' moves on to the next step.
   */
  onMissingTarget?: 'end' | 'skip';
  /** Overrides the provider's `missingTargetTimeoutMs` for this step. */
  targetTimeoutMs?: number;
}

export interface Tour {
  id: string;
  steps: TourStep[];
  autoStart?: boolean; // If true, starts automatically when first target is visible
}

export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
}

export interface StartTourOptions {
  /** Start the tour even if it has already been seen (e.g. from a "Help" button). */
  force?: boolean;
}

/**
 * - `idle`: no tour running.
 * - `waiting`: a step is active but its target is not measured yet (or not on screen).
 * - `active`: the current step is shown.
 */
export type TourStatus = 'idle' | 'waiting' | 'active';

export interface TourApi {
  startTour: (tourId: string, options?: StartTourOptions) => void;
  stopTour: (markAsSeen?: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  /** Mark a tour as unseen so it can be shown (and auto-started) again. */
  resetTour: (tourId: string) => void;
  /** Mark every tour as unseen. */
  resetAll: () => void;
  status: TourStatus;
  activeTour: Tour | null;
  currentStepIndex: number;
  seenTours: Record<string, boolean>;
}

/** @deprecated Use `TourApi` (returned by `useTour`). */
export interface DapContextType extends TourApi {
  /** @deprecated Wrap the element in `TourTarget` instead. */
  registerTarget: (id: string, measurement: TargetMeasurement, ref?: any) => void;
  /** @deprecated Wrap the element in `TourTarget` instead. */
  unregisterTarget: (id: string) => void;
  /** @deprecated Only contains the measurement of the step currently shown. */
  targets: Record<string, TargetMeasurement>;
  /** @deprecated Targets are scrolled into view automatically. This does nothing. */
  requestScroll: (targetId: string) => void;
  /** @deprecated Internal; does nothing. */
  _registerScrollRef: (ref: any) => void;
  /** @deprecated Internal; does nothing. */
  _unregisterScrollRef: (ref: any) => void;
}
