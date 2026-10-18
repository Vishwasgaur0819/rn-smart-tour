import React, { useContext, useEffect, useState } from 'react';
import type { ScopeHandle } from '../core/TourEngine';
import { TourEngineContext, TourScopeContext } from './context';

export interface TourScopeProps {
  /**
   * Whether targets inside this scope can be used by tours. Set it to false while
   * the area is not visible, e.g. a screen that is not focused or is still animating in.
   * Default: true.
   */
  active?: boolean;
  children?: React.ReactNode;
}

/**
 * Groups targets that belong to one screen or area. Targets in an inactive scope
 * (or inside an inactive parent scope) are ignored, so a screen kept mounted in
 * the background never gets highlighted.
 */
export const TourScope: React.FC<TourScopeProps> = ({ active = true, children }) => {
  const engine = useContext(TourEngineContext);
  const parent = useContext(TourScopeContext);
  const [scope] = useState<ScopeHandle>(() => ({ ready: active, parent }));
  scope.parent = parent;

  useEffect(() => {
    if (scope.ready === active) return;
    scope.ready = active;
    engine?.notifyScopeChanged();
  }, [engine, scope, active]);

  return <TourScopeContext.Provider value={scope}>{children}</TourScopeContext.Provider>;
};
