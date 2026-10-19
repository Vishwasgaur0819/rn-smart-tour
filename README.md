# rn-smart-tour

<p align="center">
  <b>Digital Adoption Platform (DAP) for React Native</b><br>
  Easily add product tours, guided walkthroughs, and onboarding overlays without intrusive code changes.
</p>

---

## ✨ Features

- 🎯 **Measured When Shown**: Targets are measured when their step starts, after scrolling into view and once they stop moving, so the highlight matches what's on screen.
- 🧭 **Navigation Aware**: Screens kept mounted in the background are never highlighted, and steps wait for screen transitions to finish (React Navigation integration included).
- 🔀 **Tours Across Screens**: A step can navigate to another screen before it is shown.
- 📜 **Auto-Scroll**: Works with `ScrollView`, `FlatList` and `SectionList`; each target scrolls its own nearest list.
- ⚡ **No Re-Render Cost**: Mounting and measuring targets re-renders nothing; components subscribe only to the tour state they use.
- 💾 **Seen State Caching**: Persistent "only-once" logic with pluggable storage (AsyncStorage, MMKV, etc.).
- 🛟 **Never Gets Stuck**: If a step's target isn't on screen in time, the tour ends (or skips the step) instead of leaving an invisible, active tour.
- 🔁 **Replay on Demand**: `startTour(id, { force: true })`, `resetTour(id)` and `resetAll()`, from components or from outside React.

---

## 📦 Installation

```sh
npm install rn-smart-tour@next   # 2.0 beta (this README)
npm install rn-smart-tour        # 1.x (stable)
```

Requires React 18+ and React Native 0.73+. No native code, so no `pod install` or rebuild is needed. React Navigation (6+) is optional.

Checked on device on iOS and Android with React Native 0.88 (New Architecture), and on iOS with React Native 0.81 on the old architecture, with React Navigation 7. Unit tests run against React Native 0.73.

---

## 🚀 Quick Start

### 1. Wrap your App
Wrap your root component in `TourProvider` and define your tours.

```tsx
import { TourProvider } from 'rn-smart-tour';

const TOURS = {
  'welcome-tour': {
    id: 'welcome-tour',
    autoStart: true,
    steps: [{
      targetId: 'save-btn',
      title: 'Welcome!',
      description: 'Tap here to save your progress.',
    }]
  }
};

export default function App() {
  return (
    <TourProvider tours={TOURS}>
      <MainApp />
    </TourProvider>
  );
}
```

### 2. Mark your Targets
Wrap any view or button you want to highlight with `TourTarget`.

```tsx
import { TourTarget } from 'rn-smart-tour';

const MyButton = () => (
  <TourTarget name="save-btn">
    <Button title="Save" onPress={...} />
  </TourTarget>
);
```

### 3. Start the Tour
A tour with `autoStart: true` shows the first time its first target appears. Start any tour yourself with `useTour`:

```tsx
import { useTour } from 'rn-smart-tour';

const { startTour } = useTour();
// ...
// A tour is shown only once. `force: true` replays it, e.g. from a Help button.
<Button title="Help" onPress={() => startTour('welcome-tour', { force: true })} />
```

### 4. Screens (React Navigation)
Wrap each screen that has targets in `NavigationTourScope`. Its targets then only count while the screen is focused and has finished animating in, so a screen kept mounted in the background is never highlighted.

```tsx
import { NavigationTourScope } from 'rn-smart-tour/react-navigation';

const OrdersScreen = () => (
  <NavigationTourScope>
    {/* screen content with TourTargets */}
  </NavigationTourScope>
);
```

Not using React Navigation? `TourScope` does the same with an `active` prop you control: `<TourScope active={isVisible}>`.

### 5. Lists (Optional)
To let tours scroll a target into view, use `TourScrollView` instead of `ScrollView`, or wrap a `FlatList` / `SectionList` in `TourScrollable`:

```tsx
import { TourScrollable, TourTarget } from 'rn-smart-tour';

const listRef = useRef<FlatList>(null);

<TourScrollable scrollRef={listRef}>
  <FlatList
    ref={listRef}
    data={items}
    renderItem={({ item }) => (
      <TourTarget name={`item-${item.id}`}>
        <Row item={item} />
      </TourTarget>
    )}
  />
</TourScrollable>
```

