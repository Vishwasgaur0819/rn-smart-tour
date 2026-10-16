import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { TourProvider, TourTarget, useTour } from '../index';
import type { TourApi } from '../index';
import { NavigationTourScope } from '../react-navigation';

/** A controllable stand-in for a screen's navigation object and focus state. */
const mockNav = {
  focused: true,
  type: 'stack',
  listeners: {} as Record<string, Array<() => void>>,
  emit(event: string) {
    (this.listeners[event] ?? []).forEach(listener => listener());
  },
};

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockNav.focused,
  useNavigation: () => ({
    getState: () => ({ type: mockNav.type }),
    addListener: (event: string, callback: () => void) => {
      (mockNav.listeners[event] ??= []).push(callback);
      return () => {
        mockNav.listeners[event] = mockNav.listeners[event].filter(cb => cb !== callback);
      };
    },
  }),
}));

let api: TourApi;
const Probe = () => {
  api = useTour();
  return null;
};

const TOURS = { t: { id: 't', steps: [{ targetId: 'save', title: 'Save', description: '' }] } };

const Screen = () => (
  <NavigationTourScope>
    <TourTarget name="save">
      <Text>Save</Text>
    </TourTarget>
  </NavigationTourScope>
);

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockNav.focused = true;
  mockNav.type = 'stack';
  mockNav.listeners = {};
  jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, 20, 100, 40));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits for the screen transition to end before showing a step', async () => {
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => mockNav.emit('transitionStart'));
  act(() => api.startTour('t'));
  await advance(500);
  expect(api.status).toBe('waiting');

  act(() => mockNav.emit('transitionEnd'));
  await advance(200);
  expect(api.status).toBe('active');
});

it('ignores targets on a screen that is not focused', async () => {
  mockNav.focused = false;
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => api.startTour('t'));
  await advance(500);
  expect(api.status).toBe('waiting');
});

it('stops waiting if a transition never reports its end', async () => {
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => mockNav.emit('transitionStart'));
  act(() => api.startTour('t'));
  await advance(900);
  expect(api.status).toBe('waiting');
  await advance(200); // the 1000ms fallback fires; React applies it when act() returns
  await advance(200); // measuring
  expect(api.status).toBe('active');
});

it('is not ready right after the screen gains focus, so a late transitionStart cannot cause a flash', async () => {
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => api.startTour('t'));
  await advance(150);
  expect(api.status).toBe('waiting');

  // Native stack reports the push animation a few frames after focus.
  act(() => mockNav.emit('transitionStart'));
  await advance(400);
  expect(api.status).toBe('waiting');

  act(() => mockNav.emit('transitionEnd'));
  await advance(200);
  expect(api.status).toBe('active');
});

it('outside a stack (tabs, drawer), becomes ready after a short grace period', async () => {
  mockNav.type = 'tab';
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => api.startTour('t'));
  await advance(250);
  expect(api.status).toBe('waiting');
  await advance(100); // grace ends; React applies it when act() returns
  await advance(200); // measuring
  expect(api.status).toBe('active');
});

it('in a stack, waits for transitionEnd even when the animation starts long after focus', async () => {
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => api.startTour('t'));
  await advance(800);
  expect(api.status).toBe('waiting');

  act(() => mockNav.emit('transitionStart'));
  await advance(300);
  expect(api.status).toBe('waiting');
  act(() => mockNav.emit('transitionEnd'));
  await advance(200);
  expect(api.status).toBe('active');
});

it('in a stack, stops waiting if no transition is ever reported', async () => {
  render(
    <TourProvider tours={TOURS}>
      <Screen />
      <Probe />
    </TourProvider>,
  );
  act(() => api.startTour('t'));
  await advance(1400);
  expect(api.status).toBe('waiting');
  await advance(200); // the 1500ms fallback fires; React applies it when act() returns
  await advance(200); // measuring
  expect(api.status).toBe('active');
});
