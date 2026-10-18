import React, { forwardRef, useCallback, useMemo, useRef } from 'react';
import { ScrollView } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import type { ScrollableHandle } from '../core/TourEngine';
import { TourScrollableContext } from './context';

export interface TourScrollableProps {
  /** Ref to the scroll container: a ScrollView, FlatList or SectionList. */
  scrollRef: React.RefObject<any>;
  /** Set for a horizontal list. */
  horizontal?: boolean;
  children?: React.ReactNode;
}

/**
 * Lets tours scroll targets inside a scroll container into view. Wrap the list
 * (its items are descendants, so they find it):
 *
 * ```tsx
 * const listRef = useRef<FlatList>(null);
 * <TourScrollable scrollRef={listRef}>
 *   <FlatList ref={listRef} … />
 * </TourScrollable>
 * ```
 */
export const TourScrollable: React.FC<TourScrollableProps> = ({
  scrollRef,
  horizontal = false,
  children,
}) => {
  const handle = useMemo<ScrollableHandle>(() => ({ ref: scrollRef, horizontal }), [scrollRef, horizontal]);
  return <TourScrollableContext.Provider value={handle}>{children}</TourScrollableContext.Provider>;
};

/** A ScrollView that tours can scroll. A `ref` is forwarded to the inner ScrollView. */
export const TourScrollView = forwardRef<ScrollView, ScrollViewProps>((props, forwardedRef) => {
  const scrollRef = useRef<ScrollView | null>(null);

  const setRef = useCallback(
    (node: ScrollView | null) => {
      scrollRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef],
  );

  return (
    <TourScrollable scrollRef={scrollRef} horizontal={!!props.horizontal}>
      <ScrollView {...props} ref={setRef} />
    </TourScrollable>
  );
});

TourScrollView.displayName = 'TourScrollView';