A target in a virtualized list can only be scrolled to once its row has rendered.

### 6. Tours Across Screens (Optional)
`beforeEnter` runs before a step looks for its target, e.g. to open the screen it's on. The step then waits for the target to appear on the focused screen.

```tsx
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

const TOURS = {
  orders: {
    id: 'orders',
    steps: [
      { targetId: 'orders-tab', title: 'Orders', description: 'All your orders live here.' },
      {
        targetId: 'new-order',
        title: 'New order',
        description: 'Start one from here.',
        beforeEnter: () => navigationRef.navigate('Orders'),
      },
    ],
  },
};
```

### 7. Remember Seen Tours (Optional)
Without a `storageAdapter`, "seen" state lasts until the app restarts. Pass any storage with `getItem` / `setItem`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';

<TourProvider tours={TOURS} storageAdapter={AsyncStorage}>
```

```tsx
import { createMMKV } from 'react-native-mmkv'; // v4; on v3: `const mmkv = new MMKV()`

const mmkv = createMMKV();
const mmkvAdapter = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
};

<TourProvider tours={TOURS} storageAdapter={mmkvAdapter}>
```

Storage is read once on mount. Calls to `startTour`, `resetTour` and `resetAll` made before it has loaded are queued and run once it has, so an already-seen tour is never shown by mistake.

### 8. Your Own Tooltip Card (Optional)
Render the card with your design system and theme. It is placed beside the target for you (below by default, flipping above when there's no room), using its measured height.

```tsx
import type { TourTooltipProps } from 'rn-smart-tour';

const TourCard = ({ step, stepIndex, stepCount, isFirstStep, isLastStep, next, prev, skip }: TourTooltipProps) => (
  <Card>
    <Title>{step.title}</Title>
    <Body>{step.description}</Body>
    <Row>
      {!isLastStep && <Button title="Skip" onPress={skip} />}
      {!isFirstStep && <Button title="Back" onPress={prev} />}
      <Button title={isLastStep ? 'Done' : `Next (${stepIndex + 1}/${stepCount})`} onPress={next} />
    </Row>
  </Card>
);

<TourProvider
  tours={TOURS}
  renderTooltip={props => <TourCard {...props} />}
  tooltipWidth={320}
  backdropColor="rgba(0, 0, 0, 0.6)">
```

For walkthroughs, the props also tell the card what kind of step it is: `isActionStep` (the user taps the element or the app emits an event — hide Next), `isInteractive` (the element is usable, then Next) and `isCentered` (no target). `tour.kind` tells a walkthrough ("Exit") from a tour ("Skip").

### 9. "How do I…?" Walkthroughs (Optional)
A walkthrough guides the user through a task in the real app — they tap the real buttons and the walkthrough follows along. Start it from a help list instead of automatically.

```tsx
const TOURS = {
  applyLeave: {
    id: 'applyLeave',
    kind: 'walkthrough',
    title: 'Apply for leave',
    keywords: ['holiday', 'sick'],
    canStart: ctx => (ctx.isOnline ? true : 'Connect to the internet to apply for leave'),
    steps: [
      { title: "Let's apply for leave", description: 'It takes about a minute.' }, // no targetId: centred card
      { targetId: 'menu', title: 'Open the menu', description: '', advanceOn: 'press' },
      { targetId: 'leave', title: 'Tap Leave Management', description: '', advanceOn: 'press' },
      { targetId: 'apply', title: 'Tap Apply Leave', description: '', advanceOn: 'press' },
      { targetId: 'leaveType', title: 'Pick the leave type', description: '', interactive: true }, // usable, then Next
      { targetId: 'submit', title: 'Tap Submit Request', description: 'This sends a real request.', advanceOn: 'press' },
      { title: 'All done!', description: 'Track it under My Leave requests.' },
    ],
  },
};

<TourProvider
  tours={TOURS}
  context={{ isOnline }}                                   // what canStart / when check
  onStartBlocked={(tour, reason) => Toast.show(reason)}    // canStart said no
