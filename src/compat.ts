/**
 * The 1.x API (`Dap*` names and `useDap`), kept so existing apps keep working.
 * New code should use `TourProvider`, `TourTarget`, `TourScrollView` and `useTour`.
 */
import { useContext, useMemo } from 'react';
import type { TourEngine } from './core/TourEngine';
import { TourEngineContext } from './react/context';
import { useTour, useTourState } from './react/hooks';
import { TourProvider } from './react/TourProvider';
import type { TourProviderProps } from './react/TourProvider';
import { TourScrollView } from './react/TourScrollable';
import { TourTarget } from './react/TourTarget';
import type { DapContextType, TargetMeasurement } from './types';

/** @deprecated Use `TourProvider`. */
export const DapProvider = TourProvider;
/** @deprecated Use `TourProviderProps`. */
export type DapProviderProps = TourProviderProps;
/** @deprecated Use `TourTarget`. */
export const DapTarget = TourTarget;
/** @deprecated Use `TourScrollView`. */
export const DapScrollView = TourScrollView;

interface LegacyRegistry {
  registerTarget: DapContextType['registerTarget'];
  unregisterTarget: DapContextType['unregisterTarget'];
}

/**
 * 1.x `registerTarget` / `unregisterTarget`, created once per engine: callers
 * register from effects, so the functions must keep the same identity across renders.
 */
const legacyRegistries = new WeakMap<TourEngine, LegacyRegistry>();

function getLegacyRegistry(engine: TourEngine): LegacyRegistry {
  let registry = legacyRegistries.get(engine);
  if (!registry) {
    const registrations = new Map<string, () => void>();
    const unregisterTarget = (id: string) => {
      registrations.get(id)?.();
      registrations.delete(id);
    };
    const registerTarget = (id: string, measurement: TargetMeasurement, ref?: any) => {
      unregisterTarget(id);
      // Without a ref, report the given measurement whenever the engine measures.
      const measurable = ref ?? {
        measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) =>
          cb(measurement.x, measurement.y, measurement.width, measurement.height),
      };
      registrations.set(
        id,
        engine.registerTarget(id, { ref: { current: measurable }, scope: null, scrollable: null }),
      );
    };
    registry = { registerTarget, unregisterTarget };
    legacyRegistries.set(engine, registry);
  }
  return registry;
}

const noop = () => {};

/** @deprecated Use `useTour`. */
export function useDap(): DapContextType {
  const engine = useContext(TourEngineContext);
  if (!engine) {
    throw new Error('useDap must be used within a DapProvider');
  }
  const api = useTour();
  // 1.x consumers re-rendered on every measurement and could read `targets`.
  const presented = useTourState(state => state.presented);

  return useMemo(() => {
    const presentedStep = presented && engine.getTour(presented.tourId)?.steps[presented.stepIndex];
    return {
      ...api,
      ...getLegacyRegistry(engine),
      targets: presented?.rect && presentedStep?.targetId ? { [presentedStep.targetId]: presented.rect } : {},
      requestScroll: noop,
      _registerScrollRef: noop,
      _unregisterScrollRef: noop,
    };
  }, [engine, api, presented]);
}
