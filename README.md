# rn-smart-tour

<p align="center">
  <b>Digital Adoption Platform (DAP) for React Native</b><br>
  Easily add product tours, guided walkthroughs, and onboarding overlays without intrusive code changes.
</p>

---

## ✨ Features

- 🎯 **Multi-Pass Measurement**: Native `measureInWindow` API with self-correcting strategy for animation resilience.
- 📱 **Rotation & Resize Aware**: Targets re-measure automatically on orientation change or split-screen.
- ⚡ **Auto-Start Engine**: Trigger tours instantly on mount with a smart debounce for layout stability.
- 💾 **Seen State Caching**: Persistent "only-once" logic with pluggable storage (AsyncStorage, MMKV, etc.).
- 🎨 **Smart Overlays**: Dynamic cutouts with Back/Next/Skip navigation and step indicators.
- 📜 **Auto-Scroll Support**: Bring tour targets into view with `DapScrollView`; the highlight is re-measured after scrolling.
- 🛟 **Never Gets Stuck**: If a step's target isn't on screen, the tour ends cleanly instead of leaving an invisible, active tour.
- 🔁 **Replay on Demand**: `startTour(id, { force: true })`, `resetTour(id)` and `resetAll()` for Help buttons and settings screens.

---

## 📦 Installation

```sh
npm install rn-smart-tour
```

Requires React 17+ and React Native 0.65+. No native code, so no `pod install` or rebuild is needed.

Unit-tested against React Native 0.73 (React 18), and checked in the example app on React Native 0.88 (React 19, New Architecture) on iOS.

---

## 🚀 Quick Start

### 1. Wrap your App
Wrap your root component in the `DapProvider` and define your tours.

```tsx
import { DapProvider } from 'rn-smart-tour';

const TOURS = {
  'welcome-tour': {
    id: 'welcome-tour',
    steps: [{
      targetId: 'save-btn',
      title: 'Welcome!',
      description: 'Tap here to save your progress.',
    }]
  }
};

export default function App() {
  return (
    <DapProvider tours={TOURS}>
      <MainApp />
    </DapProvider>
  );
}
```

### 2. Mark your Target
Wrap any view or button you want to highlight with `DapTarget`.

```tsx
import { DapTarget } from 'rn-smart-tour';

const MyButton = () => (
  <DapTarget name="save-btn">
    <Button title="Save" onPress={...} />
  </DapTarget>
);
```

### 3. Start the Tour
Set `autoStart: true` on a tour to show it the first time its first target appears, or start it yourself with the `useDap` hook.

```tsx
import { useDap } from 'rn-smart-tour';

const { startTour } = useDap();
// ...
// A tour is shown only once. `force: true` replays it, e.g. from a Help button.
<Button title="Help" onPress={() => startTour('welcome-tour', { force: true })} />
```

### 4. Enable Auto-Scroll (Optional)
If your targets are hidden inside a long list, swap your standard `ScrollView` for `DapScrollView`. The tour will automatically scroll to bring each target into the user's view.

```tsx
import { DapScrollView } from 'rn-smart-tour';

// ... inside your screen
<DapScrollView>
  <DapTarget name="bottom-btn">
    <Button title="Secret Button" ... />
  </DapTarget>
</DapScrollView>
```

### 5. Remember Seen Tours (Optional)
Without a `storageAdapter`, "seen" state lasts until the app restarts. Pass any storage with `getItem` / `setItem`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';

<DapProvider tours={TOURS} storageAdapter={AsyncStorage}>
```

```tsx
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const mmkvAdapter = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
};

