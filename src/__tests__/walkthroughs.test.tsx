import { Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TourEngine } from '../core/TourEngine';
import type { TargetHandle } from '../core/TourEngine';
import { TourProvider, TourTarget, useTour, useTourCatalog, useTourState } from '../index';
import type { TourApi, TourCatalogEntry, TourEngineState, Tour, TourStep } from '../index';
import type { TargetMeasurement as Rect } from '../types';

const RECT: Rect = { x: 10, y: 20, width: 100, height: 40 };

const fakeView = (rect: Rect = RECT) => ({
  measureInWindow: (cb: (...a: number[]) => void) => cb(rect.x, rect.y, rect.width, rect.height),
});
const handle = (view: any = fakeView()): TargetHandle => ({
  ref: { current: view },
  scope: null,
  scrollable: null,
});

const walkthrough = (steps: TourStep[], extra: Partial<Tour> = {}): Tour => ({
  id: 'w',
  kind: 'walkthrough',
  title: 'Apply for leave',
  steps,
  ...extra,
});

const advanceEngine = (ms: number) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('engine', () => {
  let engine: TourEngine;
  afterEach(() => engine?.dispose());

  it('presents a step without a target right away, as a centred card', async () => {
    engine = new TourEngine({
      tours: {
        w: walkthrough([
          { title: 'Intro', description: '' },
          { targetId: 'a', title: 'A', description: '' },
        ]),
      },
    });
    engine.startTour('w');
    expect(engine.getState().presented).toEqual({ tourId: 'w', stepIndex: 0, rect: null, hostId: null });

    engine.registerTarget('a', handle());
    engine.nextStep();
    await advanceEngine(200);
    expect(engine.getState().presented).toMatchObject({ stepIndex: 1, rect: RECT });
  });

  describe("advanceOn: 'press'", () => {
    const tours = {
      w: walkthrough([
        { targetId: 'menu', title: 'Open the menu', description: '', advanceOn: 'press' },
        { targetId: 'leave', title: 'Tap Leave', description: '' },
      ]),
    };

    it('moves on when the shown target is tapped', async () => {
      engine = new TourEngine({ tours });
      engine.registerTarget('menu', handle());
      engine.registerTarget('leave', handle());
      engine.startTour('w');

      engine.notifyTargetPress('menu'); // not shown yet: ignored
      expect(engine.getState().stepIndex).toBe(0);
      await advanceEngine(200);

      engine.notifyTargetPress('leave'); // another target: ignored
      expect(engine.getState().stepIndex).toBe(0);
      engine.notifyTargetPress('menu');
      expect(engine.getState().stepIndex).toBe(1);
    });

    it("ignores taps on steps that don't wait for one", async () => {
      engine = new TourEngine({ tours });
      engine.registerTarget('menu', handle());
      engine.registerTarget('leave', handle());
      engine.startTour('w');
      await advanceEngine(200);
      engine.nextStep();
      await advanceEngine(200);
      engine.notifyTargetPress('leave');
      expect(engine.getState().stepIndex).toBe(1);
    });
  });

  it('advanceOn: { event } moves on when the app emits that event', async () => {
    engine = new TourEngine({
      tours: {
        w: walkthrough([
          { title: 'Pick a type', description: '', advanceOn: { event: 'typeChosen' } },
          { title: 'Done', description: '' },
        ]),
      },
    });
    engine.startTour('w');
    engine.emit('somethingElse');
    expect(engine.getState().stepIndex).toBe(0);
    engine.emit('typeChosen');
    expect(engine.getState().stepIndex).toBe(1);
  });

  describe('when', () => {
    const tours = {
      w: walkthrough([
        { title: 'One', description: '' },
        { title: 'Managers only', description: '', when: ctx => ctx.isManager === true },
        { title: 'Three', description: '' },
      ]),
    };

    it('skips steps whose condition is false, going forwards and back', () => {
      engine = new TourEngine({ tours, context: { isManager: false } });
      engine.startTour('w');
      engine.nextStep();
      expect(engine.getState().stepIndex).toBe(2);
      engine.prevStep();
      expect(engine.getState().stepIndex).toBe(0);
      expect(engine.getShownStepIndexes('w')).toEqual([0, 2]);
    });

    it('shows them when the condition holds', () => {
      engine = new TourEngine({ tours, context: { isManager: true } });
      engine.startTour('w');
      engine.nextStep();
      expect(engine.getState().stepIndex).toBe(1);
    });

    it('starts at the first step that is shown', () => {
      engine = new TourEngine({
        tours: {
          w: walkthrough([
            { title: 'Hidden', description: '', when: () => false },
            { title: 'Shown', description: '' },
          ]),
        },
      });
      engine.startTour('w');
      expect(engine.getState().stepIndex).toBe(1);
    });

    it('treats a throwing condition as shown', () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      engine = new TourEngine({
        tours: {
          w: walkthrough([
            {
              title: 'Broken',
              description: '',
              when: () => {
                throw new Error('bad');
              },
            },
          ]),
        },
      });
      engine.startTour('w');
      expect(engine.getState().tourId).toBe('w');
    });
  });

  describe('canStart', () => {
    it("reports why a requested start was refused, and doesn't start", () => {
      const onStartBlocked = jest.fn();
      const tour = walkthrough([{ title: 'One', description: '' }], {
        canStart: ctx => (ctx.isOnline ? true : 'Connect to the internet first'),
      });
      engine = new TourEngine({ tours: { w: tour }, context: { isOnline: false }, onStartBlocked });
      engine.startTour('w');
      expect(engine.getState().tourId).toBeNull();
      expect(onStartBlocked).toHaveBeenCalledWith(tour, 'Connect to the internet first');

      engine.setOptions({ context: { isOnline: true } });
      engine.startTour('w');
      expect(engine.getState().tourId).toBe('w');
    });

    it('skips a blocked auto-start silently', async () => {
      const onStartBlocked = jest.fn();
      engine = new TourEngine({
        tours: {
          w: walkthrough([{ targetId: 'a', title: 'A', description: '' }], {
            autoStart: true,
            canStart: () => false,
          }),
        },
        onStartBlocked,
      });
      engine.registerTarget('a', handle());
      await advanceEngine(400);
      expect(engine.getState().tourId).toBeNull();
      expect(onStartBlocked).not.toHaveBeenCalled();
    });
  });

  describe('pause and resume', () => {
    const tours = {
      w: walkthrough([
        { title: 'Intro', description: '' },
        { targetId: 'menu', title: 'Open the menu', description: '', advanceOn: 'press' },
        { targetId: 'leave', title: 'Tap Leave', description: '', advanceOn: 'press' },
        { targetId: 'apply', title: 'Tap Apply', description: '' },
      ]),
    };

    it('a walkthrough pauses (instead of ending) when its target goes missing', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      engine = new TourEngine({ tours, missingTargetTimeoutMs: 500 });
      engine.startTour('w');
      engine.nextStep(); // "Open the menu", but the menu isn't on screen
      await advanceEngine(500);
      expect(engine.getState()).toMatchObject({ tourId: 'w', stepIndex: 1, paused: true, presented: null });
    });

    it('resumes at the latest step whose target is on screen', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      engine = new TourEngine({ tours, missingTargetTimeoutMs: 500 });
      engine.registerTarget('menu', handle());
      engine.registerTarget('leave', handle());
      engine.startTour('w');
      engine.nextStep();
      await advanceEngine(200);
      engine.notifyTargetPress('menu');
      await advanceEngine(200);
      engine.notifyTargetPress('leave'); // now on "Tap Apply", whose screen never opens
      await advanceEngine(500);
      expect(engine.getState()).toMatchObject({ stepIndex: 3, paused: true });

      engine.resumeTour();
      expect(engine.getState()).toMatchObject({ stepIndex: 2, paused: false });
      await advanceEngine(200);
      expect(engine.getState().presented?.stepIndex).toBe(2);
    });

    it('resumes from the start when none of the targets is on screen', () => {
      engine = new TourEngine({ tours });
      engine.startTour('w');
      engine.nextStep();
      engine.pauseTour();
      engine.resumeTour();
      expect(engine.getState()).toMatchObject({ stepIndex: 0, paused: false });
    });

    it('stays paused when targets come back (the user resumes it)', async () => {
      engine = new TourEngine({ tours });
      engine.startTour('w');
      engine.nextStep();
      engine.pauseTour();
      engine.registerTarget('menu', handle());
      await advanceEngine(500);
      expect(engine.getState().paused).toBe(true);
    });

    it('ignores app events while paused', () => {
      engine = new TourEngine({
        tours: {
          w: walkthrough([
            { title: 'Pick', description: '', advanceOn: { event: 'picked' } },
            { title: 'Done', description: '' },
          ]),
        },
      });
      engine.startTour('w');
      engine.pauseTour();
      engine.emit('picked');
      expect(engine.getState().stepIndex).toBe(0);
    });
  });

  it('auto-starts on the first step with a target, not a centred intro card', async () => {
    engine = new TourEngine({
      tours: {
        w: walkthrough(
          [
            { title: 'Intro', description: '' },
            { targetId: 'a', title: 'A', description: '' },
          ],
          { autoStart: true },
        ),
      },
    });
    await advanceEngine(400);
    expect(engine.getState().tourId).toBeNull();
    engine.registerTarget('a', handle());
    await advanceEngine(400);
    expect(engine.getState()).toMatchObject({ tourId: 'w', stepIndex: 0 });
  });
});

