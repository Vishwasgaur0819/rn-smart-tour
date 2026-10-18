import { TourEngine } from '../core/TourEngine';
import type { ScopeHandle, ScrollableHandle, TargetHandle } from '../core/TourEngine';
import type { TargetMeasurement as Rect, Tour } from '../types';

const RECT: Rect = { x: 10, y: 20, width: 100, height: 40 };

/** A fake host view whose window position is whatever `rect()` returns at call time. */
const fakeView = (rect: () => Rect | null = () => RECT) => ({
  measureInWindow: jest.fn((cb: (...a: number[]) => void) => {
    const r = rect();
    cb(r?.x ?? 0, r?.y ?? 0, r?.width ?? 0, r?.height ?? 0);
  }),
  measureLayout: jest.fn(),
});

const handle = (view: any, extra: Partial<TargetHandle> = {}): TargetHandle => ({
  ref: { current: view },
  scope: null,
  scrollable: null,
  ...extra,
});

const TOURS: Record<string, Tour> = {
  t: {
    id: 't',
    steps: [
      { targetId: 'a', title: 'A', description: '' },
      { targetId: 'b', title: 'B', description: '' },
    ],
  },
};

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

let engine: TourEngine;
const setup = (tours = TOURS, options = {}) => {
  engine = new TourEngine({ tours, missingTargetTimeoutMs: 1000, ...options });
  return engine;
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('measuring', () => {
  it('measures nothing on registration, only when the step starts', async () => {
    setup();
    const view = fakeView();
    engine.registerTarget('a', handle(view));
    await advance(1000);
    expect(view.measureInWindow).not.toHaveBeenCalled();

    engine.startTour('t');
    await advance(200);
    expect(view.measureInWindow).toHaveBeenCalled();
    expect(engine.getState().presented).toEqual({ tourId: 't', stepIndex: 0, rect: RECT });
  });

  it('registering targets does not notify subscribers (no re-renders)', async () => {
    setup();
    const listener = jest.fn();
    engine.subscribe(listener);
    const unregister = engine.registerTarget('a', handle(fakeView()));
    engine.registerTarget('b', handle(fakeView()));
    unregister();
    await advance(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('waits for a moving target to settle before presenting it', async () => {
    setup();
    let y = 300;
    // Slides up 40pt per measurement until it reaches y=100, like a screen animating in.
    const view = fakeView(() => {
      const rect = { ...RECT, y };
      y = Math.max(100, y - 40);
      return rect;
    });
    engine.registerTarget('a', handle(view));
    engine.startTour('t');
    await advance(400);
    expect(engine.getState().presented?.rect.y).toBe(100);
  });

  it('retries a target that has no size yet, and presents it once it does', async () => {
    setup();
    let rect: Rect | null = null;
    engine.registerTarget('a', handle(fakeView(() => rect)));
    engine.startTour('t');
    await advance(700);
    expect(engine.getState().presented).toBeNull();
    expect(engine.getState().tourId).toBe('t');

    rect = RECT;
    await advance(400);
    expect(engine.getState().presented?.rect).toEqual(RECT);
  });

  it('re-measures the shown target on request, without notifying when nothing moved', async () => {
    setup();
    let rect = RECT;
    engine.registerTarget('a', handle(fakeView(() => rect)));
    engine.startTour('t');
    await advance(200);

    const listener = jest.fn();
    engine.subscribe(listener);
    engine.requestRemeasure();
    await advance(200);
    expect(listener).not.toHaveBeenCalled();

    rect = { ...RECT, y: 500 };
    engine.requestRemeasure();
    await advance(200);
    expect(engine.getState().presented?.rect.y).toBe(500);
  });

  it('keeps the previous step drawn while the next one is measured (no flicker)', async () => {
    setup();
    engine.registerTarget('a', handle(fakeView()));
    engine.registerTarget('b', handle(fakeView(() => ({ ...RECT, y: 400 }))));
    engine.startTour('t');
    await advance(200);

    engine.nextStep();
    expect(engine.getState().stepIndex).toBe(1);
    expect(engine.getState().presented?.stepIndex).toBe(0);
    await advance(200);
    expect(engine.getState().presented).toMatchObject({ stepIndex: 1, rect: { y: 400 } });
  });

  it('cancels measuring when the tour stops', async () => {
    setup();
    engine.registerTarget('a', handle(fakeView()));
    engine.startTour('t');
    engine.stopTour();
    await advance(500);
    expect(engine.getState().presented).toBeNull();
  });
});

describe('missing and disappearing targets', () => {
  it('hides the step when its target unmounts, and shows it again when it comes back', async () => {
    setup();
    const unregister = engine.registerTarget('a', handle(fakeView()));
    engine.startTour('t');
    await advance(200);
    expect(engine.getState().presented).not.toBeNull();

    unregister();
    expect(engine.getState().presented).toBeNull();
    expect(engine.getState().tourId).toBe('t');

    engine.registerTarget('a', handle(fakeView()));
    await advance(200);
    expect(engine.getState().presented?.stepIndex).toBe(0);
  });

  it('ends the tour unseen if the target does not come back in time', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    setup();
    const unregister = engine.registerTarget('a', handle(fakeView()));
    engine.startTour('t');
    await advance(200);
    unregister();
    await advance(1000);
    expect(engine.getState().tourId).toBeNull();
    expect(engine.getState().seen.t).toBeUndefined();
  });

  it("onMissingTarget: 'skip' moves on to the next step; targetTimeoutMs overrides the provider default", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setup({
      t: {
        id: 't',
        steps: [
          { targetId: 'missing', title: '', description: '', onMissingTarget: 'skip', targetTimeoutMs: 200 },
          { targetId: 'b', title: 'B', description: '' },
        ],
      },
    });
    engine.registerTarget('b', handle(fakeView()));
    engine.startTour('t');
    await advance(199);
    expect(engine.getState().stepIndex).toBe(0);
    await advance(300);
    expect(engine.getState().presented?.stepIndex).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping the step'));
  });
});

describe('scopes', () => {
  it('ignores targets in an inactive scope until the scope becomes ready', async () => {
    setup();
    const scope: ScopeHandle = { ready: false, parent: null };
    engine.registerTarget('a', handle(fakeView(), { scope }));
    engine.startTour('t');
    await advance(500);
    expect(engine.getState().presented).toBeNull();

    scope.ready = true;
    engine.notifyScopeChanged();
    await advance(200);
    expect(engine.getState().presented?.stepIndex).toBe(0);
  });

  it('a scope is only ready if its parents are', async () => {
    setup();
    const parent: ScopeHandle = { ready: false, parent: null };
    const child: ScopeHandle = { ready: true, parent };
    engine.registerTarget('a', handle(fakeView(), { scope: child }));
    engine.startTour('t');
    await advance(500);
    expect(engine.getState().presented).toBeNull();
  });

  it('hides the shown step when its scope stops being ready (e.g. navigating away)', async () => {
    setup();
    const scope: ScopeHandle = { ready: true, parent: null };
    engine.registerTarget('a', handle(fakeView(), { scope }));
    engine.startTour('t');
    await advance(200);

    scope.ready = false;
    engine.notifyScopeChanged();
    expect(engine.getState().presented).toBeNull();
  });

  it('uses the target in the ready scope when several share a name', async () => {
    setup();
    const background: ScopeHandle = { ready: false, parent: null };
    const focused: ScopeHandle = { ready: true, parent: null };
    engine.registerTarget(
      'a',
      handle(
        fakeView(() => ({ ...RECT, y: 999 })),
        { scope: focused },
      ),
    );
    engine.registerTarget(
      'a',
      handle(
        fakeView(() => ({ ...RECT, y: 1 })),
        { scope: background },
      ),
    );
    engine.startTour('t');
    await advance(200);
    expect(engine.getState().presented?.rect.y).toBe(999);
  });

  it('warns once, in development, when several ready targets share a name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setup();
    engine.registerTarget('a', handle(fakeView()));
    engine.registerTarget('a', handle(fakeView()));
    engine.startTour('t');
    await advance(200);
    engine.requestRemeasure();
    await advance(200);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('targets named "a"'))).toHaveLength(1);
  });
});

