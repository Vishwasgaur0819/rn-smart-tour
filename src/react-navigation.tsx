/**
 * React Navigation integration: `import { NavigationTourScope } from 'rn-smart-tour/react-navigation'`.
 * Kept out of the main entry so apps without React Navigation don't need it installed.
 */
import React, { useEffect, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { TourScope } from './react/TourScope';

/**
 * In a stack, a screen that gains focus is ready once its push/pop animation reports
 * `transitionEnd`. The event can arrive well after focus (the native animation may
 * start late), so focus alone is not enough. If it never arrives, stop waiting after this.
 */
const STACK_TRANSITION_FALLBACK_MS = 1500;
/** A transition that starts but never reports its end (e.g. an interrupted swipe) is given up on after this. */
const TRANSITION_END_FALLBACK_MS = 1000;
/** Other navigators (tabs, drawer) report no transitions; allow e.g. a drawer to finish closing. */
const FOCUS_GRACE_MS = 300;

type NavigationWithEvents = {
  addListener: (event: string, callback: () => void) => () => void;
  getState?: () => { type?: string } | undefined;
};

export interface NavigationTourScopeProps {
  children?: React.ReactNode;
}

/**
 * A TourScope that is active only while its screen is focused and at rest.
 * Put it at the top of each screen with tour targets, so a screen kept mounted in
 * the background is never highlighted and targets are measured where they come to rest.
 */
export const NavigationTourScope: React.FC<NavigationTourScopeProps> = ({ children }) => {
  const navigation = useNavigation() as unknown as NavigationWithEvents;
  const isFocused = useIsFocused();
  const isInStack = navigation.getState?.()?.type === 'stack';
  const [isTransitioning, setTransitioning] = useState(false);
  /** Focused, and its transition has ended (or, outside a stack, the grace period has passed). */
  const [isSettled, setSettled] = useState(false);

  useEffect(() => {
    // Stack and native-stack navigators emit these; other navigators never do.
    const unsubscribeStart = navigation.addListener('transitionStart', () => setTransitioning(true));
    const unsubscribeEnd = navigation.addListener('transitionEnd', () => {
      setTransitioning(false);
      setSettled(true);
    });
    return () => {
      unsubscribeStart();
      unsubscribeEnd();
    };
  }, [navigation]);

  // Each time the screen gains focus, wait for it to come to rest.
  useEffect(() => {
    setSettled(false);
    if (!isFocused) return;
    const timer = setTimeout(
      () => {
        setTransitioning(false);
        setSettled(true);
      },
      isInStack ? STACK_TRANSITION_FALLBACK_MS : FOCUS_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [isFocused, isInStack]);

  // Separate from the listeners so re-subscribing mid-transition can't drop it.
  useEffect(() => {
    if (!isTransitioning) return;
    const fallback = setTimeout(() => {
      setTransitioning(false);
      setSettled(true);
    }, TRANSITION_END_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [isTransitioning]);

  return <TourScope active={isFocused && isSettled && !isTransitioning}>{children}</TourScope>;
};
