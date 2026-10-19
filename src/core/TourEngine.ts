import type {
  StartTourOptions,
  StorageAdapter,
  TargetMeasurement as Rect,
  Tour,
  TourContext,
  TourEvent,
  TourExitReason,
  TourStep,
} from '../types';
import { createStore } from './store';
import type { Store } from './store';
import { delay, isSameRect, measureStable, scrollIntoView } from './measure';

/** A `TourScope`: its targets only count while it (and every parent scope) is ready. */
export interface ScopeHandle {
  ready: boolean;
  parent: ScopeHandle | null;
}

/** The nearest scroll container of a target, used to scroll it into view. */
export interface ScrollableHandle {
  ref: { current: any };
  horizontal: boolean;
}

/** A `TourOverlayHost` (e.g. inside an app popup): steps on its targets are drawn there. */
export interface HostHandle {
  id: string;
}

export interface TargetHandle {
  ref: { current: any };
  scope: ScopeHandle | null;
  scrollable: ScrollableHandle | null;
  /** The nearest `TourOverlayHost`; null/undefined: drawn by the provider's root overlay. */
  host?: HostHandle | null;
}

/**
 * The step currently drawn by the overlay, with its target's window-relative rect
 * (null for a step without a target, drawn in the middle of the screen).
 */
export interface PresentedStep {
  tourId: string;
  stepIndex: number;
  rect: Rect | null;
  /** The `TourOverlayHost` that draws this step (its target is inside it), or null for the root overlay. */
  hostId: string | null;
}

export interface TourEngineState {
  storageReady: boolean;
  seen: Record<string, boolean>;
  /** The running tour and the step it is on (which may still be waiting for its target). */
  tourId: string | null;
  stepIndex: number;
  /**
   * What the overlay shows. While moving to the next step it keeps the previous
   * step until the new target is measured, so the overlay does not flicker.
   */
  presented: PresentedStep | null;
  /** The running tour is on hold (its target went away); `resumeTour` continues it. */
  paused: boolean;
  /** Changes when the set of tours changes (for help lists). */
  toursRevision: number;
}

export interface TourEngineOptions {
  tours: Record<string, Tour>;
  storage?: StorageAdapter;
  missingTargetTimeoutMs?: number;
  autoStartDelayMs?: number;
  /** App state for `canStart` and step `when`. */
  context?: TourContext;
  /** A tour's `canStart` refused a start requested with `startTour` (not auto-start). */
  onStartBlocked?: (tour: Tour, reason: string) => void;
  /** Analytics: called for everything that happens in a tour (see `TourEvent`). */
  onEvent?: (event: TourEvent) => void;
}

/** A `TourEvent` without the fields the engine fills in. */
type TourEventBody = TourEvent extends infer E
  ? E extends TourEvent
    ? Omit<E, 'runId' | 'tourId' | 'tourKind' | 'timestamp'>
    : never
  : never;