>
```

- `advanceOn: 'press'` — the highlighted element stays tappable; the step moves on when the user taps it. The rest of the screen stays blocked.
- `advanceOn: { event: 'leaveTypeChosen' }` — moves on when the app calls `emit('leaveTypeChosen')` (from `useTour()` or a controller).
- `interactive: true` — for form fields: the highlighted element stays usable (type, pick a date, open a dropdown) and the step moves on with Next. Taps elsewhere stay blocked.
- `when: ctx => …` — shows a step only when it applies (e.g. managers only); step counts skip hidden steps.
- If the user leaves the path, a walkthrough **pauses** (instead of ending) and shows a "Resume" chip (`renderResumeChip` to draw your own). Resuming continues from the latest step whose element is on screen, so the user is guided back.

List walkthroughs for a help screen with `useTourCatalog`:

```tsx
const tasks = useTourCatalog({ kind: 'walkthrough', query: searchText });
// [{ id: 'applyLeave', title: 'Apply for leave', kind: 'walkthrough' }, …]
const { startTour } = useTour();
<Button title={task.title} onPress={() => startTour(task.id, { force: true })} />
```

### 10. Steps Inside Popups (Optional)
The overlay is drawn over your app, so the app's own modals open *above* it. To point a step at something inside a modal, wrap the modal's content in `TourOverlayHost`; steps whose target is inside it are drawn inside the modal.

```tsx
import { TourOverlayHost } from 'rn-smart-tour';

<Modal visible={visible} transparent>
  <TourOverlayHost>
    <TourTarget name="endDay">
      <Button title="End Day" onPress={endDay} />
    </TourTarget>
  </TourOverlayHost>
</Modal>
```

Put it in your app's shared modal component once and every popup can host steps. It uses the provider's card, colors and width. Outside a `TourProvider` it just renders its children.

### 11. Start Tours from Outside React (Optional)
For deep links or notification handlers, create a controller and pass it to the provider:

```tsx
import { createTourController, TourProvider } from 'rn-smart-tour';

export const tours = createTourController({ tours: TOURS, storageAdapter: mmkvAdapter });

<TourProvider controller={tours}>…</TourProvider>