describe('components', () => {
  let api: TourApi;
  let state: TourEngineState;
  const Probe = () => {
    api = useTour();
    state = useTourState(s => s);
    return null;
  };

  const advance = async (ms: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  };

  const mockWindowRect = () =>
    jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, 20, 100, 40));

  const TOURS: Record<string, Tour> = {
    w: walkthrough([
      { title: "Let's apply for leave", description: 'About a minute.' },
      { targetId: 'apply', title: 'Tap Apply Leave', description: '', advanceOn: 'press' },
      { targetId: 'form', title: 'Fill in the form', description: '' },
    ]),
  };

  const App = ({ presentation }: { presentation?: 'root' | 'modal' }) => (
    <TourProvider tours={TOURS} presentation={presentation}>
      <TourTarget name="apply" testID="apply">
        <Text>Apply Leave</Text>
      </TourTarget>
      <TourTarget name="form">
        <Text>Form</Text>
      </TourTarget>
      <Probe />
    </TourProvider>
  );

  const touch = (testID: string, from: [number, number], to: [number, number]) => {
    const target = screen.getByTestId(testID);
    fireEvent(target, 'touchStart', { nativeEvent: { pageX: from[0], pageY: from[1] } });
    fireEvent(target, 'touchEnd', { nativeEvent: { pageX: to[0], pageY: to[1] } });
  };

  it('a centred step dims the whole screen and has no cutout', async () => {
    mockWindowRect();
    render(<App />);
    act(() => api.startTour('w'));
    await advance(100);
    expect(screen.getByText("Let's apply for leave")).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-cutout-blocker')).toBeNull();
    expect(screen.queryByTestId('rn-smart-tour-action-ring')).toBeNull();
  });

  it('an action step lets the tap through, rings the target, hides Next, and moves on when tapped', async () => {
    mockWindowRect();
    render(<App />);
    act(() => api.startTour('w'));
    await advance(100);
    fireEvent.press(screen.getByText('Next'));
    await advance(200);

    expect(screen.getByText('Tap Apply Leave')).toBeTruthy();
    expect(screen.getByTestId('rn-smart-tour-action-ring')).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-cutout-blocker')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
    expect(screen.getByText('Tap the highlighted item to continue.')).toBeTruthy();
    expect(screen.getByText('Exit')).toBeTruthy(); // walkthroughs say Exit, not Skip

    touch('apply', [50, 40], [80, 90]); // a drag, not a tap
    expect(state.stepIndex).toBe(1);
    touch('apply', [50, 40], [52, 41]);
    expect(state.stepIndex).toBe(2);
  });

  it('a normal step blocks taps on the highlighted element', async () => {
    mockWindowRect();
    render(<App />);
    act(() => api.startTour('w'));
    act(() => {
      api.nextStep();
      api.nextStep();
    });
    await advance(200);
    expect(state.presented?.stepIndex).toBe(2);
    expect(screen.getByTestId('rn-smart-tour-cutout-blocker')).toBeTruthy();
  });

  it("presentation='modal' can't let taps through, so an action step gets a Next button", async () => {
    mockWindowRect();
    render(<App presentation="modal" />);
    act(() => api.startTour('w'));
    act(() => api.nextStep());
    await advance(200);
    expect(screen.getByText('Tap Apply Leave')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-action-ring')).toBeNull();
  });

  it('shows a resume chip while paused; it resumes or dismisses the tour', async () => {
    mockWindowRect();
    render(<App />);
    act(() => api.startTour('w'));
    act(() => api.pauseTour());
    expect(api.status).toBe('paused');
    expect(screen.getByText('Resume: Apply for leave')).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-overlay')).toBeNull();

    fireEvent.press(screen.getByText('Resume: Apply for leave'));
    await advance(100);
    expect(api.status).toBe('active');
    expect(screen.queryByTestId('rn-smart-tour-resume-chip')).toBeNull();

    act(() => api.pauseTour());
    fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(api.status).toBe('idle');
    expect(api.seenTours.w).toBeUndefined();
  });

  it('counts only the shown steps in the step indicator', async () => {
    mockWindowRect();
    render(
      <TourProvider
        context={{ isManager: false }}
        tours={{
          t: {
            id: 't',
            steps: [
              { title: 'One', description: '' },
              { title: 'Managers', description: '', when: ctx => !!ctx.isManager },
              { title: 'Three', description: '' },
            ],
          },
        }}>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(100);
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('useTourCatalog lists titled tours, by kind and search words (title, description, keywords)', () => {
    let catalog: TourCatalogEntry[] = [];
    let walkthroughs: TourCatalogEntry[] = [];
    let search: TourCatalogEntry[] = [];
    const Catalog = () => {
      catalog = useTourCatalog();
      walkthroughs = useTourCatalog({ kind: 'walkthrough' });
      search = useTourCatalog({ query: 'SICK day' });
      return null;
    };
    render(
      <TourProvider
        tours={{
          leave: walkthrough([{ title: 'x', description: '' }], {
            id: 'leave',
            title: 'Apply for leave',
            keywords: ['holiday', 'sick day'],
          }),
          mtp: walkthrough([{ title: 'x', description: '' }], { id: 'mtp', title: 'Submit your MTP' }),
          intro: { id: 'intro', title: 'Dashboard tour', steps: [{ title: 'x', description: '' }] },
          untitled: { id: 'untitled', steps: [{ title: 'x', description: '' }] },
        }}>
        <Catalog />
      </TourProvider>,
    );
    expect(catalog.map(entry => entry.id)).toEqual(['leave', 'mtp', 'intro']);
    expect(walkthroughs.map(entry => entry.id)).toEqual(['leave', 'mtp']);
    expect(search.map(entry => entry.id)).toEqual(['leave']);
    expect(catalog[2]).toEqual({
      id: 'intro',
      title: 'Dashboard tour',
      description: undefined,
      kind: 'tour',
    });
  });

  it('onStartBlocked receives the reason from canStart', () => {
    const onStartBlocked = jest.fn();
    render(
      <TourProvider
        context={{ isOnline: false }}
        onStartBlocked={onStartBlocked}
        tours={{
          w: walkthrough([{ title: 'x', description: '' }], {
            canStart: ctx => (ctx.isOnline ? true : 'You are offline'),
          }),
        }}>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('w'));
    expect(api.status).toBe('idle');
    expect(onStartBlocked).toHaveBeenCalledWith(expect.objectContaining({ id: 'w' }), 'You are offline');
  });
});
