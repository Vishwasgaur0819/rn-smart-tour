import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent, ModalProps } from 'react-native';
import type { PresentedStep, TourEngineState } from '../core/TourEngine';
import type { Tour, TourTooltipProps } from '../types';
import { useTourEngine, useTourState } from './hooks';
import { placeTooltip } from './placement';

const DEFAULT_TOOLTIP_WIDTH = 280;
const DEFAULT_BACKDROP_COLOR = 'rgba(0, 0, 0, 0.6)';
const DEFAULT_HIGHLIGHT_COLOR = '#FFFFFF';
/** Gap (pts) between an element the user should tap and the ring drawn around it. */
const ACTION_RING_INSET = 3;
/**
 * Every orientation, so the overlay never conflicts with the app's own. iOS still
 * limits a Modal to the orientations in Info.plist; React Native's default
 * (['portrait']) made iOS throw in landscape-only apps.
 */
const ALL_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];
/** Fade-in duration (ms) when the overlay appears. Hiding is instant. */
const FADE_IN_MS = 200;

export interface TourOverlayProps {
  /**
   * Renders the tooltip card, replacing the built-in one, e.g. with your design
   * system's components and theme. The card is placed next to the target for you.
   */
  renderTooltip?: (props: TourTooltipProps) => React.ReactNode;
  /** Width of the tooltip card (it is never wider than the screen allows). Default: 280. */
  tooltipWidth?: number;
  /** Color of the dimmed area around the target. Default: 'rgba(0, 0, 0, 0.6)'. */
  backdropColor?: string;
  /**
   * iOS orientations the overlay's Modal allows. Default: all of them (iOS then
   * limits it to the app's Info.plist). Pass your app's own list to match its modals.
   */
  supportedOrientations?: ModalProps['supportedOrientations'];
  /**
   * - `'root'` (default): drawn as a layer over the app, next to `TourProvider`'s
   *   children. The app's own modals and popups open above it and never conflict
   *   with it. `TourProvider` must wrap the whole app (as it normally does).
   * - `'modal'`: drawn in a React Native `Modal`. Only needed if a tour points at
   *   elements inside another Modal. On iOS only one modal can be presented at a
   *   time, so it can't show while another one is open, and vice versa.
   */
  presentation?: 'root' | 'modal';
  /** Renders the "Resume" chip shown while a tour is paused, replacing the built-in one. */
  renderResumeChip?: (props: ResumeChipProps) => React.ReactNode;
  /** Color of the ring around an element the user should tap (`advanceOn: 'press'`). Default: white. */
  highlightColor?: string;
}

/** What a custom resume chip (`renderResumeChip`) receives. */
export interface ResumeChipProps {
  tour: Tour;
  /** Continue the tour. */
  resume: () => void;
  /** End it (not marked as seen). */
  dismiss: () => void;
}

const selectOverlay = (state: TourEngineState) => ({
  presented: state.presented,
  pausedTourId: state.paused ? state.tourId : null,
  // False while the next step's target is still being measured (the previous step stays drawn).
  isSettled:
    !!state.presented &&
    state.presented.tourId === state.tourId &&
    state.presented.stepIndex === state.stepIndex,
});

export const TourOverlay = (props: TourOverlayProps) => {
  const { presented, isSettled, pausedTourId } = useTourState(selectOverlay);
  if (pausedTourId) return <ResumeChipHost tourId={pausedTourId} renderResumeChip={props.renderResumeChip} />;
  return presented ? <OverlayContent {...props} presented={presented} isSettled={isSettled} /> : null;
};

/** Shown while a tour is paused: lets the user pick it up again, or drop it. */
const ResumeChipHost = ({
  tourId,
  renderResumeChip,
}: {
  tourId: string;
  renderResumeChip: TourOverlayProps['renderResumeChip'];
}) => {
  const engine = useTourEngine();
  const tour = engine.getTour(tourId);
  if (!tour) return null;
  const chipProps: ResumeChipProps = {
    tour,
    resume: engine.resumeTour,
    dismiss: () => engine.stopTour(false),
  };
  return (
    <View pointerEvents="box-none" style={styles.chipHost} testID="rn-smart-tour-resume-chip">
      {renderResumeChip ? renderResumeChip(chipProps) : <DefaultResumeChip {...chipProps} />}
    </View>
  );
};

