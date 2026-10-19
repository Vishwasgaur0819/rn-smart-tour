import { TourEngine } from '../core/TourEngine';
import type { TargetHandle } from '../core/TourEngine';
import type { Tour, TourEvent } from '../types';

const fakeView = () => ({
  measureInWindow: jest.fn((cb: (...a: number[]) => void) => cb(10, 20, 100, 40)),
  measureLayout: jest.fn(),
});

const handle = (): TargetHandle => ({
  ref: { current: fakeView() },
  scope: null,
  scrollable: null,
});

const TOURS: Record<string, Tour> = {
  t: {
    id: 't',
    steps: [
      { targetId: 'a', title: 'A', description: '' },
      { targetId: 'b', title: 'B', description: '' },
      { targetId: 'c', title: 'C', description: '', when: ctx => !!ctx.showC },
    ],
  },
  w: {
    id: 'w',
    kind: 'walkthrough',
    title: 'Walkthrough',
    canStart: ctx => (ctx.online ? true : 'Go online first'),
    steps: [
      { title: 'Intro', description: '' },
      { targetId: 'a', title: 'A', description: '' },
      { targetId: 'gone', title: 'Gone', description: '' },
    ],
  },
};

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

let engine: TourEngine;
let events: TourEvent[];
const setup = (options = {}) => {
  events = [];
  engine = new TourEngine({
    tours: TOURS,
    missingTargetTimeoutMs: 1000,
    context: { online: true },
    onEvent: e => events.push(e),
    ...options,
  });
  engine.registerTarget('a', handle());
  engine.registerTarget('b', handle());
  return engine;
};

/** Event types with their key detail, for compact assertions. */
const summary = () =>
  events.map(e => {
    switch (e.type) {
      case 'step_shown':
        return `step_shown ${e.stepIndex} (${e.stepNumber}/${e.stepCount})`;
      case 'tour_exited':
        return `tour_exited ${e.reason} @${e.stepIndex}`;
      case 'tour_started':
        return `tour_started ${e.trigger}`;
      case 'tour_paused':
        return `tour_paused ${e.reason} @${e.stepIndex}`;
      case 'target_missing':
        return `target_missing ${e.targetId} → ${e.outcome}`;
      case 'tour_blocked':
        return `tour_blocked ${e.reason}`;
      default:
        return e.type;
    }
  });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  jest.useRealTimers();
});

