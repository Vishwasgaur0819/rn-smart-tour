export interface TargetMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** App state that tours can check (`canStart`, step `when`), e.g. `{ isOnline, hasDraftMtp }`. */
export type TourContext = Record<string, unknown>;

/**
 * How a step moves on:
 * - `'next'` (default): the user taps Next on the card.
 * - `'press'`: the user taps the highlighted element itself (it stays tappable);
 *   the step moves on when they do. Use for "Tap Apply Leave" style steps.
 * - `{ event }`: the app reports that something happened with `emit(event)`,
 *   e.g. a leave type was chosen.
 */
export type StepAdvance = 'next' | 'press' | { event: string };

export interface TourStep {
  /** Matches a `TourTarget` name. Leave out for a card in the middle of the screen (intro, finish). */
  targetId?: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Default: 'next'. */
  advanceOn?: StepAdvance;
  /**
   * Keep the highlighted element usable during the step (e.g. a form field the user
   * fills in), while the step still moves on with Next (or its `advanceOn` event).
   * Implied by `advanceOn: 'press'`.
   */
  interactive?: boolean;
  /** Show the step only when this returns true (checked as the step is reached). */
  when?: (context: TourContext) => boolean;
  /**
   * Runs before the step looks for its target, e.g. to navigate to the screen
   * that contains it. The step waits for a returned promise.
   */
  beforeEnter?: () => void | Promise<void>;
  /**
   * What to do if the target is not on screen within the timeout:
   * - 'end' (default for tours) ends the tour without marking it seen;
   * - 'skip' moves on to the next step;
   * - 'pause' (default for walkthroughs) hides the tour and offers to resume it.
   */
  onMissingTarget?: 'end' | 'skip' | 'pause';
  /** Overrides the provider's `missingTargetTimeoutMs` for this step. */
  targetTimeoutMs?: number;
}

export interface Tour {
  id: string;
  steps: TourStep[];
  /** Start automatically, once, the first time the first step with a target is on screen. */
  autoStart?: boolean;
  /**
   * - `'tour'` (default): introduces a screen or feature.
   * - `'walkthrough'`: guides the user through a task ("Apply for leave"), usually
   *   started from a help list. Missing targets pause it instead of ending it, and
   *   the built-in card says "Exit" instead of "Skip".
   */
  kind?: 'tour' | 'walkthrough';
  /** For help lists (`useTourCatalog`), e.g. "Apply for leave". */
  title?: string;
  description?: string;
  /** Extra words that should find this tour in a help search, e.g. ['holiday', 'sick']. */
  keywords?: string[];
  /**
   * Checked before starting. Return true to start, or a message explaining why not
   * (e.g. 'Connect to the internet first'); the provider's `onStartBlocked` receives it.
   */
  canStart?: (context: TourContext) => boolean | string;
}

export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
}

export interface StartTourOptions {
  /** Start the tour even if it has already been seen (e.g. from a "Help" button). */
  force?: boolean;
}

/** What a custom tooltip card (`renderTooltip`) receives. */
export interface TourTooltipProps {
  tour: Tour;
  step: TourStep;
  /** 0-based position of `step` among the steps shown (steps whose `when` is false don't count). */
  stepIndex: number;
  stepCount: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  /**
   * The step moves on by itself (the user taps the highlighted element, or the app
   * reports an event): don't show a Next button, tell the user what to do instead.
   */
  isActionStep: boolean;
  /** The highlighted element can be used during the step (e.g. a field to fill in). */
  isInteractive: boolean;
  /** The step has no target and is drawn in the middle of the screen. */
  isCentered: boolean;
  /** Next step, or finish (and mark seen) on the last one. */
  next: () => void;
  /** Previous step. */
  prev: () => void;
  /** End the tour and mark it seen. */
  skip: () => void;
}

/**
 * - `idle`: no tour running.
 * - `waiting`: a step is active but its target is not measured yet (or not on screen).
 * - `active`: the current step is shown.
 * - `paused`: the tour is on hold (its target went away); `resumeTour` continues it.
 */
export type TourStatus = 'idle' | 'waiting' | 'active' | 'paused';

/** A tour as listed by `useTourCatalog`. */
export interface TourCatalogEntry {
  id: string;
  title: string;
  description?: string;
  kind: 'tour' | 'walkthrough';
}

export interface TourApi {
  startTour: (tourId: string, options?: StartTourOptions) => void;
  stopTour: (markAsSeen?: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  /** Mark a tour as unseen so it can be shown (and auto-started) again. */
  resetTour: (tourId: string) => void;
  /** Mark every tour as unseen. */
  resetAll: () => void;
  /** Report that something happened, for steps with `advanceOn: { event }`. */
  emit: (event: string) => void;
  /** Put the running tour on hold (e.g. while the app shows something unrelated). */
  pauseTour: () => void;
  /** Continue a paused tour from the latest step whose target is on screen. */
  resumeTour: () => void;
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
