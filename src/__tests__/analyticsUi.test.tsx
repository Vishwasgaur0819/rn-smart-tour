import { Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createTourController, TourProvider, TourTarget, useTour } from '../index';
import type { TourApi, Tour, TourEvent } from '../index';

let api: TourApi;
const Probe = () => {
  api = useTour();
  return null;
};

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(View.prototype as any, 'measureInWindow').mockImplementation((cb: any) => cb(10, 20, 100, 40));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const TOURS: Record<string, Tour> = {
  t: {
    id: 't',
    steps: [
      { targetId: 'a', title: 'A', description: '' },
      { targetId: 'gone', title: 'Gone', description: '' },
    ],
  },
  w: {
    id: 'w',
    kind: 'walkthrough',
    title: 'Apply for leave',
    steps: [
      { targetId: 'a', title: 'A', description: '' },
      { targetId: 'gone', title: 'Gone', description: '' },
    ],
  },
};

const App = (props: { onEvent?: (e: TourEvent) => void; controller?: any }) => (
  <TourProvider
    {...(props.controller ? { controller: props.controller } : { tours: TOURS })}
    onEvent={props.onEvent}>
    <TourTarget name="a">
      <Text>A</Text>
    </TourTarget>
    <Probe />
  </TourProvider>
);

const last = (events: TourEvent[]) => events[events.length - 1];

describe('onEvent from the built-in UI', () => {
  it("reports Skip on the card as exited by the 'user'", async () => {
    const events: TourEvent[] = [];
    render(<App onEvent={e => events.push(e)} />);
    act(() => api.startTour('t'));
    await advance(200);
    fireEvent.press(screen.getByText('Skip'));
    expect(last(events)).toMatchObject({ type: 'tour_exited', reason: 'user', stepIndex: 0 });
  });

  it("reports ✕ on the resume chip as exited by the 'user'", async () => {
    const events: TourEvent[] = [];
    render(<App onEvent={e => events.push(e)} />);
    act(() => api.startTour('w'));
    await advance(200);
    act(() => api.nextStep()); // "gone" never appears: the walkthrough pauses
    await advance(3100);
    expect(screen.getByTestId('rn-smart-tour-resume-chip')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(last(events)).toMatchObject({ type: 'tour_exited', reason: 'user', stepIndex: 1 });
  });

  it("keeps a controller's onEvent when the provider has none", async () => {
    const events: TourEvent[] = [];
    const controller = createTourController({ tours: TOURS, onEvent: e => events.push(e) });
    render(<App controller={controller} />);
    act(() => api.startTour('t'));
    expect(events[0]).toMatchObject({ type: 'tour_started', tourId: 't' });
  });
});
