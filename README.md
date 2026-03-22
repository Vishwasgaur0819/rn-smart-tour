# rn-smart-tour

An enterprise-grade Digital Adoption Platform (DAP) package for React Native. Easily add product tours, guided walkthroughs, and onboarding overlays directly into your app without intrusive code changes.

## Features
- **Multi-Pass Measurement**: Wraps your components and uses the native `measureInWindow` API with a self-correcting, multi-pass strategy — so highlights land correctly even during screen-transition animations.
- **Rotation & Resize Aware**: Automatically re-measures targets when screen dimensions change (rotation, split-screen, foldables).
- **Debounced Auto-Start Engine**: Automatically triggers tours when target elements mount, with a built-in debounce to ensure the overlay uses fully settled coordinates.
- **Seen State Caching**: Connect any local storage database to ensure users only see tours once.
- **Smart Overlays**: Creates highlighted holes in backdrops over completely custom UIs, with Back/Next/Skip navigation.

## Installation

```sh
npm install rn-smart-tour
```

---

## 🚀 Quick Start Guide

Adding a product tour to your app only takes 3 simple steps:

### Step 1: Wrap your App 
At the very top of your application (usually `App.tsx`), wrap everything in the `<DapProvider>`. Here you define the tours you want to show your users.

```tsx
import React from 'react';
import { DapProvider } from 'rn-smart-tour';

// Define the steps of your tour here!
const MY_TOURS = {
  'welcome-tour': {
    id: 'welcome-tour',
    steps: [
      {
        targetId: 'my-first-button',
        title: 'Welcome to the App!',
        description: 'Tapping this button saves your progress.',
      }
    ]
  }
};

export default function App() {
  return (
    <DapProvider tours={MY_TOURS}>
      <MainScreen />
    </DapProvider>
  );
}
```

### Step 2: Target an Element
Go to any screen in your app and decide what button or view you want to highlight. Wrap that element with `<DapTarget>`. Make sure the `name` matches the `targetId` from Step 1!

```tsx
import { View, Button } from 'react-native';
import { DapTarget } from 'rn-smart-tour';

export const MainScreen = () => {
  return (
    <View style={{ marginTop: 100 }}>
      {/* Wrap the button you want to highlight! */}
      <DapTarget name="my-first-button">
         <Button title="Save Button" onPress={() => {}} />
      </DapTarget>
    </View>
  );
};
```

### Step 3: Trigger the Tour!
To start the walkthrough, just call `startTour` anywhere inside your app.

```tsx
import { Button } from 'react-native';
import { useDap } from 'rn-smart-tour';

export const HelpMenu = () => {
    const { startTour } = useDap();
    
    return (
        <Button 
          title="Start Walkthrough" 
          onPress={() => startTour('welcome-tour')} 
        />
    );
}
```

---

## 🧠 Advanced Usage (Pro Features)

### 1. Auto-Start & Show "Only Once"
For true enterprise onboarding, you want the tour to start *automatically* when a user visits a new screen, and never show it to them again after they finish it.

By passing a `storageAdapter` (like `AsyncStorage`) into the Provider, the package will permanently remember who has seen the tour!

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';

const MY_TOURS = {
  'welcome-tour': {
    id: 'welcome-tour',
    autoStart: true, // Automatically starts when "my-first-button" mounts!
    steps: [ ... ]
  }
};

// Map the Storage commands
const myStorage = {
  getItem: async (key) => await AsyncStorage.getItem(key),
  setItem: async (key, value) => { await AsyncStorage.setItem(key, value); }
};

