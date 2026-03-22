# rn-smart-tour

<p align="center">
  <b>Enterprise-grade Digital Adoption Platform (DAP) for React Native</b><br>
  Easily add product tours, guided walkthroughs, and onboarding overlays without intrusive code changes.
</p>

---

## ✨ Features

- 🎯 **Multi-Pass Measurement**: Native `measureInWindow` API with self-correcting strategy for animation resilience.
- 📱 **Rotation & Resize Aware**: Targets re-measure automatically on orientation change or split-screen.
- ⚡ **Auto-Start Engine**: Trigger tours instantly on mount with a smart debounce for layout stability.
- 💾 **Seen State Caching**: Persistent "only-once" logic with pluggable storage (AsyncStorage, MMKV, etc.).
- 🎨 **Smart Overlays**: Dynamic cutouts with Back/Next/Skip navigation and step indicators.

---

## 📦 Installation

```sh
npm install rn-smart-tour
```

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
Use the `useDap` hook to trigger the onboarding.

```tsx
import { useDap } from 'rn-smart-tour';

const { startTour } = useDap();
// ...
<Button title="Help" onPress={() => startTour('welcome-tour')} />
```

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

</details>

---

## 🛠 API Reference

### Tour Configuration
| Property | Type | Description |
|:---|:---|:---|
| `id` | `string` | Unique identifier for caching. |
| `autoStart` | `boolean` | Trigger as soon as the first target mounts. |
| `steps` | `TourStep[]` | Sequence of highlight steps. |

### DapTarget
| Property | Type | Description |
|:---|:---|:---|
| `name` | `string` | Unique identifier that matches a `targetId` in a tour step. |
| `children` | `ReactElement` | The UI element to wrap and highlight. |
| `asChild` | `boolean` | **New!** If true, clones the child to avoid an extra View wrapper. (Crucial for flex/percentage layouts). |
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
| `startTour(id)` | Start a tour by ID. |
| `stopTour(markAsSeen?)`| End tour. Pass `false` to keep it unread. |
| `nextStep()` / `prevStep()` | Manual step navigation. |
| `activeTour` | Current active tour object. |
| `currentStepIndex` | Current step number (0-indexed). |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

<p align="center">
  <b>rn-smart-tour</b> • Built with ❤️ for the React Native community.
</p>