describe('onEvent', () => {
  it('reports a completed run: started, each step shown, completed', async () => {
    setup();
    engine.startTour('t');
    await advance(200);
    engine.nextStep();
    await advance(200);
    engine.nextStep(); // step c is hidden by `when`: this completes the tour

    expect(summary()).toEqual([
      'tour_started manual',
      'step_shown 0 (1/2)',
      'step_shown 1 (2/2)',
      'tour_completed',
    ]);
    const runIds = new Set(events.map(e => e.runId));
    expect(runIds.size).toBe(1);
    expect(events.every(e => e.tourId === 't' && e.tourKind === 'tour')).toBe(true);
    const started = events[0];
    expect(started.type === 'tour_started' && started.stepCount).toBe(2);
    const shown = events[1];
    expect(shown.type === 'step_shown' && shown.targetId).toBe('a');
  });

  it('gives each run its own runId', async () => {
    setup();
    engine.startTour('t');
    engine.stopTour();
    engine.startTour('t', { force: true });
    const starts = events.filter(e => e.type === 'tour_started');
    expect(starts).toHaveLength(2);
    expect(starts[0].runId).not.toBe(starts[1].runId);
  });

  it('reports where and why a run was left', async () => {
    setup();
    engine.startTour('t');
    await advance(200);
    engine.nextStep();
    await advance(200);
    engine.stopTour(true, 'user');
    expect(summary().slice(-1)).toEqual(['tour_exited user @1']);

    const exited = events[events.length - 1];
    expect(exited.type === 'tour_exited' && exited.durationMs).toBeGreaterThanOrEqual(400);
  });

  it("counts an app's stopTour as 'app'", () => {
    setup();
    engine.startTour('t');
    engine.stopTour();
    expect(summary().slice(-1)).toEqual(['tour_exited app @0']);
  });

  it('sends step_shown once per step, not when the step is shown again', async () => {
    events = [];
    engine = new TourEngine({ tours: TOURS, missingTargetTimeoutMs: 1000, onEvent: e => events.push(e) });
    let y = 20;
    const moving = {
      measureInWindow: jest.fn((cb: (...a: number[]) => void) => cb(10, y, 100, 40)),
      measureLayout: jest.fn(),
    };
    const target = (): TargetHandle => ({ ref: { current: moving }, scope: null, scrollable: null });
    let unregister = engine.registerTarget('a', target());
    engine.startTour('t');
    await advance(200);

    y = 60; // moved: re-presented at the new place
    engine.notifyTargetLayout('a');
    await advance(200);
    unregister(); // its screen lost focus…
    await advance(100);
    unregister = engine.registerTarget('a', target()); // …and came back
    await advance(200);

    expect(engine.getState().presented?.rect?.y).toBe(60);
    expect(summary().filter(s => s.startsWith('step_shown'))).toEqual(['step_shown 0 (1/2)']);
    unregister();
  });

  it('reports a start refused by canStart (with the reason), and nothing else', () => {
    setup({ context: { online: false } });
    engine.startTour('w');
    expect(summary()).toEqual(['tour_blocked Go online first']);
    expect(events[0].tourKind).toBe('walkthrough');
  });

  it('reports a missing target, the pause, the resume and the steps shown again', async () => {
    setup();
    engine.startTour('w');
    await advance(50);
    engine.nextStep();
    await advance(200);
    engine.nextStep(); // "gone" is never registered
    await advance(1100);
    expect(engine.getState().paused).toBe(true);

    engine.resumeTour(); // back to the latest step on screen: "a" (index 1)
    await advance(200);

    expect(summary()).toEqual([
      'tour_started manual',
      'step_shown 0 (1/3)',
      'step_shown 1 (2/3)',
      'target_missing gone → pause',
      'tour_paused target_missing @2',
      'tour_resumed',
      'step_shown 1 (2/3)',
    ]);
  });

  it("reports a tour ended by a missing target as exited with 'target_missing'", async () => {
    setup();
    engine.startTour('t');
    await advance(50);
    engine.nextStep();
    engine.stopTour(); // ignore the first run
    events.length = 0;

    const missingTours: Record<string, Tour> = {
      m: { id: 'm', steps: [{ targetId: 'nowhere', title: 'X', description: '' }] },
    };
    engine.setOptions({ tours: missingTours });
    engine.startTour('m');
    await advance(1100);
    expect(summary()).toEqual([
      'tour_started manual',
      'target_missing nowhere → end',
      'tour_exited target_missing @0',
    ]);
  });

  it("closes the running tour's run as 'replaced' when another starts", async () => {
    setup();
    engine.startTour('t');
    await advance(200);
    engine.startTour('w');
    expect(summary().slice(1, 3)).toEqual(['step_shown 0 (1/2)', 'tour_exited replaced @0']);
    const exited = events[2];
    expect(exited.tourId).toBe('t');
    expect(events[3].type).toBe('tour_started');
    expect(events[3].runId).not.toBe(exited.runId);
  });

  it("marks auto-starts as 'auto'", async () => {
    const tours: Record<string, Tour> = {
      auto: { id: 'auto', autoStart: true, steps: [{ targetId: 'a', title: 'A', description: '' }] },
    };
    setup({ tours });
    await advance(1000);
    expect(summary()[0]).toBe('tour_started auto');
  });

  it('keeps the tour running when the handler throws', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({
      onEvent: () => {
        throw new Error('analytics down');
      },
    });
    engine.startTour('t');
    await advance(200);
    expect(engine.getState().presented?.stepIndex).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