<DapProvider tours={TOURS} storageAdapter={mmkvAdapter}>
```

Storage is read once on mount. Calls to `startTour`, `resetTour` and `resetAll` made before it has loaded are queued and run once it has, so an already-seen tour is never shown by mistake.

---

## 🧠 Technical Architecture

<details>
<summary><b>View How Measurements Work (Click to expand)</b></summary>

To guarantee accuracy during navigation animations, `rn-smart-tour` uses a **multi-pass strategy**:

- **Pass 1 (100ms)**: Fast first estimate.
- **Pass 2 (500ms)**: Corrects after most screen transitions finish.
- **Pass 3 (1000ms)**: Final safety net for slow async layout shifts.

Measurements only trigger a re-render if the position changes by more than **1pt (threshold)**.

</details>

<details>
<summary><b>Auto-Start & Debounce Settings</b></summary>

When `autoStart: true` is enabled, the overlay waits **300ms** after registration. This allows the multi-pass system to settle on the final coordinates before the hole is cut into the backdrop.

A tour that is stopped (finished, skipped, or ended because a target was missing) is not auto-started again in the same app session. `startTour` still works, and `resetTour` makes it eligible again.

</details>

<details>
<summary><b>Tour Lifecycle Rules</b></summary>

- **Skip**, **Finish** and the **Android back button** end the tour and mark it as seen.
- If a step's target is not on screen within `missingTargetTimeoutMs` (default **3000ms**), the tour ends **without** being marked as seen, and a warning is logged in development.
- When a step becomes active, its target is scrolled into view (inside a `DapScrollView`) and measured again, so the highlight matches where it is now.

</details>

---

## 🛠 API Reference

### DapProvider
| Property | Type | Default | Description |
|:---|:---|:---|:---|
| `tours` | `Record<string, Tour>` | — | All tours, keyed by id. |
| `storageAdapter` | `StorageAdapter` | — | Persists seen tours (AsyncStorage, MMKV, …). Read once on mount. |
| `missingTargetTimeoutMs` | `number` | `3000` | How long a step waits for its target before the tour ends. |

### Tour Configuration
| Property | Type | Description |
|:---|:---|:---|
| `id` | `string` | Unique identifier for caching. |
| `autoStart` | `boolean` | Trigger as soon as the first target mounts. |
| `steps` | `TourStep[]` | Sequence of highlight steps. |

### DapScrollView
A direct drop-in replacement for the React Native `ScrollView`. Supports all standard props, and a `ref` is forwarded to the inner `ScrollView`.
| Property | Type | Description |
|:---|:---|:---|
| `children` | `React.Node` | Components to scroll. |
| `...props` | `ScrollViewProps` | Standard props are forwarded to the native ScrollView. |

### DapTarget
| Property | Type | Description |
|:---|:---|:---|
| `name` | `string` | Unique identifier that matches a `targetId` in a tour step. |
| `children` | `ReactElement` | The UI element to wrap and highlight. |
| `...props` | `ViewProps` | All standard React Native `View` props are forwarded. |

### TourStep
| Property | Type | Default | Description |
|:---|:---|:---|:---|
| `targetId` | `string` | — | Matches the `name` prop in `<DapTarget>`. |
| `title` | `string` | — | Tooltip header. |
| `description` | `string` | — | Tooltip body. |
| `position` | `string` | `'bottom'` | `top`, `bottom`, `left`, `right`. |

### `useDap()` Hook
| Method | Description |
|:---|:---|
| `startTour(id, options?)` | Start a tour by ID. Does nothing if it was already seen, unless `{ force: true }`. |
| `stopTour(markAsSeen?)`| End tour. Pass `false` to keep it unread. |
| `nextStep()` / `prevStep()` | Manual step navigation. |
| `resetTour(id)` | Mark a tour as unseen so it can show (and auto-start) again. |
| `resetAll()` | Mark every tour as unseen. |
| `activeTour` | Current active tour object. |
| `currentStepIndex` | Current step number (0-indexed). |
| `seenTours` | `Record<string, boolean>` of tours already seen. |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

```sh
npm install
npm run typecheck && npm run lint && npm test   # what CI runs
npm run build                                    # outputs lib/ (CommonJS, ES modules, types)
```

The `example/` app loads the library straight from `src/`, so changes show up without a build:

```sh
cd example && npm install
cd ios && pod install && cd ..
npm run ios      # or: npm run android
```

---

<p align="center">
  <b>rn-smart-tour</b> • Built with ❤️ for the React Native community.
</p>