// anywhere:
tours.startTour('new-feature', { force: true });
```

### 12. Analytics (Optional)
Pass `onEvent` to see how tours perform: how many users finish each walkthrough, and at which step the others leave. Forward the events to your own backend or analytics tool.

```tsx
<TourProvider tours={TOURS} onEvent={event => analyticsQueue.push(event)}>
```

Every event has `type`, `runId` (the same for every event of one run of a tour, start to end), `tourId`, `tourKind` and `timestamp`, plus:

| `type` | When | Extra fields |
|:---|:---|:---|
| `tour_started` | A tour starts | `trigger` (`'auto'` / `'manual'`), `stepCount` |
| `step_shown` | A step appears (once per step visit, not on re-measures) | `stepIndex`, `stepNumber`, `stepCount`, `targetId` |
| `tour_completed` | The last step is finished | `durationMs` |
| `tour_exited` | The tour ends early | `reason`, `stepIndex`, `durationMs` |
| `tour_blocked` | `canStart` refused a `startTour` | `reason` (the message) |
| `tour_paused` | A walkthrough is put on hold | `reason` (`'app'` / `'target_missing'`), `stepIndex` |
| `tour_resumed` | A paused tour continues | `stepIndex` |
| `target_missing` | A step's element wasn't found in time | `stepIndex`, `targetId`, `outcome` (`'skip'` / `'pause'` / `'end'`) |

`tour_exited` reasons: `'user'` (Skip / Exit, or ✕ on the resume chip), `'back_button'`, `'app'` (`stopTour`), `'target_missing'`, `'replaced'` (another tour started), `'removed'` (the tour was removed). An error thrown by `onEvent` is logged and never affects the tour.

---

## 🧠 Technical Architecture

<details>
<summary><b>How Measurement Works (Click to expand)</b></summary>

Targets only register a ref. When a step starts:

1. `beforeEnter` runs, if the step has one, and is awaited.
2. The engine waits for the target to be mounted inside an active scope.
3. If the target is in a `TourScrollable` and not fully visible, the list scrolls it to the middle.
4. The target is measured every frame until its position holds steady for 3 frames, then the step is shown.

While a step is shown, its target is measured again when its layout changes, the window resizes, the keyboard opens or closes, or the app returns to the foreground. Positions that change by **1pt** or less are ignored.

</details>

<details>
<summary><b>Auto-Start & Debounce Settings</b></summary>

When `autoStart: true` is enabled, the tour starts **300ms** after its first target is registered in an active scope, so the rest of the screen can mount first.

A tour that is stopped (finished, skipped, or ended because a target was missing) is not auto-started again in the same app session. `startTour` still works, and `resetTour` makes it eligible again.

</details>

<details>
<summary><b>Tour Lifecycle Rules</b></summary>

- **Skip**, **Finish** and the **Android back button** end the tour and mark it as seen.
- If a step's target is not on screen within `missingTargetTimeoutMs` (default **3000ms**, or the step's `targetTimeoutMs`), the tour ends **without** being marked as seen, or moves to the next step with `onMissingTarget: 'skip'`. A warning is logged in development.
- If the target of the step being shown disappears (unmounts, or its screen loses focus), the step is hidden until it comes back, within the same timeout.
- While moving to the next step, the current one stays on screen until the next target is measured, and extra taps on **Next** are ignored.

</details>

---

## 🛠 API Reference

### TourProvider
| Property | Type | Default | Description |
|:---|:---|:---|:---|
| `tours` | `Record<string, Tour>` | — | All tours, keyed by id. |
| `storageAdapter` | `StorageAdapter` | — | Persists seen tours (AsyncStorage, MMKV, …). Read once on mount. |
| `missingTargetTimeoutMs` | `number` | `3000` | How long a step waits for its target. |
| `controller` | `TourController` | — | From `createTourController`, instead of `tours` / `storageAdapter`. |
| `renderTooltip` | `(props: TourTooltipProps) => ReactNode` | built-in card | Draws the tooltip card. Receives the step, its index and count, and `next` / `prev` / `skip`. |
| `tooltipWidth` | `number` | `280` | Card width (capped to the screen). |
| `backdropColor` | `string` | `'rgba(0, 0, 0, 0.6)'` | Color of the dimmed area around the target. |
| `presentation` | `'root' \| 'modal'` | `'root'` | `'root'` draws the overlay as a layer over the app; the app's own modals open above it. `'modal'` uses a React Native `Modal`. For steps inside the app's modals, prefer `TourOverlayHost`. |
| `supportedOrientations` | `ModalProps['supportedOrientations']` | all | With `presentation="modal"`: iOS orientations the overlay allows (still limited by Info.plist). |
| `context` | `Record<string, unknown>` | `{}` | App state that `canStart` and step `when` receive. |
| `onStartBlocked` | `(tour, reason) => void` | — | A tour's `canStart` refused a `startTour` call; show `reason` to the user. |
| `onEvent` | `(event: TourEvent) => void` | — | Analytics: every start, step shown, completion, exit (and why), block, pause, resume and missing target. See [Analytics](#12-analytics-optional). |
| `renderResumeChip` | `(props: ResumeChipProps) => ReactNode` | built-in chip | Draws the "Resume" chip shown while a tour is paused (`tour`, `resume`, `dismiss`). |
| `highlightColor` | `string` | `'#FFFFFF'` | Ring around an element the user should tap. |

### Tour Configuration
| Property | Type | Description |
|:---|:---|:---|
| `id` | `string` | Unique identifier for caching. |
| `autoStart` | `boolean` | Start the first time the first step with a target appears. |
| `steps` | `TourStep[]` | Sequence of highlight steps. |
| `kind` | `'tour' \| 'walkthrough'` | Walkthroughs pause on a missing target and say "Exit". Default `'tour'`. |
| `title` / `description` / `keywords` | `string` / `string` / `string[]` | Shown and searched by `useTourCatalog`. |
| `canStart` | `(context) => boolean \| string` | Return `true`, or a reason the tour can't start. |

### TourStep
| Property | Type | Default | Description |
|:---|:---|:---|:---|
| `targetId` | `string` | — | Matches the `name` prop of a `<TourTarget>`. Leave out for a centred card. |
| `title` | `string` | — | Tooltip header. |
| `description` | `string` | — | Tooltip body. |
| `position` | `string` | `'bottom'` | `top`, `bottom`, `left`, `right`. |
| `beforeEnter` | `() => void \| Promise<void>` | — | Runs (and is awaited) before the step looks for its target. |
| `advanceOn` | `'next' \| 'press' \| { event }` | `'next'` | How the step moves on: Next button, a tap on the element, or an app event. |
| `interactive` | `boolean` | `false` | The highlighted element stays usable (form fields); the step still moves on with Next (or `advanceOn`). |
| `when` | `(context) => boolean` | — | Show the step only when this returns true. |
| `onMissingTarget` | `'end' \| 'skip' \| 'pause'` | `'end'` (`'pause'` for walkthroughs) | What happens if the target isn't found in time. |
| `targetTimeoutMs` | `number` | provider's | Per-step override of `missingTargetTimeoutMs`. |

### TourTarget
| Property | Type | Description |
|:---|:---|:---|
| `name` | `string` | Matches a `targetId` in a tour step. |
| `children` | `ReactNode` | The UI element to wrap and highlight. |
| `...props` | `ViewProps` | All standard React Native `View` props are forwarded. |

### TourOverlayHost
| Property | Type | Description |
|:---|:---|:---|
| `children` | `ReactNode` | A modal's content. Steps whose targets are inside are drawn here instead of over the app. |

### TourScope / NavigationTourScope
| Component | Props | Description |
|:---|:---|:---|
| `TourScope` | `active?: boolean` (default `true`) | Targets inside only count while `active` (and every parent scope is active). |
| `NavigationTourScope` | — | From `rn-smart-tour/react-navigation`. Active while the screen is focused and not animating. |

### TourScrollable / TourScrollView
| Component | Props | Description |
|:---|:---|:---|
| `TourScrollable` | `scrollRef`, `horizontal?` | Lets tours scroll targets inside the referenced `ScrollView` / `FlatList` / `SectionList`. |
| `TourScrollView` | `ScrollViewProps` | A `ScrollView` already wrapped in `TourScrollable`. A `ref` is forwarded. |

### `useTour()` Hook
| Member | Description |
|:---|:---|
| `startTour(id, options?)` | Start a tour by ID. Does nothing if it was already seen, unless `{ force: true }`. |
| `stopTour(markAsSeen?)`| End tour. Pass `false` to keep it unread. |
| `nextStep()` / `prevStep()` | Manual step navigation. |
| `resetTour(id)` | Mark a tour as unseen so it can show (and auto-start) again. |
| `resetAll()` | Mark every tour as unseen. |
| `status` | `'idle'`, `'waiting'` (looking for the step's target), `'active'` or `'paused'`. |
| `activeTour` | Current active tour object. |
| `currentStepIndex` | Current step number (0-indexed). |
| `seenTours` | `Record<string, boolean>` of tours already seen. |
| `emit(event)` | Report an app event, for steps with `advanceOn: { event }`. |
| `pauseTour()` / `resumeTour()` | Put the running tour on hold / continue it. |

`useTourState(selector)` subscribes to any slice of the tour state and re-renders only when it changes.

---

## ⬆️ Upgrading from 1.x

The 1.x names still work and are deprecated: `DapProvider` → `TourProvider`, `DapTarget` → `TourTarget`, `DapScrollView` → `TourScrollView`, `useDap` → `useTour`. Seen tours stored by 1.x are kept.

Behaviour changes:
- React ≥ 18 and React Native ≥ 0.73 are required.
- A step appears a few frames after it starts (once its target has stopped moving), not immediately.
- `useDap().targets` only contains the measurement of the step being shown, and `requestScroll` does nothing; scrolling is automatic.
- Wrap screens in `NavigationTourScope` (or `TourScope`) to stop targets on background screens from being used.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

```sh
npm install
npm run typecheck && npm run lint && npm test   # what CI runs
npm run build                                    # outputs lib/ (CommonJS, ES modules, types)
npm publish --tag next                           # prereleases (betas); `npm publish` for stable versions
```

The `example/` app (React Native 0.88, React Navigation) loads the library straight from `src/`, so changes show up without a build:

```sh
cd example && npm install
cd ios && pod install && cd ..
npm run ios      # or: npm run android
```

---

<p align="center">
  <b>rn-smart-tour</b> • Built with ❤️ for the React Native community.
</p>
