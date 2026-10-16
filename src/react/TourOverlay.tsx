import { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet, Modal, TouchableOpacity, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { PresentedStep, TourEngineState } from '../core/TourEngine';
import { useTourEngine, useTourState } from './hooks';

/** Gap (pts) between the target highlight and the tooltip card. */
const TOOLTIP_GAP = 10;
/** Max width of the tooltip card. */
const TOOLTIP_WIDTH = 280;
/** General padding from screen edges. */
const EDGE_PADDING = 16;
/** Rough estimated tooltip height — used for bottom-overflow checks. */
const ESTIMATED_TOOLTIP_HEIGHT = 150;
/** Rough vertical offset for left/right centering. */
const VERTICAL_CENTER_OFFSET = 60;
/** Min screen space reserved at the bottom when centering vertically. */
const VERTICAL_SAFE_BOTTOM = 120;

const selectOverlay = (state: TourEngineState) => ({
  presented: state.presented,
  // False while the next step's target is still being measured (the previous step stays drawn).
  isSettled:
    !!state.presented &&
    state.presented.tourId === state.tourId &&
    state.presented.stepIndex === state.stepIndex,
});

/** Fade-in duration (ms) when the overlay appears. Hiding is instant. */
const FADE_IN_MS = 200;

export const TourOverlay = () => {
  const { presented, isSettled } = useTourState(selectOverlay);
  return presented ? <OverlayContent presented={presented} isSettled={isSettled} /> : null;
};

const OverlayContent = ({ presented, isSettled }: { presented: PresentedStep; isSettled: boolean }) => {
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
  const currentStepIndex = presented.stepIndex;
  const currentStep = activeTour?.steps[currentStepIndex];
  if (!activeTour || !currentStep) return null;

  // Ignore taps while moving between steps, so one tap never advances twice.
  const nextStep = () => isSettled && engine.nextStep();
  const prevStep = () => isSettled && engine.prevStep();
  const stopTour = () => engine.stopTour();

  const { x, y, width, height } = presented.rect;

  const pos = currentStep.position || 'bottom';

  const tooltipStyle: ViewStyle = {
    position: 'absolute',
    width: TOOLTIP_WIDTH,
    backgroundColor: 'white',
    padding: EDGE_PADDING,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    // Horizontal centering by default
    left: Math.max(
      EDGE_PADDING,
      Math.min(x + width / 2 - TOOLTIP_WIDTH / 2, screenWidth - TOOLTIP_WIDTH - EDGE_PADDING),
    ),
  };

  if (pos === 'top') {
    tooltipStyle.bottom = screenHeight - y + TOOLTIP_GAP;
  } else if (pos === 'left') {
    tooltipStyle.right = screenWidth - x + TOOLTIP_GAP;
    tooltipStyle.left = undefined; // Clear the default left
    tooltipStyle.width = Math.min(TOOLTIP_WIDTH, x - EDGE_PADDING * 2);
    tooltipStyle.top = Math.max(
      EDGE_PADDING,
      Math.min(y + height / 2 - VERTICAL_CENTER_OFFSET, screenHeight - VERTICAL_SAFE_BOTTOM),
    );
  } else if (pos === 'right') {
    tooltipStyle.left = x + width + TOOLTIP_GAP;
    tooltipStyle.width = Math.min(TOOLTIP_WIDTH, screenWidth - (x + width) - EDGE_PADDING * 2);
    tooltipStyle.top = Math.max(
      EDGE_PADDING,
      Math.min(y + height / 2 - VERTICAL_CENTER_OFFSET, screenHeight - VERTICAL_SAFE_BOTTOM),
    );
  } else {
    // bottom (default)
    tooltipStyle.top = y + height + TOOLTIP_GAP;
    // Check if it spills off bottom of screen
    if ((tooltipStyle.top as number) + ESTIMATED_TOOLTIP_HEIGHT > screenHeight) {
      tooltipStyle.top = undefined;
      tooltipStyle.bottom = EDGE_PADDING; // Pin to bottom if it overflows
    }
  }

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === activeTour.steps.length - 1;

  return (
    // onRequestClose: the Android back button dismisses the tour, like "Skip".
    <Modal transparent visible animationType="none" onRequestClose={() => stopTour()}>
      {/*
        Sized explicitly from the window rather than absoluteFill: on the New Architecture the
        Modal's content container does not reliably fill the screen, which hid the bottom
        backdrop and every tooltip positioned with `bottom` (position: 'top').
      */}
      <Animated.View style={[styles.fullscreen, { width: screenWidth, height: screenHeight, opacity }]}>
        {/* Top backdrop */}
        <View style={[styles.backdrop, { top: 0, left: 0, right: 0, height: Math.max(0, y) }]} />
        {/* Bottom backdrop */}
        <View style={[styles.backdrop, { top: y + height, left: 0, right: 0, bottom: 0 }]} />
        {/* Left backdrop */}
        <View style={[styles.backdrop, { top: y, left: 0, width: Math.max(0, x), height }]} />
        {/* Right backdrop */}
        <View style={[styles.backdrop, { top: y, left: x + width, right: 0, height }]} />

        {/* The Tooltip Card */}
        <View style={tooltipStyle}>
          <Text style={styles.title}>{currentStep.title}</Text>
          <Text style={styles.description}>{currentStep.description}</Text>

          {/* Step indicator */}
          {activeTour.steps.length > 1 && (
            <Text style={styles.stepIndicator}>
              {currentStepIndex + 1} / {activeTour.steps.length}
            </Text>
          )}

          <View style={styles.actions}>
            {!isLastStep && (
              <TouchableOpacity onPress={() => stopTour()} style={styles.actionBtn}>
                <Text style={styles.actionText}>Skip</Text>
              </TouchableOpacity>
            )}

            {!isFirstStep && (
              <TouchableOpacity onPress={prevStep} style={styles.actionBtn}>
                <Text style={styles.actionText}>Back</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={nextStep} style={[styles.actionBtn, styles.primaryBtn]}>
              <Text style={[styles.actionText, styles.primaryText]}>{isLastStep ? 'Finish' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backdrop: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
