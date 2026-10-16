import { forwardRef, useCallback, useContext, useEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { DapContext } from './DapContext';

/**
 * A wrapper for the React Native ScrollView that integrates with the rn-smart-tour
 * Auto-Scroll engine. When used, the library can automatically scroll to bring
 * tour targets into the user's view. A `ref` is forwarded to the inner ScrollView.
 */
export const DapScrollView = forwardRef<ScrollView, ScrollViewProps>((props, forwardedRef) => {
  const context = useContext(DapContext);
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

  const registerScrollRef = context?._registerScrollRef;
  const unregisterScrollRef = context?._unregisterScrollRef;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !registerScrollRef) return;
    registerScrollRef(node);
    return () => {
      // Only clears the registration if another DapScrollView hasn't replaced it.
      unregisterScrollRef?.(node);
    };
  }, [registerScrollRef, unregisterScrollRef]);

  return <ScrollView {...props} ref={setRef} />;
});

DapScrollView.displayName = 'DapScrollView';
