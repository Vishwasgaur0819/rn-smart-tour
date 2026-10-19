import { Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TourOverlayHost, TourProvider, TourTarget, useTour, useTourState } from '../index';
import type { TourApi, TourEngineState, Tour } from '../index';

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
    kind: 'walkthrough',
    title: 'End my day',
    steps: [
      { targetId: 'changeDate', title: 'Tap Change Date', description: '' },
      { targetId: 'endDay', title: 'Tap End Day', description: 'In the date list.' },
    ],
  },
};

/** An app screen with a target, plus a "popup" whose content is wrapped in a host. */
const App = ({ renderTooltip }: { renderTooltip?: any }) => (
  <TourProvider tours={TOURS} renderTooltip={renderTooltip}>
    <TourTarget name="changeDate">
      <Text>Change Date</Text>
    </TourTarget>
    <View testID="popup">
      <TourOverlayHost>
        <TourTarget name="endDay">
          <Text>End Day</Text>
        </TourTarget>
      </TourOverlayHost>
    </View>
    <Probe />
  </TourProvider>
);

describe('TourOverlayHost', () => {
  it('draws a step inside the popup when its target is in it, and at the root otherwise', async () => {
    render(<App />);
    act(() => api.startTour('t'));
    await advance(200);
    expect(state.presented?.hostId).toBeNull();
    expect(screen.getByTestId('rn-smart-tour-overlay')).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-host-overlay')).toBeNull();

    act(() => api.nextStep());
    await advance(200);
    expect(state.presented?.hostId).toMatch(/^rn-smart-tour-host-/);
    expect(screen.queryByTestId('rn-smart-tour-overlay')).toBeNull();
    const hostOverlay = screen.getByTestId('rn-smart-tour-host-overlay');
    // Drawn inside the popup's tree.
    expect(screen.getByTestId('popup').findAll((node: any) => node === hostOverlay)).toHaveLength(1);
    expect(screen.getByText('Tap End Day')).toBeTruthy();
  });

  it("uses the provider's card in the popup too", async () => {
    render(<App renderTooltip={(props: any) => <Text>{`custom: ${props.step.title}`}</Text>} />);
    act(() => api.startTour('t'));
    act(() => api.nextStep());
    await advance(200);
    expect(screen.getByText('custom: Tap End Day')).toBeTruthy();
  });

  it('shows the resume chip once, at the root (not in every popup)', async () => {
    render(<App />);
    act(() => api.startTour('t'));
    act(() => api.pauseTour());
    expect(screen.getAllByTestId('rn-smart-tour-resume-chip')).toHaveLength(1);
    expect(
      screen.getByTestId('popup').findAll((node: any) => node.props.testID === 'rn-smart-tour-resume-chip'),
    ).toHaveLength(0);
  });

  it('renders just its children outside a TourProvider', () => {
    render(
      <TourOverlayHost>
        <Text>popup content</Text>
      </TourOverlayHost>,
    );
    expect(screen.getByText('popup content')).toBeTruthy();
  });
});

describe('interactive (fill-in) steps', () => {
  const formTours = (step: Tour['steps'][number]): Record<string, Tour> => ({
    f: {
      id: 'f',
      kind: 'walkthrough',
      title: 'Apply for leave',
      steps: [step, { title: 'Done', description: '' }],
    },
  });

  const Form = ({ tours }: { tours: Record<string, Tour> }) => (
    <TourProvider tours={tours}>
      <TourTarget name="leaveType" testID="leaveType">
        <Text>Select Leave Type</Text>
      </TourTarget>
      <Probe />
    </TourProvider>
  );

  it('keeps the field usable and moves on with Next (not on a tap)', async () => {
    render(
      <Form
        tours={formTours({
          targetId: 'leaveType',
          title: 'Pick the leave type',
          description: '',
          interactive: true,
        })}
      />,
    );
    act(() => api.startTour('f'));
    await advance(200);

    expect(screen.getByTestId('rn-smart-tour-action-ring')).toBeTruthy();
    expect(screen.queryByTestId('rn-smart-tour-cutout-blocker')).toBeNull();
    expect(screen.getByText('Use the highlighted item, then tap Next.')).toBeTruthy();

    const field = screen.getByTestId('leaveType');
    fireEvent(field, 'touchStart', { nativeEvent: { pageX: 50, pageY: 40 } });
    fireEvent(field, 'touchEnd', { nativeEvent: { pageX: 50, pageY: 40 } });
    expect(state.stepIndex).toBe(0); // a tap uses the field; it doesn't advance

    fireEvent.press(screen.getByText('Next'));
    expect(state.stepIndex).toBe(1);
  });

  it('with advanceOn: { event }, the field is usable and the app event moves on (no Next)', async () => {
    render(
      <Form
        tours={formTours({
          targetId: 'leaveType',
          title: 'Pick the leave type',
          description: '',
          interactive: true,
          advanceOn: { event: 'leaveTypeChosen' },
        })}
      />,
    );
    act(() => api.startTour('f'));
    await advance(200);
    expect(screen.getByTestId('rn-smart-tour-action-ring')).toBeTruthy();
    expect(screen.queryByText('Next')).toBeNull();

    act(() => api.emit('leaveTypeChosen'));
    expect(state.stepIndex).toBe(1);
  });
});
