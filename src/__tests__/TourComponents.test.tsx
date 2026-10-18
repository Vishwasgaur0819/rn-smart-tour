import { createRef, useRef } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  createTourController,
  DapProvider,
  DapScrollView,
  DapTarget,
  TourProvider,
  TourScope,
  TourScrollable,
  TourScrollView,
  TourTarget,
  useTour,
  useTourState,
} from '../index';
import type { TourApi, TourEngineState, Tour } from '../index';

let api: TourApi;
let state: TourEngineState;
const Probe = () => {
  api = useTour();
  state = useTourState(s => s);
  return null;
};

const TOURS: Record<string, Tour> = {
  t: {
    id: 't',
    steps: [
      { targetId: 'save', title: 'Save', description: 'Tap to save' },
      { targetId: 'next', title: 'Next one', description: '' },
    ],
  },
};

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const mockWindowRect = (rect: { x: number; y: number; width: number; height: number }) =>
  jest
    .spyOn(View.prototype as any, 'measureInWindow')
    .mockImplementation((cb: any) => cb(rect.x, rect.y, rect.width, rect.height));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('TourTarget', () => {
  it("is measured when its step starts, and still calls the caller's onLayout", async () => {
    const measure = mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const onLayout = jest.fn();
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save" testID="target" onLayout={onLayout}>
          <Text>Save</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    fireEvent(screen.getByTestId('target'), 'layout', { nativeEvent: { layout: {} } });
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(measure).not.toHaveBeenCalled(); // nothing measured until a step needs it

    act(() => api.startTour('t'));
    await advance(200);
    expect(state.presented?.rect).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(screen.getByText('Tap to save')).toBeTruthy();
  });

  it('cannot be made collapsable by the caller (Android measurement needs a real view)', () => {
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save" testID="target" collapsable>
          <Text>Save</Text>
        </TourTarget>
      </TourProvider>,
    );
    expect(screen.getByTestId('target').props.collapsable).toBe(false);
  });

  it('does not re-render when tours start, stop or targets are measured', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    let renders = 0;
    const Counted = () => {
      renders++;
      return <Text>Save</Text>;
    };
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save">
          <Counted />
        </TourTarget>
        <TourTarget name="next">
          <Text>Second</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    const before = renders;
    act(() => api.startTour('t'));
    await advance(200);
    act(() => api.nextStep());
    await advance(200);
    act(() => api.stopTour());
    expect(renders).toBe(before);
  });

  it('is forgotten when it unmounts', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const { rerender } = render(
      <TourProvider tours={TOURS} missingTargetTimeoutMs={500}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    rerender(
      <TourProvider tours={TOURS} missingTargetTimeoutMs={500}>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(400);
    expect(api.status).toBe('waiting');
    await advance(200);
    expect(api.status).toBe('idle');
  });
});

describe('TourScope', () => {
  it('only lets tours use its targets while active', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const tree = (active: boolean) => (
      <TourProvider tours={TOURS}>
        <TourScope active={active}>
          <TourTarget name="save">
            <Text>Save</Text>
          </TourTarget>
        </TourScope>
        <Probe />
      </TourProvider>
    );
    const { rerender } = render(tree(false));
    act(() => api.startTour('t'));
    await advance(500);
    expect(api.status).toBe('waiting');

    rerender(tree(true));
    await advance(200);
    expect(api.status).toBe('active');

    rerender(tree(false));
    expect(api.status).toBe('waiting');
  });
});

describe('useTour', () => {
  it('re-renders on step changes, not on re-measurements', async () => {
    let y = 20;
    jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, y, 100, 40));
    let renders = 0;
    const Counter = () => {
      useTour();
      renders++;
      return null;
    };
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save" testID="target">
          <Text>Save</Text>
        </TourTarget>
        <Counter />
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(200);
    const afterStart = renders;

    y = 300; // the target moves; its layout event triggers a re-measure
    fireEvent(screen.getByTestId('target'), 'layout', { nativeEvent: { layout: {} } });
    await advance(200);
    expect(state.presented?.rect.y).toBe(300);
    expect(renders).toBe(afterStart);
  });
});

describe('Overlay', () => {
  it('ignores "Next" while the next step is still being measured, so one tap never advances twice', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
        <TourTarget name="next">
          <Text>Second</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(200);
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next')); // second tap lands before step 2 is measured
    expect(api.currentStepIndex).toBe(1);
    expect(api.activeTour?.id).toBe('t');
  });
});

describe('Overlay visibility', () => {
  it('disappears instantly (no Modal fade-out) so an old step is never drawn over a screen that is leaving', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(200);
    expect(screen.UNSAFE_getByType(Modal).props.animationType).toBe('none');

    act(() => api.stopTour());
    expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
  });
});

