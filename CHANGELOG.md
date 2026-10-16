# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.1.0 — 2026-10-16

### Added
- `startTour(id, { force: true })` replays a tour that was already seen (e.g. from a Help button).
- `resetTour(id)` and `resetAll()` mark tours as unseen again and persist that.
- `missingTargetTimeoutMs` prop on `DapProvider` (default 3000).
- The Android back button dismisses the tour, like Skip.
- `DapScrollView` forwards its `ref` to the inner `ScrollView`.
- Published build now ships CommonJS, ES modules and type declarations with an `exports` map, plus a `LICENSE` file.

### Fixed
- A tour whose current step's target is not on screen no longer stays active and invisible (which also blocked every other auto-start tour). It now ends without being marked as seen.
- Two quick taps on Next could move past the last step and leave a stuck tour.
- After auto-scrolling, the highlight stayed where the target used to be. The target is now measured again once the scroll finishes, and whenever a step becomes active.
- `startTour` called before storage had loaded could show an already-seen tour. Such calls are now queued until storage is ready.
- Passing `storageAdapter` as an inline object reloaded storage on every render.
- A storage adapter whose `setItem` throws synchronously no longer crashes the app.
- `stopTour(false)` could permanently block that tour from auto-starting for the rest of the session; behaviour is now consistent: any stopped tour waits for the next app launch (or `resetTour`) before auto-starting again.
- On the New Architecture, auto-scroll did nothing (it passed a numeric node handle to `measureLayout`, which only logs "must be called with a ref to a native component"). It now measures relative to the ScrollView's content container ref; `findNodeHandle` is only a fallback for older React Native versions.
- On the New Architecture, the area below the highlighted target was not dimmed and tooltips with `position: 'top'` were drawn off-screen, because the overlay relied on the Modal's container filling the screen. The overlay is now sized from the window dimensions.
- Steps whose target is outside the `DapScrollView` (e.g. a header button) no longer log a measurement warning on every step.
- Passing `onLayout` to `DapTarget` replaced the library's own handler, so the target was never measured.
- When several `DapScrollView`s mount and unmount, one unmounting no longer clears another's registration.
- The published JavaScript no longer contains raw JSX, so apps' Jest tests can import the package without extra `transformIgnorePatterns`.

### Changed
- `peerDependencies` now state the real minimums: React ≥ 17 and React Native ≥ 0.65 (`Dimensions` subscriptions with `.remove()` need 0.65).
- Build output moved from `dist/` to `lib/`. Import paths (`'rn-smart-tour'`) are unchanged.
- Log messages are prefixed `[rn-smart-tour]`. The storage key is unchanged (`@rn-dap:seen_tours`), so existing seen state is kept.

## 1.0.8 and earlier

Released before this changelog was kept. See the git history (`v1.0.3` … `v1.0.8` tags).
