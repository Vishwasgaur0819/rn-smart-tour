import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, Modal, TouchableOpacity, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent, ModalProps } from 'react-native';
import type { PresentedStep, TourEngineState } from '../core/TourEngine';
import type { TourTooltipProps } from '../types';
import { useTourEngine, useTourState } from './hooks';
import { placeTooltip } from './placement';

const DEFAULT_TOOLTIP_WIDTH = 280;
const DEFAULT_BACKDROP_COLOR = 'rgba(0, 0, 0, 0.6)';
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
}

const selectOverlay = (state: TourEngineState) => ({
  presented: state.presented,
  // False while the next step's target is still being measured (the previous step stays drawn).
  isSettled:
    !!state.presented &&
    state.presented.tourId === state.tourId &&
    state.presented.stepIndex === state.stepIndex,
});

export const TourOverlay = (props: TourOverlayProps) => {
  const { presented, isSettled } = useTourState(selectOverlay);
  return presented ? <OverlayContent {...props} presented={presented} isSettled={isSettled} /> : null;
};

const OverlayContent = ({
  presented,
  isSettled,
  renderTooltip,
  tooltipWidth = DEFAULT_TOOLTIP_WIDTH,
  backdropColor = DEFAULT_BACKDROP_COLOR,
  supportedOrientations = ALL_ORIENTATIONS,
}: TourOverlayProps & { presented: PresentedStep; isSettled: boolean }) => {
  const engine = useTourEngine();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Fades in when the overlay appears; moving between steps does not fade again.
  // Not using Modal's animationType: its fade-out would leave the old step drawn over
  // a screen that is already navigating away.
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }).start();
  }, [opacity]);

  const activeTour = engine.getTour(presented.tourId);
  const step = activeTour?.steps[presented.stepIndex];
  if (!activeTour || !step) return null;

  const { x, y, width, height } = presented.rect;
  const stepCount = activeTour.steps.length;
  const tooltipProps: TourTooltipProps = {
    tour: activeTour,
    step,
    stepIndex: presented.stepIndex,
    stepCount,
    isFirstStep: presented.stepIndex === 0,
    isLastStep: presented.stepIndex === stepCount - 1,
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

  return (
    // onRequestClose: the Android back button dismisses the tour, like "Skip".
    <Modal
      transparent
      visible
      animationType="none"
      supportedOrientations={supportedOrientations}
      onRequestClose={() => engine.stopTour()}>
      {/*
        Sized explicitly from the window rather than absoluteFill: on the New Architecture the
        Modal's content container does not reliably fill the screen, which hid the bottom
        backdrop and every tooltip positioned with `bottom` (position: 'top').
      */}
      <Animated.View style={[styles.fullscreen, { width: screenWidth, height: screenHeight, opacity }]}>
        {/* Top backdrop */}
        <View style={[backdrop, { top: 0, left: 0, right: 0, height: Math.max(0, y) }]} />
        {/* Bottom backdrop */}
        <View style={[backdrop, { top: y + height, left: 0, right: 0, bottom: 0 }]} />
        {/* Left backdrop */}
        <View style={[backdrop, { top: y, left: 0, width: Math.max(0, x), height }]} />
        {/* Right backdrop */}
        <View style={[backdrop, { top: y, left: x + width, right: 0, height }]} />

        {/* Remounted per step so each card is measured before it is shown. */}
        <TooltipPosition
          key={`${presented.tourId}:${presented.stepIndex}`}
          presented={presented}
          position={step.position}
          tooltipWidth={tooltipWidth}
          screenWidth={screenWidth}
          screenHeight={screenHeight}>
          {renderTooltip ? renderTooltip(tooltipProps) : <DefaultTooltip {...tooltipProps} />}
        </TooltipPosition>
      </Animated.View>
    </Modal>
  );
};

/** Places the card beside the target once its height is known (hidden until then). */
const TooltipPosition = ({
  presented,
  position,
  tooltipWidth,
  screenWidth,
  screenHeight,
  children,
}: {
  presented: PresentedStep;
  position: TourTooltipProps['step']['position'];
  tooltipWidth: number;
  screenWidth: number;
  screenHeight: number;
  children: React.ReactNode;
}) => {
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const placement = placeTooltip({
    rect: presented.rect,
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
  step,
  stepIndex,
  stepCount,
  isFirstStep,
  isLastStep,
  next,
  prev,
  skip,
}: TourTooltipProps) => (
  <View style={styles.card}>
    <Text style={styles.title}>{step.title}</Text>
    <Text style={styles.description}>{step.description}</Text>

    {/* Step indicator */}
    {stepCount > 1 && (
      <Text style={styles.stepIndicator}>
        {stepIndex + 1} / {stepCount}
      </Text>
    )}

    <View style={styles.actions}>
      {!isLastStep && (
        <TouchableOpacity onPress={skip} style={styles.actionBtn}>
          <Text style={styles.actionText}>Skip</Text>
        </TouchableOpacity>
      )}

      {!isFirstStep && (
        <TouchableOpacity onPress={prev} style={styles.actionBtn}>
          <Text style={styles.actionText}>Back</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={next} style={[styles.actionBtn, styles.primaryBtn]}>
        <Text style={[styles.actionText, styles.primaryText]}>{isLastStep ? 'Finish' : 'Next'}</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const styles = StyleSheet.create({
  fullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backdrop: {
    position: 'absolute',
  },
  tooltipPosition: {
    position: 'absolute',
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
