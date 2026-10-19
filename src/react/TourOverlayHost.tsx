import React, { useContext, useState } from 'react';
import type { HostHandle } from '../core/TourEngine';
import { TourEngineContext, TourHostContext } from './context';
import { TourOverlay } from './TourOverlay';

let nextHostId = 0;

export interface TourOverlayHostProps {
  children?: React.ReactNode;
}

/**
 * Lets tours highlight elements inside an app popup (a React Native `Modal`, a
 * bottom sheet…). The tour's root overlay is drawn under the app's popups, so
 * wrap the popup's content in this: steps whose target is inside it are drawn
 * inside the popup instead, with the provider's card and colours.
 *
 * ```tsx
 * <Modal visible={visible} transparent>
 *   <TourOverlayHost>
 *     …popup content with TourTargets…
 *   </TourOverlayHost>
 * </Modal>
 * ```
 *
 * A shared popup component (e.g. your app's `AppModal`) can include it once for
 * every popup. Outside a `TourProvider` it just renders its children.
 */
export const TourOverlayHost: React.FC<TourOverlayHostProps> = ({ children }) => {
  const engine = useContext(TourEngineContext);
  const [host] = useState<HostHandle>(() => ({ id: `rn-smart-tour-host-${++nextHostId}` }));

  return (
    <TourHostContext.Provider value={host}>
      {children}
      {engine ? <TourOverlay hostId={host.id} /> : null}
    </TourHostContext.Provider>
  );
};
