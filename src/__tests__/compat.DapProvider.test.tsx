import { useEffect } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { DapProvider, useDap } from '../compat';
import type { DapContextType, StorageAdapter, TargetMeasurement, Tour } from '../types';

const MEASUREMENT: TargetMeasurement = { x: 10, y: 20, width: 100, height: 40 };

/** Registers a target directly with the provider, bypassing native measurement. */
const FakeTarget = ({ name }: { name: string }) => {
  const { registerTarget, unregisterTarget } = useDap();
  useEffect(() => {
    const ref = {
      measureInWindow: (cb: (...args: number[]) => void) =>
        cb(MEASUREMENT.x, MEASUREMENT.y, MEASUREMENT.width, MEASUREMENT.height),
    };
    registerTarget(name, MEASUREMENT, ref);
    return () => unregisterTarget(name);
  }, [name, registerTarget, unregisterTarget]);
  return null;
};

/** Exposes the latest context value to the test. */
let ctx: DapContextType;
const Probe = () => {
  ctx = useDap();
  return null;
};

const TOURS: Record<string, Tour> = {
  intro: {
    id: 'intro',
    autoStart: true,
    steps: [
      { targetId: 'a', title: 'Step A', description: 'First' },
      { targetId: 'b', title: 'Step B', description: 'Second' },
    ],
  },
  manual: {
    id: 'manual',
    steps: [{ targetId: 'a', title: 'Manual', description: 'Only' }],
  },
};