describe('beforeEnter', () => {
  it('waits for beforeEnter (e.g. navigation) before looking for the target', async () => {
    let resolveNavigation = () => {};
    const navigated = new Promise<void>(r => (resolveNavigation = r));
    setup({
      t: { id: 't', steps: [{ targetId: 'a', title: '', description: '', beforeEnter: () => navigated }] },
    });
    // A target with the same name exists before navigating; it must not be used.
    engine.registerTarget(
      'a',
      handle(
        fakeView(() => ({ ...RECT, y: 1 })),
        { scope: { ready: true, parent: null } },
      ),
    );
    engine.startTour('t');
    await advance(500);
    expect(engine.getState().presented).toBeNull();

    engine.registerTarget('a', handle(fakeView(() => ({ ...RECT, y: 2 }))));
    resolveNavigation();
    await advance(200);
    expect(engine.getState().presented?.rect.y).toBe(2);
  });

  it('still looks for the target if beforeEnter throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    setup({
      t: {
        id: 't',
        steps: [
          {
            targetId: 'a',
            title: '',
            description: '',
            beforeEnter: () => {
              throw new Error('nav failed');
            },
          },
        ],
      },
    });
    engine.registerTarget('a', handle(fakeView()));
    engine.startTour('t');
    await advance(200);
    expect(engine.getState().presented).not.toBeNull();
  });
});