const OverlayContent = ({
  presented,
  isSettled,
  renderTooltip,
  tooltipWidth = DEFAULT_TOOLTIP_WIDTH,
  backdropColor = DEFAULT_BACKDROP_COLOR,
  supportedOrientations = ALL_ORIENTATIONS,
  presentation = 'root',
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
}: TourOverlayProps & { presented: PresentedStep; isSettled: boolean }) => {
  const engine = useTourEngine();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isRoot = presentation === 'root';

  // Target rects are window-relative. A Modal starts at the window's origin; the root
  // layer measures where it starts (normally also the origin) and draws relative to that.
  const layerRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(isRoot ? null : { x: 0, y: 0 });
  const measureOrigin = useCallback(() => {
    layerRef.current?.measureInWindow((x, y) => {
      setOrigin(previous => (previous && previous.x === x && previous.y === y ? previous : { x, y }));
    });
  }, []);

  // Fades in once positioned; moving between steps does not fade again.
  // Not using Modal's animationType: its fade-out would leave the old step drawn over
  // a screen that is already navigating away.
  const opacity = useRef(new Animated.Value(0)).current;
  const isPositioned = origin !== null;
  useEffect(() => {
    if (!isPositioned) return;
    Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
  }, [opacity, isPositioned]);

  // The root layer has no Modal onRequestClose: the Android back button dismisses the tour, like "Skip".
  useEffect(() => {
    if (!isRoot) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      engine.stopTour();
      return true;
    });
    return () => subscription.remove();
  }, [engine, isRoot]);

  const activeTour = engine.getTour(presented.tourId);
  const step = activeTour?.steps[presented.stepIndex];
  if (!activeTour || !step) return null;

  // Position among the shown steps (steps whose `when` is false don't count).
  const shownSteps = engine.getShownStepIndexes(presented.tourId);
  const shownIndex = Math.max(0, shownSteps.indexOf(presented.stepIndex));
  const stepCount = shownSteps.length || activeTour.steps.length;

  // An action step lets taps through to its target. Not possible from inside a
  // Modal (it covers the app), so there it falls back to a Next button.
  const advanceOn = step.advanceOn ?? 'next';
  const tapsThrough = isRoot && advanceOn === 'press' && !!presented.rect;
  const isActionStep = tapsThrough || typeof advanceOn === 'object';

  const tooltipProps: TourTooltipProps = {
    tour: activeTour,
    step,
    stepIndex: shownIndex,
    stepCount,
    isFirstStep: shownIndex === 0,
    isLastStep: shownIndex === stepCount - 1,
    isActionStep,
    isCentered: !presented.rect,
    // Ignore taps while moving between steps, so one tap never advances twice.
    next: () => {
      if (isSettled) engine.nextStep();
    },
    prev: () => {
      if (isSettled) engine.prevStep();
    },
    skip: () => engine.stopTour(),
  };

  const backdrop = [styles.backdrop, { backgroundColor: backdropColor }];
  const rect = presented.rect && {
    x: presented.rect.x - (origin?.x ?? 0),
    y: presented.rect.y - (origin?.y ?? 0),
    width: presented.rect.width,
    height: presented.rect.height,
  };

  const layer = (
    // Sized explicitly from the window rather than absoluteFill: on the New Architecture a
    // Modal's content container does not reliably fill the screen, which hid the bottom
    // backdrop and every tooltip positioned with `bottom` (position: 'top').
    // box-none: only the backdrop pieces and the card take touches, so the cutout can
    // let them through to the app.
    <Animated.View
      ref={layerRef}
      testID="rn-smart-tour-overlay"
      onLayout={isRoot ? measureOrigin : undefined}
      accessibilityViewIsModal
      pointerEvents="box-none"
      style={[
        styles.fullscreen,
        isRoot && styles.rootLayer,
        { width: screenWidth, height: screenHeight, opacity },
      ]}>
      {rect ? (
        <>
          {/* Top backdrop */}
          <View style={[backdrop, { top: 0, left: 0, right: 0, height: Math.max(0, rect.y) }]} />
          {/* Bottom backdrop */}
          <View style={[backdrop, { top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }]} />
          {/* Left backdrop */}
          <View
            style={[backdrop, { top: rect.y, left: 0, width: Math.max(0, rect.x), height: rect.height }]}
          />
          {/* Right backdrop */}
          <View
            style={[backdrop, { top: rect.y, left: rect.x + rect.width, right: 0, height: rect.height }]}
          />

          {tapsThrough ? (
            // The target stays tappable; a ring shows the user where to tap.
            <View
              pointerEvents="none"
              testID="rn-smart-tour-action-ring"
              style={[
                styles.actionRing,
                {
                  borderColor: highlightColor,
                  top: rect.y - ACTION_RING_INSET,
                  left: rect.x - ACTION_RING_INSET,
                  width: rect.width + ACTION_RING_INSET * 2,
                  height: rect.height + ACTION_RING_INSET * 2,
                },
              ]}
            />
          ) : (
            // Blocks taps on the highlighted element: the card's buttons move the tour.
            <View
              testID="rn-smart-tour-cutout-blocker"
              style={[
                styles.cutoutBlocker,
                { top: rect.y, left: rect.x, width: rect.width, height: rect.height },
              ]}
            />
          )}
        </>
      ) : (
        // A centred step: dim the whole screen.
        <View style={[backdrop, { top: 0, left: 0, right: 0, bottom: 0 }]} />
      )}

      {/* Remounted per step so each card is measured before it is shown. */}
      <TooltipPosition
        key={`${presented.tourId}:${presented.stepIndex}`}
        rect={rect}
        position={step.position}
        tooltipWidth={tooltipWidth}
        screenWidth={screenWidth}
        screenHeight={screenHeight}>
        {renderTooltip ? renderTooltip(tooltipProps) : <DefaultTooltip {...tooltipProps} />}
      </TooltipPosition>
    </Animated.View>
  );

  if (isRoot) return layer;

  return (
    // onRequestClose: the Android back button dismisses the tour, like "Skip".
    <Modal
      transparent
      visible
      animationType="none"
      supportedOrientations={supportedOrientations}
      onRequestClose={() => engine.stopTour()}>
      {layer}
    </Modal>
  );
};

