import type { StartTourOptions, StorageAdapter, TargetMeasurement as Rect, Tour, TourStep } from '../types';
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

export interface TargetHandle {
  ref: { current: any };
  scope: ScopeHandle | null;
  scrollable: ScrollableHandle | null;
}

/** The step currently drawn by the overlay, with its target's window-relative rect. */
export interface PresentedStep {
  tourId: string;
  stepIndex: number;
  rect: Rect;
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
}

export interface TourEngineOptions {
  tours: Record<string, Tour>;
  storage?: StorageAdapter;
  missingTargetTimeoutMs?: number;
  autoStartDelayMs?: number;
}

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
    this.store = createStore<TourEngineState>({
      storageReady: !options.storage,
      seen: {},
      tourId: null,
      stepIndex: 0,
      presented: null,
    });
  }

  getState = () => this.store.getState();

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  getTour = (tourId: string): Tour | null => this.tours[tourId] ?? null;

  setOptions(options: Partial<Omit<TourEngineOptions, 'storage'>>) {
    if (options.missingTargetTimeoutMs !== undefined)
      this.missingTargetTimeoutMs = options.missingTargetTimeoutMs;
    if (options.autoStartDelayMs !== undefined) this.autoStartDelayMs = options.autoStartDelayMs;
    if (options.tours && options.tours !== this.tours) {
      this.tours = options.tours;
      const { tourId } = this.getState();
      if (tourId && !this.tours[tourId]) {
        this.finish(false);
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
    if (!step || (name !== null && name !== step.targetId)) return;

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
    this.whenStorageReady(() => {
      const tour = this.tours[tourId];
      if (!tour) {
        console.warn(`[rn-smart-tour] Tour with id ${tourId} not found.`);
        return;
      }
      if (tour.steps.length === 0) {
        console.warn(`[rn-smart-tour] Tour with id ${tourId} has no steps.`);
        return;
      }
      if (this.getState().seen[tourId] && !options?.force) return;

      this.store.setState({ tourId, stepIndex: 0, presented: null });
      this.enterStep();
    });
  };

  stopTour = (markAsSeen = true) => {
    this.finish(markAsSeen);
  };

  nextStep = () => {
    const { tourId, stepIndex } = this.getState();
    if (!tourId) return;
    const tour = this.tours[tourId];
    if (!tour) {
      this.finish(false);
    } else if (stepIndex < tour.steps.length - 1) {
      this.store.setState({ stepIndex: stepIndex + 1 });
      this.enterStep();
    } else {
      // Finished the last step
      this.finish(true);
    }
  };

  prevStep = () => {
    const { tourId, stepIndex } = this.getState();
    if (!tourId || stepIndex === 0) return;
    this.store.setState({ stepIndex: stepIndex - 1 });
    this.enterStep();
  };

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
      this.finish(false);
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
    const timeoutMs = step.targetTimeoutMs ?? this.missingTargetTimeoutMs;
    this.missingTimer = setTimeout(() => {
      if (token !== this.stepToken) return;
      const skip = step.onMissingTarget === 'skip';
      if (__DEV__) {
        const { tourId, stepIndex } = this.getState();
        console.warn(
          `[rn-smart-tour] Target "${step.targetId}" for step ${stepIndex + 1} of tour "${tourId}" ` +
            `was not found within ${timeoutMs}ms. ${skip ? 'Skipping the step.' : 'Ending the tour.'}`,
        );
      }
      if (skip) {
        this.nextStep();
      } else {
        this.finish(false);
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
    const { presented } = this.getState();
    if (
      presented &&
      presented.tourId === tourId &&
      presented.stepIndex === stepIndex &&
      isSameRect(presented.rect, rect)
    ) {
      return;
    }
    this.store.setState({ presented: { tourId, stepIndex, rect } });
  }

  private finish(markAsSeen: boolean) {
    const { tourId, seen } = this.getState();
    if (!tourId) return;

    this.stepToken++;
    this.clearStepTimers();
    this.stoppedThisSession.add(tourId);
    this.store.setState({ tourId: null, stepIndex: 0, presented: null });
    if (markAsSeen) {
      this.persistSeen({ ...seen, [tourId]: true });
    }
    this.scheduleAutoStart();
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
        if (
          tour.autoStart &&
          !state.seen[id] &&
          !this.stoppedThisSession.has(id) &&
          tour.steps.length > 0 &&
          this.resolveTarget(tour.steps[0].targetId)
        ) {
          this.startTour(id);
          break; // Start only one auto-tour at a time
        }
      }
    }, this.autoStartDelayMs);
  }
}