let runCounter = 0;
/** Unique enough to group one run's events on a backend (not a secure id). */
const createRunId = () =>
  `${Date.now().toString(36)}-${(++runCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A press on a target only counts if the finger moved less than this (not a scroll). */
export const PRESS_SLOP = 10;

export const STORAGE_KEY = '@rn-dap:seen_tours';
const DEFAULT_MISSING_TARGET_TIMEOUT_MS = 3000;
const DEFAULT_AUTO_START_DELAY_MS = 300;
/** Let an animated scroll run this long before waiting for the target to stop moving. */
const SCROLL_SETTLE_MS = 250;
/** Retry interval while a registered target cannot be measured yet (e.g. it has no size). */
const MEASURE_RETRY_MS = 250;
/** Debounce for re-measuring the shown target after layout, rotation or keyboard changes. */
const REMEASURE_DEBOUNCE_MS = 50;

const cancelTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
  if (timer !== undefined) clearTimeout(timer);
};

const isScopeReady = (scope: ScopeHandle | null): boolean =>
  !scope || (scope.ready && isScopeReady(scope.parent));

/**
 * Tour state machine. Targets register a ref only; a target is measured when its
 * step becomes current (after scrolling it into view and waiting for it to stop
 * moving), and again when something may have moved it while it is shown.
 */
export class TourEngine {
  private store: Store<TourEngineState>;
  private tours: Record<string, Tour>;
  private storage?: StorageAdapter;
  private missingTargetTimeoutMs: number;
  private autoStartDelayMs: number;
  private context: TourContext;
  private onStartBlocked?: (tour: Tour, reason: string) => void;
  private onEvent?: (event: TourEvent) => void;

  /** The running tour's run, for analytics. */
  private run: { id: string; startedAt: number } | null = null;
  /** The step token whose step_shown event was sent (re-presenting the same step sends none). */
  private shownToken = -1;

  private targets = new Map<string, TargetHandle[]>();
  /** Not auto-started again until the next launch (or resetTour); startTour still works. */
  private stoppedThisSession = new Set<string>();
  /** Work requested before storage finished loading; run in order once it has. */
  private pendingOps: Array<() => void> = [];
  private storageLoadStarted = false;
  private warnedDuplicates = new Set<string>();

  /** Changes whenever the current step changes, cancelling async work for the old one. */
  private stepToken = 0;
  /** The step token whose beforeEnter has finished; its target may be looked for. */
  private enteredToken = -1;
  /** Changes on every reveal attempt, so only the latest attempt applies its result. */
  private revealRun = 0;

  private missingTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private remeasureTimer?: ReturnType<typeof setTimeout>;
  private autoStartTimer?: ReturnType<typeof setTimeout>;

  constructor(options: TourEngineOptions) {
    this.tours = options.tours;
    this.storage = options.storage;
    this.missingTargetTimeoutMs = options.missingTargetTimeoutMs ?? DEFAULT_MISSING_TARGET_TIMEOUT_MS;
    this.autoStartDelayMs = options.autoStartDelayMs ?? DEFAULT_AUTO_START_DELAY_MS;
    this.context = options.context ?? {};
    this.onStartBlocked = options.onStartBlocked;
    this.onEvent = options.onEvent;
    this.store = createStore<TourEngineState>({
      storageReady: !options.storage,
      seen: {},
      tourId: null,
      stepIndex: 0,
      presented: null,
      paused: false,
      toursRevision: 0,
    });
  }

  getState = () => this.store.getState();

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  getTour = (tourId: string): Tour | null => this.tours[tourId] ?? null;

  getTours = (): Tour[] => Object.values(this.tours);

  getContext = (): TourContext => this.context;

  /** Indexes of the tour's steps that are shown (their `when` passes right now). */
  getShownStepIndexes = (tourId: string): number[] => {
    const tour = this.tours[tourId];
    return tour ? tour.steps.map((_, i) => i).filter(i => this.isShown(tour, i)) : [];
  };

  setOptions(options: Partial<Omit<TourEngineOptions, 'storage'>>) {
    if (options.missingTargetTimeoutMs !== undefined)
      this.missingTargetTimeoutMs = options.missingTargetTimeoutMs;
    if (options.autoStartDelayMs !== undefined) this.autoStartDelayMs = options.autoStartDelayMs;
    if (options.context !== undefined) this.context = options.context;
    if ('onStartBlocked' in options) this.onStartBlocked = options.onStartBlocked;
    if ('onEvent' in options) this.onEvent = options.onEvent;
    if (options.tours && options.tours !== this.tours) {
      this.tours = options.tours;
      this.store.setState({ toursRevision: this.getState().toursRevision + 1 });
      const { tourId } = this.getState();
      if (tourId && !this.tours[tourId]) {
        this.finish(false, 'removed');
      } else {
        this.scheduleAutoStart();
      }
    }
  }

  // ---------------------------------------------------------------- storage

  /** Reads seen tours once. Safe to call more than once. */
  async loadStorage() {
    const adapter = this.storage;
    if (!adapter || this.storageLoadStarted) return;
    this.storageLoadStarted = true;

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

    this.store.setState({ seen: stored, storageReady: true });
    const ops = this.pendingOps;
    this.pendingOps = [];
    ops.forEach(op => op());
    this.scheduleAutoStart();
  }

  private whenStorageReady(op: () => void) {
    if (this.getState().storageReady) {
      op();
    } else {
      this.pendingOps.push(op);
    }
  }

  private persistSeen(next: Record<string, boolean>) {
    this.store.setState({ seen: next });
    const adapter = this.storage;
    if (adapter) {
      Promise.resolve()
        .then(() => adapter.setItem(STORAGE_KEY, JSON.stringify(next)))
        .catch(e => {
          console.error('[rn-smart-tour] failed to save storage', e);
        });
    }
  }

  // ---------------------------------------------------------------- targets

  /** Registers a target; returns its unregister function. */
  registerTarget(name: string, handle: TargetHandle): () => void {
    const list = this.targets.get(name) ?? [];
    list.push(handle);
    this.targets.set(name, list);
    this.onTargetsChanged(name);

    return () => {
      const current = this.targets.get(name);
      if (!current) return;
      const index = current.indexOf(handle);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.targets.delete(name);
      this.onTargetsChanged(name);
    };
  }

  /** A TourScope became ready or stopped being ready. */
  notifyScopeChanged() {
    this.onTargetsChanged(null);
  }

  /** A target's layout changed; re-measure it if it is the one being shown. */
  notifyTargetLayout(name: string) {
    if (this.currentStep()?.targetId === name) this.requestRemeasure();
  }

  /** The user tapped a target. Moves on if the shown step waits for that tap. */
  notifyTargetPress(name: string) {
    const step = this.currentStep();
    if (step?.advanceOn === 'press' && step.targetId === name && this.isCurrentStepPresented()) {
      this.nextStep();
    }
  }

  /** The app reports something happened; moves on if the current step waits for it. */
  emit = (event: string) => {
    const advanceOn = this.currentStep()?.advanceOn;
    if (!this.getState().paused && typeof advanceOn === 'object' && advanceOn.event === event) {
      this.nextStep();
    }
  };

  /** Something may have moved the shown target (rotation, keyboard, app foregrounded). */
  requestRemeasure() {
    if (!this.isCurrentStepPresented()) return;
    cancelTimer(this.remeasureTimer);
    this.remeasureTimer = setTimeout(() => this.reveal(), REMEASURE_DEBOUNCE_MS);
  }

  /** The newest registered handle for `name` whose scopes are all ready. */
  private resolveTarget(name: string): TargetHandle | null {
    const ready = (this.targets.get(name) ?? []).filter(h => h.ref.current && isScopeReady(h.scope));
    if (ready.length > 1 && __DEV__ && !this.warnedDuplicates.has(name)) {
      this.warnedDuplicates.add(name);
      console.warn(
        `[rn-smart-tour] ${ready.length} targets named "${name}" are on screen; using the most recently mounted. ` +
          'Wrap screens in TourScope (or NavigationTourScope) so only the focused one counts.',
      );
    }
    return ready[ready.length - 1] ?? null;
  }

  private onTargetsChanged(name: string | null) {
    this.scheduleAutoStart();

    const step = this.currentStep();
    if (!step?.targetId || this.getState().paused || (name !== null && name !== step.targetId)) return;

    if (this.resolveTarget(step.targetId)) {
      if (this.isCurrentStepPresented()) {
        this.requestRemeasure();
      } else {
        this.reveal();
      }
    } else if (this.isCurrentStepPresented()) {
      // The shown target went away (unmounted, or its screen lost focus): hide and wait for it.
      this.store.setState({ presented: null });
      this.armMissingTimer(this.stepToken, step);
    }
  }

  // ---------------------------------------------------------------- tour actions

  startTour = (tourId: string, options?: StartTourOptions) => {
    this.whenStorageReady(() => this.start(tourId, options, false));
  };

  private start(tourId: string, options: StartTourOptions | undefined, isAutoStart: boolean) {
    const tour = this.tours[tourId];
    if (!tour) {
      console.warn(`[rn-smart-tour] Tour with id ${tourId} not found.`);
      return;
    }
    if (this.getState().seen[tourId] && !options?.force) return;

    const firstStep = this.findShownStep(tour, 0, 1);
    if (firstStep === null) {
      console.warn(`[rn-smart-tour] Tour with id ${tourId} has no steps to show.`);
      return;
    }

    const allowed = this.checkCanStart(tour);
    if (allowed !== true) {
      // Auto-starts are retried quietly on every target change: not worth an event.
      if (!isAutoStart) {
        this.track(tourId, { type: 'tour_blocked', reason: allowed }, createRunId());
        this.onStartBlocked?.(tour, allowed);
      }
      return;
    }

    const running = this.getState();
    if (running.tourId && this.run) {
      this.track(running.tourId, {
        type: 'tour_exited',
        reason: 'replaced',
        stepIndex: running.stepIndex,
        durationMs: Date.now() - this.run.startedAt,
      });
    }

    this.run = { id: createRunId(), startedAt: Date.now() };
    this.store.setState({ tourId, stepIndex: firstStep, presented: null, paused: false });
    this.track(tourId, {
      type: 'tour_started',
      trigger: isAutoStart ? 'auto' : 'manual',
      stepCount: this.getShownStepIndexes(tourId).length,
    });
    this.enterStep();
  }

  /** true, or why the tour can't start. */
  private checkCanStart(tour: Tour): true | string {
    if (!tour.canStart) return true;
    try {
      const result = tour.canStart(this.context);
      if (result === true) return true;
      return typeof result === 'string' && result ? result : 'This tour cannot start right now.';
    } catch (e) {
      console.error('[rn-smart-tour] canStart failed', e);
      return 'This tour cannot start right now.';
    }
  }

  /** `reason` is for analytics; the built-in UI passes 'user' / 'back_button'. */
  stopTour = (markAsSeen = true, reason: TourExitReason = 'app') => {
    this.finish(markAsSeen, reason);
  };

  nextStep = () => {
    const { tourId, stepIndex } = this.getState();
    if (!tourId) return;
    const tour = this.tours[tourId];
    if (!tour) {
      this.finish(false, 'removed');
      return;
    }
    const next = this.findShownStep(tour, stepIndex + 1, 1);
    if (next === null) {
      // Finished the last step
      this.finish(true, 'completed');
    } else {
      this.store.setState({ stepIndex: next, paused: false });
      this.enterStep();
    }
  };

  prevStep = () => {
    const { tourId, stepIndex } = this.getState();
    const tour = tourId ? this.tours[tourId] : undefined;
    if (!tour) return;
    const previous = this.findShownStep(tour, stepIndex - 1, -1);
    if (previous === null) return;
    this.store.setState({ stepIndex: previous, paused: false });
    this.enterStep();
  };

  /** Puts the running tour on hold: hidden, until `resumeTour` (or a new tour). */
  pauseTour = () => {
    this.pause('app');
  };

  private pause(reason: 'app' | 'target_missing') {
    const { tourId, stepIndex, paused } = this.getState();
    if (!tourId || paused) return;
    this.stepToken++;
    this.clearStepTimers();
    this.store.setState({ paused: true, presented: null });
    this.track(tourId, { type: 'tour_paused', reason, stepIndex });
  }

  /**
   * Continues a paused tour from the latest step (up to the one it paused on) whose
   * target is on screen now, so the user is guided back from wherever they went;
   * from the first step if none is.
   */
  resumeTour = () => {
    const { tourId, stepIndex, paused } = this.getState();
    const tour = tourId ? this.tours[tourId] : undefined;
    if (!tour || !paused) return;

    let resumeAt: number | null = null;
    for (let i = stepIndex; i >= 0 && resumeAt === null; i--) {
      const targetId = tour.steps[i].targetId;
      if (targetId && this.isShown(tour, i) && this.resolveTarget(targetId)) resumeAt = i;
    }
    resumeAt = resumeAt ?? this.findShownStep(tour, 0, 1);
    if (resumeAt === null) {
      this.finish(false, 'app');
      return;
    }
    this.store.setState({ stepIndex: resumeAt, paused: false, presented: null });
    this.track(tourId!, { type: 'tour_resumed', stepIndex: resumeAt });
    this.enterStep();
  };

  /** Whether the step's `when` lets it show (a throwing `when` counts as shown). */
  private isShown(tour: Tour, index: number) {
    const when = tour.steps[index]?.when;
    if (!when) return true;
    try {
      return !!when(this.context);
    } catch (e) {
      console.error('[rn-smart-tour] step when() failed', e);
      return true;
    }
  }

  /** The first shown step from `from`, moving by `direction`; null if there is none. */
  private findShownStep(tour: Tour, from: number, direction: 1 | -1): number | null {
    for (let i = from; i >= 0 && i < tour.steps.length; i += direction) {
      if (this.isShown(tour, i)) return i;
    }
    return null;
  }

  resetTour = (tourId: string) => {
    this.whenStorageReady(() => {
      this.stoppedThisSession.delete(tourId);
      const { seen } = this.getState();
      if (seen[tourId]) {
        const next = { ...seen };
        delete next[tourId];
        this.persistSeen(next);
      }
      this.scheduleAutoStart();
    });
  };

  resetAll = () => {
    this.whenStorageReady(() => {
      this.stoppedThisSession.clear();
      this.persistSeen({});
      this.scheduleAutoStart();
    });
  };

  /** Cancels timers and in-flight work. The engine stays usable (React StrictMode remounts). */
  dispose() {
    this.stepToken++;
    this.clearStepTimers();
    cancelTimer(this.autoStartTimer);
  }

  // ---------------------------------------------------------------- step lifecycle

  private currentStep(): TourStep | null {
    const { tourId, stepIndex } = this.getState();
    return (tourId && this.tours[tourId]?.steps[stepIndex]) || null;
  }

  private isCurrentStepPresented() {
    const { tourId, stepIndex, presented } = this.getState();
    return !!presented && presented.tourId === tourId && presented.stepIndex === stepIndex;
  }

  private clearStepTimers() {
    cancelTimer(this.missingTimer);
    cancelTimer(this.retryTimer);
    cancelTimer(this.remeasureTimer);
  }

  private enterStep() {
    const token = ++this.stepToken;
    this.clearStepTimers();
    const step = this.currentStep();
    if (!step) {
      this.finish(false, 'removed');
      return;
    }

    const run = async () => {
      if (step.beforeEnter) {
        try {
          await step.beforeEnter();
        } catch (e) {
          console.error('[rn-smart-tour] beforeEnter failed', e);
        }
        if (token !== this.stepToken) return;
      }
      this.enteredToken = token;
      this.armMissingTimer(token, step);
      this.reveal();
    };
    run();
  }

  private armMissingTimer(token: number, step: TourStep) {
    cancelTimer(this.missingTimer);
    if (!step.targetId) return; // centred steps have nothing to wait for
    const timeoutMs = step.targetTimeoutMs ?? this.missingTargetTimeoutMs;
    this.missingTimer = setTimeout(() => {
      if (token !== this.stepToken) return;
      const { tourId, stepIndex } = this.getState();
      const isWalkthrough = tourId ? this.tours[tourId]?.kind === 'walkthrough' : false;
      const policy = step.onMissingTarget ?? (isWalkthrough ? 'pause' : 'end');
      if (__DEV__) {
        const outcome = { skip: 'Skipping the step.', pause: 'Pausing the tour.', end: 'Ending the tour.' }[
          policy
        ];
        console.warn(
          `[rn-smart-tour] Target "${step.targetId}" for step ${stepIndex + 1} of tour "${tourId}" ` +
            `was not found within ${timeoutMs}ms. ${outcome}`,
        );
      }
      if (tourId) {
        this.track(tourId, { type: 'target_missing', stepIndex, targetId: step.targetId!, outcome: policy });
      }
      if (policy === 'skip') {
        this.nextStep();
      } else if (policy === 'pause') {
        this.pause('target_missing');
      } else {
        this.finish(false, 'target_missing');
      }
    }, timeoutMs);
  }

  /** Finds, scrolls into view and measures the current step's target, then presents it. */
  private async reveal() {
    const token = this.stepToken;
    if (token !== this.enteredToken) return; // beforeEnter still running
    const run = ++this.revealRun;
    const cancelled = () => token !== this.stepToken || run !== this.revealRun;
    cancelTimer(this.retryTimer);

    const { tourId, stepIndex } = this.getState();
    const step = this.currentStep();
    if (!tourId || !step) return;

    if (!step.targetId) {
      // A centred card: nothing to find or measure.
      this.store.setState({ presented: { tourId, stepIndex, rect: null, hostId: null } });
      this.trackStepShown(token);
      return;
    }

    const handle = this.resolveTarget(step.targetId);
    if (!handle) {
      // Hide the previous step while waiting; a registration or scope change calls reveal again.
      this.store.setState({ presented: null });
      return;
    }

    const ref = handle.ref.current;
    if (handle.scrollable) {
      const scrolled = await scrollIntoView(ref, handle.scrollable.ref.current, {
        horizontal: handle.scrollable.horizontal,
      });
      if (cancelled()) return;
      if (scrolled) {
        // Don't leave the previous step's overlay up while the content scrolls under it.
        if (!this.isCurrentStepPresented()) this.store.setState({ presented: null });
        await delay(SCROLL_SETTLE_MS);
        if (cancelled()) return;
      }
    }

    const rect = await measureStable(ref, { isCancelled: cancelled });
    if (cancelled()) return;

    // Not measurable yet, or its scope stopped being ready while measuring (e.g. a screen
    // transition started): try again shortly. The missing-target timer bounds the wait.
    if (!rect || this.resolveTarget(step.targetId) !== handle) {
      this.retryTimer = setTimeout(() => this.reveal(), MEASURE_RETRY_MS);
      return;
    }

    cancelTimer(this.missingTimer);
    const hostId = handle.host?.id ?? null;
    const { presented } = this.getState();
    if (
      presented &&
      presented.tourId === tourId &&
      presented.stepIndex === stepIndex &&
      presented.hostId === hostId &&
      presented.rect &&
      isSameRect(presented.rect, rect)
    ) {
      return;
    }
    this.store.setState({ presented: { tourId, stepIndex, rect, hostId } });
    this.trackStepShown(token);
  }

  private finish(markAsSeen: boolean, outcome: 'completed' | TourExitReason) {
    const { tourId, stepIndex, seen } = this.getState();
    if (!tourId) return;

    if (this.run) {
      const durationMs = Date.now() - this.run.startedAt;
      this.track(
        tourId,
        outcome === 'completed'
          ? { type: 'tour_completed', durationMs }
          : { type: 'tour_exited', reason: outcome, stepIndex, durationMs },
      );
    }
    this.run = null;

    this.stepToken++;
    this.clearStepTimers();
    this.stoppedThisSession.add(tourId);
    this.store.setState({ tourId: null, stepIndex: 0, presented: null, paused: false });
    if (markAsSeen) {
      this.persistSeen({ ...seen, [tourId]: true });
    }
    this.scheduleAutoStart();
  }

  // ---------------------------------------------------------------- analytics

  private track(tourId: string, body: TourEventBody, runId = this.run?.id) {
    const onEvent = this.onEvent;
    if (!onEvent) return;
    try {
      onEvent({
        ...body,
        runId: runId ?? createRunId(),
        tourId,
        tourKind: this.tours[tourId]?.kind ?? 'tour',
        timestamp: Date.now(),
      } as TourEvent);
    } catch (e) {
      console.error('[rn-smart-tour] onEvent failed', e);
    }
  }

  /** Once per entered step: re-presenting it (re-measure, target back on screen) sends nothing. */
  private trackStepShown(token: number) {
    if (token === this.shownToken) return;
    this.shownToken = token;
    const { tourId, stepIndex } = this.getState();
    const tour = tourId ? this.tours[tourId] : undefined;
    if (!tourId || !tour) return;
    const shown = this.getShownStepIndexes(tourId);
    this.track(tourId, {
      type: 'step_shown',
      stepIndex,
      stepNumber: shown.indexOf(stepIndex) + 1,
      stepCount: shown.length,
      targetId: tour.steps[stepIndex]?.targetId,
    });
  }

  // ---------------------------------------------------------------- auto-start

  /** Debounced so a screen's targets can all mount before a tour is picked. */
  private scheduleAutoStart() {
    const { storageReady, tourId } = this.getState();
    if (!storageReady || tourId) return;

    cancelTimer(this.autoStartTimer);
    this.autoStartTimer = setTimeout(() => {
      const state = this.getState();
      if (state.tourId) return;
      for (const id of Object.keys(this.tours)) {
        const tour = this.tours[id];
        if (!tour.autoStart || state.seen[id] || this.stoppedThisSession.has(id)) continue;
        // Starts when the first shown step with a target is on screen (centred intro
        // cards before it don't count: they would show anywhere).
        const anchor = tour.steps.find((step, i) => step.targetId && this.isShown(tour, i));
        if (anchor?.targetId && this.resolveTarget(anchor.targetId)) {
          this.start(id, undefined, true);
          break; // Start only one auto-tour at a time
        }
      }
    }, this.autoStartDelayMs);
  }
}