/** Places the card beside the target once its height is known (hidden until then). */
const TooltipPosition = ({
  rect,
  position,
  tooltipWidth,
  screenWidth,
  screenHeight,
  children,
}: {
  rect: PresentedStep['rect'];
  position: TourTooltipProps['step']['position'];
  tooltipWidth: number;
  screenWidth: number;
  screenHeight: number;
  children: React.ReactNode;
}) => {
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const placement = placeTooltip({
    rect,
    cardHeight: cardHeight ?? 0,
    screenWidth,
    screenHeight,
    position,
    width: tooltipWidth,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.height;
    setCardHeight(previous => (previous !== null && Math.abs(previous - measured) < 1 ? previous : measured));
  };

  return (
    <View
      testID="rn-smart-tour-tooltip"
      onLayout={onLayout}
      style={[styles.tooltipPosition, placement, { opacity: cardHeight === null ? 0 : 1 }]}>
      {children}
    </View>
  );
};

/** The built-in card. Pass `renderTooltip` to replace it. */
export const DefaultTooltip = ({
  tour,
  step,
  stepIndex,
  stepCount,
  isFirstStep,
  isLastStep,
  isActionStep,
  next,
  prev,
  skip,
}: TourTooltipProps) => (
  <View style={styles.card}>
    <Text style={styles.title}>{step.title}</Text>
    <Text style={styles.description}>{step.description}</Text>
    {step.advanceOn === 'press' && isActionStep ? (
      <Text style={styles.actionHint}>Tap the highlighted item to continue.</Text>
    ) : null}

    {/* Step indicator */}
    {stepCount > 1 && (
      <Text style={styles.stepIndicator}>
        {stepIndex + 1} / {stepCount}
      </Text>
    )}

    <View style={styles.actions}>
      {(!isLastStep || isActionStep) && (
        <TouchableOpacity onPress={skip} style={styles.actionBtn}>
          <Text style={styles.actionText}>{tour.kind === 'walkthrough' ? 'Exit' : 'Skip'}</Text>
        </TouchableOpacity>
      )}

      {!isFirstStep && (
        <TouchableOpacity onPress={prev} style={styles.actionBtn}>
          <Text style={styles.actionText}>Back</Text>
        </TouchableOpacity>
      )}

      {/* An action step moves on when the user does the action, not with a button. */}
      {!isActionStep && (
        <TouchableOpacity onPress={next} style={[styles.actionBtn, styles.primaryBtn]}>
          <Text style={[styles.actionText, styles.primaryText]}>{isLastStep ? 'Finish' : 'Next'}</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
);

/** The built-in resume chip. Pass `renderResumeChip` to replace it. */
export const DefaultResumeChip = ({ tour, resume, dismiss }: ResumeChipProps) => (
  <View style={styles.chip}>
    <TouchableOpacity onPress={resume} accessibilityRole="button" style={styles.chipResume}>
      <Text style={styles.chipText} numberOfLines={1}>
        Resume: {tour.title ?? 'tour'}
      </Text>
    </TouchableOpacity>
    <TouchableOpacity
      onPress={dismiss}
      accessibilityRole="button"
      accessibilityLabel="Dismiss"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.chipDismiss}>
      <Text style={styles.chipText}>✕</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  fullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  rootLayer: {
    // Above the app's other root-level views (and their Android elevation).
    zIndex: 10000,
    elevation: 10000,
  },
  backdrop: {
    position: 'absolute',
  },
  tooltipPosition: {
    position: 'absolute',
  },
  cutoutBlocker: {
    position: 'absolute',
  },
  actionRing: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 6,
  },
  actionHint: {
    fontSize: 13,
    color: '#007AFF',
    marginBottom: 8,
  },
  chipHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 32,
    alignItems: 'center',
    zIndex: 10000,
    elevation: 10000,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2933',
    borderRadius: 999,
    paddingLeft: 16,
    paddingRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  chipResume: {
    paddingVertical: 10,
  },
  chipDismiss: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  chipText: {
    color: 'white',
    fontWeight: '600',
  },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  stepIndicator: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  actionBtn: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    marginLeft: 10,
    borderRadius: 4,
  },
  primaryBtn: {
    backgroundColor: '#007AFF',
  },
  actionText: {
    color: '#666',
    fontWeight: '600',
  },
  primaryText: {
    color: 'white',
    fontWeight: '600',
  },
});