// Pass it to the Provider
<DapProvider tours={MY_TOURS} storageAdapter={myStorage}>
```

### 2. How Measurement Works

When a `<DapTarget>` mounts or re-layouts, it does **not** rely on a single measurement. Instead, it uses a **multi-pass strategy** to guarantee accuracy:

| Pass | Delay | Purpose |
|------|-------|---------|
| 1st  | 100ms | Fast first estimate — may capture mid-animation coordinates |
| 2nd  | 500ms | Self-corrects after most navigation transitions finish |
| 3rd  | 1000ms | Final safety net for slow animations or async layout shifts |

- Each new `onLayout` event **cancels** all pending timers and schedules fresh measurements.
- A measurement is only sent to the Provider if the position has **actually changed** (>1pt threshold), avoiding unnecessary re-renders.
- On **rotation/resize**, all targets automatically re-measure themselves.
- On unmount, all timers are cleaned up and the target is unregistered.

#### Auto-Start Debounce

When `autoStart: true` is set on a tour, the overlay does **not** appear the instant a target registers. Instead, it waits **300ms** before starting. If a more accurate measurement arrives during that window (e.g., the 500ms pass corrects the 100ms pass), the debounce resets and the overlay uses the final, settled coordinates.

This is why you may notice a brief (~300ms) delay before an auto-start tour appears — it's by design to prevent misaligned highlights.

#### Tuning Constants

If you need to adjust timing for your app's specific animation durations, the following constants can be modified in the source:

| Constant | File | Default | Description |
|----------|------|---------|-------------|
| `MEASUREMENT_DELAYS` | `DapTarget.tsx` | `[100, 500, 1000]` | Multi-pass measurement intervals (ms) |
| `POSITION_THRESHOLD` | `DapTarget.tsx` | `1` | Minimum position change (points) to trigger re-registration |
| `AUTO_START_DEBOUNCE_MS` | `DapProvider.tsx` | `300` | Debounce delay (ms) before auto-starting a tour |

### 3. Programmatic Control

The `useDap()` hook exposes full control over tours:

```tsx
const { startTour, stopTour, nextStep, prevStep, activeTour, currentStepIndex } = useDap();

// Start a specific tour
startTour('welcome-tour');

// Stop and mark as seen (default)
stopTour();

// Stop WITHOUT marking as seen (user can see it again)
stopTour(false);

// Navigate between steps
nextStep();
prevStep();
```

## API Reference

### Tour Object
| Property | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Unique identifier. Needed for cache tracking. |
| `autoStart` | `boolean` | If true, automatically renders when the first step's target mounts on the screen. |
| `steps` | `TourStep[]` | The sequence of highlighted elements and tooltips. |

### TourStep Object
| Property | Type | Default | Description |
|-----------|------|---------|-------------|
| `targetId` | `string` | — | Must directly match the `name=""` prop passed to `<DapTarget>`. |
| `title` | `string` | — | Large text inside the tooltip. |
| `description` | `string` | — | Context explanation inside the tooltip. |
| `position` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'bottom'` | Where the tooltip appears relative to the highlighted target. |

### DapTarget Props
| Property | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique identifier that matches a `targetId` in a tour step. |
| `children` | `ReactElement` | The UI element to wrap and highlight. |
| `...props` | `ViewProps` | All standard React Native `View` props are forwarded. |

### useDap() Hook
| Property | Type | Description |
|-----------|------|-------------|
| `startTour(id)` | `(tourId: string) => void` | Start a tour by its ID. |
| `stopTour(markAsSeen?)` | `(markAsSeen?: boolean) => void` | Stop the active tour. Pass `false` to allow the tour to show again. |
| `nextStep()` | `() => void` | Advance to the next step. Finishes the tour if on the last step. |
| `prevStep()` | `() => void` | Go back to the previous step. |
| `activeTour` | `Tour \| null` | The currently active tour object, or `null`. |
| `currentStepIndex` | `number` | Index of the current step in the active tour. |
| `targets` | `Record<string, TargetMeasurement>` | All registered target measurements. |
| `seenTours` | `Record<string, boolean>` | Map of tour IDs to whether they've been seen. |

### StorageAdapter Interface
| Method | Type | Description |
|--------|------|-------------|
| `getItem` | `(key: string) => Promise<string \| null> \| string \| null` | Retrieve a stored value by key. |
| `setItem` | `(key: string, value: string) => Promise<void> \| void` | Store a value by key. |

Compatible with `AsyncStorage`, `MMKV`, or any key-value store that implements this interface.
#   r n - s m a r t - t o u r  
 