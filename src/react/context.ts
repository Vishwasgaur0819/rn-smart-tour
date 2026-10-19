import { createContext } from 'react';
import type { HostHandle, ScopeHandle, ScrollableHandle, TourEngine } from '../core/TourEngine';
import type { TourOverlayProps } from './TourOverlay';

export const TourEngineContext = createContext<TourEngine | null>(null);

/** The nearest TourScope, if any. */
export const TourScopeContext = createContext<ScopeHandle | null>(null);

/** The nearest scroll container registered with TourScrollable / TourScrollView, if any. */
export const TourScrollableContext = createContext<ScrollableHandle | null>(null);

/** The nearest TourOverlayHost (e.g. inside an app popup), if any. */
export const TourHostContext = createContext<HostHandle | null>(null);

/** The provider's overlay settings (card, colours…), shared with TourOverlayHosts. */
export const TourOverlayConfigContext = createContext<TourOverlayProps>({});
