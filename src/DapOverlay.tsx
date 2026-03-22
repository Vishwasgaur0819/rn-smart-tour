import React, { useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
  ViewStyle,
} from 'react-native';
import { DapContext } from './DapContext';

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

export const DapOverlay = () => {
  const context = useContext(DapContext);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  if (!context || !context.activeTour) return null;

  const { activeTour, currentStepIndex, targets, nextStep, prevStep, stopTour } = context;
  const currentStep = activeTour.steps[currentStepIndex];

  if (!currentStep) return null;

  const targetId = currentStep.targetId;
  const measurement = targets[targetId];

  // If the target hasn't been measured yet, silently wait — don't show debug text in production.
  if (!measurement) return null;

  const { x, y, width, height } = measurement;

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
      Math.min(
        x + width / 2 - TOOLTIP_WIDTH / 2,
        screenWidth - TOOLTIP_WIDTH - EDGE_PADDING,
      ),
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
    <Modal transparent visible animationType="fade">
      <View style={styles.fullscreen}>
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
            <TouchableOpacity onPress={() => stopTour()} style={styles.actionBtn}>
              <Text style={styles.actionText}>Skip</Text>
            </TouchableOpacity>

            {!isFirstStep && (
              <TouchableOpacity onPress={prevStep} style={styles.actionBtn}>
                <Text style={styles.actionText}>Back</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={nextStep} style={[styles.actionBtn, styles.primaryBtn]}>
              <Text style={[styles.actionText, styles.primaryText]}>
                {isLastStep ? 'Finish' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fullscreen: {
    ...StyleSheet.absoluteFillObject,
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
