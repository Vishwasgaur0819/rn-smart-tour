import { createContext } from 'react';
import type { ScopeHandle, ScrollableHandle, TourEngine } from '../core/TourEngine';

export const TourEngineContext = createContext<TourEngine | null>(null);

/** The nearest TourScope, if any. */
export const TourScopeContext = createContext<ScopeHandle | null>(null);

/** The nearest scroll container registered with TourScrollable / TourScrollView, if any. */
export const TourScrollableContext = createContext<ScrollableHandle | null>(null);