describe('auto-scroll', () => {
  /** A fake ScrollView whose content moves when scrolled. */
  const scrollSetup = (targetContentY: number) => {
    const viewport: Rect = { x: 0, y: 100, width: 400, height: 500 };
    let offset = 0;
    const innerView = {};
    const scrollView = {
      scrollTo: jest.fn(({ y }: { y: number }) => {
        offset = y;
      }),
      getInnerViewRef: () => innerView,
      getNativeScrollRef: () => fakeView(() => viewport),
    };
    const target = fakeView(() => ({
      x: 0,
      y: viewport.y + targetContentY - offset,
      width: 400,
      height: 50,
    }));
    target.measureLayout.mockImplementation((relativeTo: any, ok: any) => {
      expect(relativeTo).toBe(innerView);
      ok(0, targetContentY, 400, 50);
    });
    const scrollable: ScrollableHandle = { ref: { current: scrollView }, horizontal: false };
    return { scrollView, target, scrollable };
  };

  it('scrolls an off-screen target to the middle of the list, then measures it there', async () => {
    setup();
    const { scrollView, target, scrollable } = scrollSetup(1200);
    engine.registerTarget('a', handle(target, { scrollable }));
    engine.startTour('t');
    await advance(600);
    // Centered: 1200 - (500 - 50) / 2
    expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 975, animated: true });
    expect(engine.getState().presented?.rect.y).toBe(100 + 1200 - 975);
  });

  it('does not scroll a target that is already visible', async () => {
    setup();
    const { scrollView, target, scrollable } = scrollSetup(200);
    engine.registerTarget('a', handle(target, { scrollable }));
    engine.startTour('t');
    await advance(600);
    expect(scrollView.scrollTo).not.toHaveBeenCalled();
    expect(engine.getState().presented?.rect.y).toBe(300);
  });

  it('works with a FlatList-style ref that exposes its ScrollView via getNativeScrollRef', async () => {
    setup();
    const { scrollView, target } = scrollSetup(1200);
    const flatList = { getNativeScrollRef: () => scrollView };
    engine.registerTarget(
      'a',
      handle(target, { scrollable: { ref: { current: flatList }, horizontal: false } }),
    );
    engine.startTour('t');
    await advance(600);
    expect(scrollView.scrollTo).toHaveBeenCalled();
  });
});

describe('auto-start', () => {
  it('starts an auto-start tour once its first target is registered in a ready scope', async () => {
    setup({ t: { ...TOURS.t, autoStart: true } });
    const scope: ScopeHandle = { ready: false, parent: null };
    engine.registerTarget('a', handle(fakeView(), { scope }));
    await advance(1000);
    expect(engine.getState().tourId).toBeNull();

    scope.ready = true;
    engine.notifyScopeChanged();
    await advance(300);
    expect(engine.getState().tourId).toBe('t');
  });
});