describe('custom tooltip', () => {
  it('renderTooltip draws the card and drives the tour; backdropColor and tooltipWidth apply', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const renderTooltip = jest.fn((props: any) => (
      <View>
        <Text>{`${props.step.title} ${props.stepIndex + 1}/${props.stepCount}`}</Text>
        <Text onPress={props.next}>my-next</Text>
        <Text onPress={props.skip}>my-skip</Text>
      </View>
    ));
    render(
      <TourProvider
        tours={TOURS}
        renderTooltip={renderTooltip}
        backdropColor="rgba(1, 2, 3, 0.5)"
        tooltipWidth={320}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
        <TourTarget name="next">
          <Text>Second</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(200);

    expect(screen.getByText('Save 1/2')).toBeTruthy();
    expect(screen.queryByText('Skip')).toBeNull(); // built-in card replaced
    expect(renderTooltip.mock.calls.at(-1)?.[0]).toMatchObject({ isFirstStep: true, isLastStep: false });
    const backdrops = screen
      .UNSAFE_getByType(Modal)
      .findAll((node: any) => StyleSheet.flatten(node.props.style)?.backgroundColor === 'rgba(1, 2, 3, 0.5)');
    expect(backdrops.length).toBeGreaterThanOrEqual(4);
    expect(StyleSheet.flatten(screen.getByTestId('rn-smart-tour-tooltip').props.style).width).toBe(320);

    fireEvent.press(screen.getByText('my-next'));
    await advance(200);
    expect(screen.getByText('Next one 2/2')).toBeTruthy();

    fireEvent.press(screen.getByText('my-skip'));
    expect(api.status).toBe('idle');
    expect(api.seenTours.t).toBe(true);
  });

  it('keeps the card invisible until it has been measured, so it never jumps into place', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    render(
      <TourProvider tours={TOURS}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(200);
    const card = screen.getByTestId('rn-smart-tour-tooltip');
    expect(StyleSheet.flatten(card.props.style).opacity).toBe(0);

    fireEvent(card, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 280, height: 140 } } });
    expect(StyleSheet.flatten(screen.getByTestId('rn-smart-tour-tooltip').props.style).opacity).toBe(1);
  });
});

describe('scrolling', () => {
  it('TourScrollView forwards its ref to the inner ScrollView', () => {
    const ref = createRef<ScrollView>();
    render(
      <TourProvider tours={TOURS}>
        <TourScrollView ref={ref} />
      </TourProvider>,
    );
    expect(typeof ref.current?.scrollTo).toBe('function');
  });

  it('TourScrollView works without a TourProvider', () => {
    render(
      <TourScrollView>
        <Text>content</Text>
      </TourScrollView>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('scrolls a target inside a FlatList wrapped in TourScrollable, measuring against its content view', async () => {
    let y = 1200; // window y of the target before scrolling
    jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(0, y, 400, 50));
    const measureLayout = jest
      .spyOn(View.prototype as any, 'measureLayout')
      .mockImplementation((_relativeTo: any, ok: any) => ok(0, 1100, 400, 50));
    const innerView = { name: 'content-view' };
    const scrollTo = jest.fn(() => {
      y = 300; // where the target ends up once scrolled
    });
    const viewport = { measureInWindow: (cb: any) => cb(0, 100, 400, 500) };
    jest.spyOn(FlatList.prototype as any, 'getNativeScrollRef').mockReturnValue({
      scrollTo,
      getInnerViewRef: () => innerView,
      getNativeScrollRef: () => viewport,
    });

    const Screen = () => {
      const listRef = useRef<FlatList>(null);
      return (
        <TourScrollable scrollRef={listRef}>
          <FlatList
            ref={listRef}
            data={['save']}
            keyExtractor={item => item}
            renderItem={({ item }) => (
              <TourTarget name={item}>
                <Text>{item}</Text>
              </TourTarget>
            )}
          />
        </TourScrollable>
      );
    };
    render(
      <TourProvider tours={TOURS}>
        <Screen />
        <Probe />
      </TourProvider>,
    );
    act(() => api.startTour('t'));
    await advance(700);
    expect(measureLayout).toHaveBeenCalledWith(innerView, expect.any(Function), expect.any(Function));
    expect(scrollTo).toHaveBeenCalledWith({ y: 875, animated: true });
    expect(state.presented?.rect.y).toBe(300);
  });
});

describe('createTourController', () => {
  it('starts tours from outside React', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const controller = createTourController({ tours: TOURS });
    render(
      <TourProvider controller={controller}>
        <TourTarget name="save">
          <Text>Save</Text>
        </TourTarget>
      </TourProvider>,
    );
    act(() => controller.startTour('t'));
    await advance(200);
    expect(controller.getState().presented?.tourId).toBe('t');
    expect(screen.getByText('Tap to save')).toBeTruthy();
  });

  it('rejects a controller that was not created by createTourController', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const fake = { ...createTourController({ tours: TOURS }) };
    expect(() => render(<TourProvider controller={fake}>{null}</TourProvider>)).toThrow(
      /createTourController/,
    );
  });
});

describe('1.x names', () => {
  it('DapProvider, DapTarget and DapScrollView still work', async () => {
    mockWindowRect({ x: 10, y: 20, width: 100, height: 40 });
    const ref = createRef<ScrollView>();
    render(
      <DapProvider tours={{ t: { ...TOURS.t, autoStart: true } }}>
        <DapScrollView ref={ref}>
          <DapTarget name="save">
            <Text>Save</Text>
          </DapTarget>
        </DapScrollView>
      </DapProvider>,
    );
    await advance(500);
    expect(screen.getByText('Tap to save')).toBeTruthy();
    expect(typeof ref.current?.scrollTo).toBe('function');
  });
});