const memoryStorage = (initial: Record<string, boolean> = {}) => {
  const data: Record<string, string> = { '@rn-dap:seen_tours': JSON.stringify(initial) };
  const adapter: StorageAdapter = {
    getItem: jest.fn(async (key: string) => data[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
  return { adapter, data };
};

const flush = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('DapProvider', () => {
  it('auto-starts a tour once its first target is registered', async () => {
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <Probe />
      </DapProvider>,
    );
    expect(ctx.activeTour).toBeNull();
    await flush(400);
    expect(ctx.activeTour?.id).toBe('intro');
    expect(screen.getByText('Step A')).toBeTruthy();
  });

  it('ends the tour (unseen) when a step target never appears, instead of hanging invisibly', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <DapProvider tours={TOURS} missingTargetTimeoutMs={1000}>
        <FakeTarget name="a" />
        <Probe />
      </DapProvider>,
    );
    await flush(400);
    expect(ctx.activeTour?.id).toBe('intro');

    act(() => ctx.nextStep()); // step B's target is not mounted
    await flush(999);
    expect(ctx.activeTour?.id).toBe('intro');
    await flush(1);
    expect(ctx.activeTour).toBeNull();
    expect(ctx.seenTours.intro).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"b"'));

    // Not auto-restarted in the same session, even though it is still unseen.
    await flush(1000);
    expect(ctx.activeTour).toBeNull();
  });

  it('handles two quick "Next" calls without stepping past the last step', async () => {
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <Probe />
      </DapProvider>,
    );
    await flush(400);
    act(() => {
      ctx.nextStep();
      ctx.nextStep(); // same tick: previously both read index 0
    });
    expect(ctx.activeTour).toBeNull();
    expect(ctx.seenTours.intro).toBe(true);
  });

  it('prevStep never goes below the first step', async () => {
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <Probe />
      </DapProvider>,
    );
    await flush(400);
    act(() => {
      ctx.nextStep();
      ctx.prevStep();
      ctx.prevStep();
    });
    expect(ctx.currentStepIndex).toBe(0);
    expect(ctx.activeTour?.id).toBe('intro');
  });

  it('does not replay a seen tour unless forced', async () => {
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <Probe />
      </DapProvider>,
    );
    act(() => ctx.startTour('manual'));
    act(() => ctx.nextStep()); // finish
    expect(ctx.seenTours.manual).toBe(true);

    act(() => ctx.startTour('manual'));
    expect(ctx.activeTour).toBeNull();

    act(() => ctx.startTour('manual', { force: true }));
    expect(ctx.activeTour?.id).toBe('manual');
  });

  it('resetTour makes a tour eligible to auto-start again and persists it', async () => {
    const { adapter, data } = memoryStorage({ intro: true });
    render(
      <DapProvider tours={TOURS} storageAdapter={adapter}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <Probe />
      </DapProvider>,
    );
    await flush(400);
    expect(ctx.activeTour).toBeNull();

    act(() => ctx.resetTour('intro'));
    await flush(400);
    expect(ctx.activeTour?.id).toBe('intro');
    expect(JSON.parse(data['@rn-dap:seen_tours'])).toEqual({});
  });

  it('resetAll clears every seen tour', async () => {
    const { adapter, data } = memoryStorage({ intro: true, manual: true });
    render(
      <DapProvider tours={TOURS} storageAdapter={adapter}>
        <Probe />
      </DapProvider>,
    );
    await flush();
    act(() => ctx.resetAll());
    await flush();
    expect(ctx.seenTours).toEqual({});
    expect(JSON.parse(data['@rn-dap:seen_tours'])).toEqual({});
  });

  describe('storage', () => {
    it('queues startTour until storage has loaded, then respects the stored seen state', async () => {
      let resolveLoad: (value: string | null) => void = () => {};
      const adapter: StorageAdapter = {
        getItem: jest.fn(() => new Promise<string | null>(r => (resolveLoad = r))),
        setItem: jest.fn(),
      };
      render(
        <DapProvider tours={TOURS} storageAdapter={adapter}>
          <FakeTarget name="a" />
          <Probe />
        </DapProvider>,
      );
      act(() => ctx.startTour('manual'));
      expect(ctx.activeTour).toBeNull(); // still loading

      await act(async () => resolveLoad(JSON.stringify({ manual: true })));
      expect(ctx.activeTour).toBeNull(); // already seen, so the queued start is ignored
    });

    it('runs a queued startTour once storage loads when the tour is unseen', async () => {
      let resolveLoad: (value: string | null) => void = () => {};
      const adapter: StorageAdapter = {
        getItem: jest.fn(() => new Promise<string | null>(r => (resolveLoad = r))),
        setItem: jest.fn(),
      };
      render(
        <DapProvider tours={TOURS} storageAdapter={adapter}>
          <FakeTarget name="a" />
          <Probe />
        </DapProvider>,
      );
      act(() => ctx.startTour('manual'));
      await act(async () => resolveLoad(null));
      expect(ctx.activeTour?.id).toBe('manual');
    });

    it('loads storage once even when the adapter is passed as a new object every render', async () => {
      const getItem = jest.fn(async () => null);
      const setItem = jest.fn();
      const { rerender } = render(
        <DapProvider tours={TOURS} storageAdapter={{ getItem, setItem }}>
          <Probe />
        </DapProvider>,
      );
      await flush();
      rerender(
        <DapProvider tours={TOURS} storageAdapter={{ getItem, setItem }}>
          <Probe />
        </DapProvider>,
      );
      await flush();
      expect(getItem).toHaveBeenCalledTimes(1);
    });

    it('treats corrupt stored data as empty', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const adapter: StorageAdapter = { getItem: () => '{not json', setItem: jest.fn() };
      render(
        <DapProvider tours={TOURS} storageAdapter={adapter}>
          <FakeTarget name="a" />
          <Probe />
        </DapProvider>,
      );
      await flush(); // storage load resolves
      await flush(400); // auto-start debounce, then measuring the target
      expect(error).toHaveBeenCalled();
      expect(ctx.activeTour?.id).toBe('intro');
    });

    it('survives a storage adapter whose setItem throws synchronously', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const adapter: StorageAdapter = {
        getItem: () => null,
        setItem: () => {
          throw new Error('disk full');
        },
      };
      render(
        <DapProvider tours={TOURS} storageAdapter={adapter}>
          <FakeTarget name="a" />
          <Probe />
        </DapProvider>,
      );
      await flush();
      act(() => ctx.startTour('manual'));
      act(() => ctx.nextStep());
      await flush();
      expect(ctx.seenTours.manual).toBe(true);
      expect(error).toHaveBeenCalledWith('[rn-smart-tour] failed to save storage', expect.any(Error));
    });
  });

  it('sizes the overlay from the window, not from the Modal container (New Architecture)', async () => {
    let window = { width: 0, height: 0 };
    const WindowProbe = () => {
      window = useWindowDimensions();
      return null;
    };
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <WindowProbe />
      </DapProvider>,
    );
    await flush(400);
    const container = screen.UNSAFE_getByType(Modal).findAllByType(View)[0];
    expect(StyleSheet.flatten(container.props.style)).toMatchObject({
      width: window.width,
      height: window.height,
    });
  });

  it('dismisses the tour on Android back (Modal onRequestClose), like Skip', async () => {
    render(
      <DapProvider tours={TOURS}>
        <FakeTarget name="a" />
        <FakeTarget name="b" />
        <Probe />
      </DapProvider>,
    );
    await flush(400);
    const modal = screen.UNSAFE_getByType(Modal);
    act(() => modal.props.onRequestClose());
    expect(ctx.activeTour).toBeNull();
    expect(ctx.seenTours.intro).toBe(true);
  });
});
