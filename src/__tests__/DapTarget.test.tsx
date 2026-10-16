import { createRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DapProvider } from '../DapProvider';
import { DapTarget } from '../DapTarget';
import { DapScrollView } from '../DapScrollView';
import { useDap } from '../useDap';
import type { DapContextType, Tour } from '../types';

// The test renderer has no native node handles; auto-scroll needs non-null ones.
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
  ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
  findNodeHandle: jest.fn(() => 1),
}));

let ctx: DapContextType;
const Probe = () => {
  ctx = useDap();
  return null;
};

const TOURS: Record<string, Tour> = {
  t: { id: 't', steps: [{ targetId: 'save', title: 'Save', description: 'Tap to save' }] },
};

const LAYOUT_EVENT = { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 40 } } };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('DapTarget', () => {
  it("measures the target even when the caller passes its own onLayout, and still calls the caller's", async () => {
    const measureInWindow = jest
      .spyOn(View.prototype as any, 'measureInWindow')
      .mockImplementation((cb: any) => cb(10, 20, 100, 40));
    const onLayout = jest.fn();

    render(
      <DapProvider tours={TOURS}>
        <DapTarget name="save" testID="target" onLayout={onLayout}>
          <Text>Save</Text>
        </DapTarget>
        <Probe />
      </DapProvider>,
    );

    fireEvent(screen.getByTestId('target'), 'layout', LAYOUT_EVENT);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(measureInWindow).toHaveBeenCalled();
    expect(ctx.targets.save).toEqual({ x: 10, y: 20, width: 100, height: 40 });
  });

  it('cannot be made collapsable by the caller (Android measurement needs a real view)', () => {
    render(
      <DapProvider tours={TOURS}>
        <DapTarget name="save" testID="target" collapsable>
          <Text>Save</Text>
        </DapTarget>
      </DapProvider>,
    );
    expect(screen.getByTestId('target').props.collapsable).toBe(false);
  });

  it('unregisters on unmount', async () => {
    jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, 20, 100, 40));
    const { rerender } = render(
      <DapProvider tours={TOURS}>
        <DapTarget name="save" testID="target">
          <Text>Save</Text>
        </DapTarget>
        <Probe />
      </DapProvider>,
    );
    fireEvent(screen.getByTestId('target'), 'layout', LAYOUT_EVENT);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(ctx.targets.save).toBeDefined();

    rerender(
      <DapProvider tours={TOURS}>
        <Probe />
      </DapProvider>,
    );
    expect(ctx.targets.save).toBeUndefined();
  });
});

describe('DapScrollView', () => {
  it('forwards its ref to the inner ScrollView', () => {
    const ref = createRef<ScrollView>();
    render(
      <DapProvider tours={TOURS}>
        <DapScrollView ref={ref} />
      </DapProvider>,
    );
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.scrollTo).toBe('function');
  });

  it('works without a DapProvider (renders a plain ScrollView)', () => {
    render(
      <DapScrollView testID="scroll">
        <Text>content</Text>
      </DapScrollView>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('re-measures the active target after auto-scrolling it into view', async () => {
    let y = 900; // below the fold before scrolling
    jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, y, 100, 40));
    jest.spyOn(View.prototype as any, 'measureLayout').mockImplementation((_rel: any, ok: any) => ok(0, 900));
    const scrollTo = jest.spyOn(ScrollView.prototype as any, 'scrollTo').mockImplementation(() => {
      y = 100; // where the target ends up once the scroll has finished
    });

    render(
      <DapProvider tours={TOURS}>
        <DapScrollView>
          <DapTarget name="save" testID="target">
            <Text>Save</Text>
          </DapTarget>
        </DapScrollView>
        <Probe />
      </DapProvider>,
    );
    fireEvent(screen.getByTestId('target'), 'layout', LAYOUT_EVENT);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(ctx.targets.save.y).toBe(900);

    act(() => ctx.startTour('t'));
    await act(async () => {
      jest.advanceTimersByTime(700);
    });

    expect(scrollTo).toHaveBeenCalledWith({ y: 800, animated: true });
    expect(ctx.targets.save.y).toBe(100); // highlight follows the target
  });

  it("measures relative to the ScrollView's content container ref (required on the New Architecture)", async () => {
    const innerView = { name: 'inner-content-view' };
    jest.spyOn(ScrollView.prototype as any, 'getInnerViewRef').mockReturnValue(innerView);
    jest
      .spyOn(View.prototype as any, 'measureInWindow')
      .mockImplementation((cb: any) => cb(10, 900, 100, 40));
    const measureLayout = jest
      .spyOn(View.prototype as any, 'measureLayout')
      .mockImplementation((_rel: any, ok: any) => ok(0, 900));

    render(
      <DapProvider tours={TOURS}>
        <DapScrollView>
          <DapTarget name="save" testID="target">
            <Text>Save</Text>
          </DapTarget>
        </DapScrollView>
        <Probe />
      </DapProvider>,
    );
    fireEvent(screen.getByTestId('target'), 'layout', LAYOUT_EVENT);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    act(() => ctx.startTour('t'));

    expect(measureLayout).toHaveBeenCalledWith(innerView, expect.any(Function), expect.any(Function));
  });
});
