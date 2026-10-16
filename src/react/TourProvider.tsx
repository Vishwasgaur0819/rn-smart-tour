import React, { useEffect, useLayoutEffect, useState } from 'react';
import { AppState, Dimensions, Keyboard } from 'react-native';
import { isTourEngine } from '../core/controller';
import type { TourController } from '../core/controller';
import { TourEngine } from '../core/TourEngine';
import type { StorageAdapter, Tour } from '../types';
import { TourEngineContext } from './context';
import { TourOverlay } from './TourOverlay';

interface CommonProps {
  children: React.ReactNode;
  /**
   * How long (ms) a step waits for its target to be on screen before the step's
   * `onMissingTarget` policy applies (by default the tour ends, unseen). Default: 3000.
   */
  missingTargetTimeoutMs?: number;
}

export type TourProviderProps = CommonProps &
  (
    | {
        tours: Record<string, Tour>;
        /** Persists seen tours (AsyncStorage, MMKV, …). Read once, when the provider mounts. */
        storageAdapter?: StorageAdapter;
        controller?: undefined;
      }
    | {
        /** A controller from `createTourController`, to also drive tours from outside React. */
        controller: TourController;
        /** Replaces the controller's tours. */
        tours?: Record<string, Tour>;
        storageAdapter?: undefined;
      }
  );

export const TourProvider: React.FC<TourProviderProps> = ({
  children,
  tours,
  storageAdapter,
  controller,
  missingTargetTimeoutMs,
}) => {
  const [engine] = useState(() => {
    if (!controller)
      return new TourEngine({ tours: tours ?? {}, storage: storageAdapter, missingTargetTimeoutMs });
    if (!isTourEngine(controller))
      throw new Error('TourProvider: `controller` must come from createTourController');
    return controller;
  });

  useLayoutEffect(() => {
    engine.setOptions({ tours, missingTargetTimeoutMs });
  }, [engine, tours, missingTargetTimeoutMs]);

  useEffect(() => {
    engine.loadStorage();
    return () => engine.dispose();
  }, [engine]);

  // Things that can move the shown target without a layout event on it.
  useEffect(() => {
    const remeasure = () => engine.requestRemeasure();
    const subscriptions = [
      Dimensions.addEventListener('change', remeasure),
      Keyboard.addListener('keyboardDidShow', remeasure),
      Keyboard.addListener('keyboardDidHide', remeasure),
      AppState.addEventListener('change', state => state === 'active' && remeasure()),
    ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [engine]);

  return (
    <TourEngineContext.Provider value={engine}>
      {children}
      <TourOverlay />
    </TourEngineContext.Provider>
  );
};
