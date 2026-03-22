export interface TargetMeasurement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TourStep {
  targetId: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface Tour {
  id: string;
  steps: TourStep[];
  autoStart?: boolean; // If true, starts automatically when first target is visible
}

export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
}

export interface DapContextType {
  registerTarget: (id: string, measurement: TargetMeasurement, ref?: any) => void;
  unregisterTarget: (id: string) => void;
  startTour: (tourId: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  stopTour: (markAsSeen?: boolean) => void;
  activeTour: Tour | null;
  currentStepIndex: number;
  targets: Record<string, TargetMeasurement>;
  seenTours: Record<string, boolean>;
  /** Requests the provider to scroll the active DapScrollView to a specific target. */
  requestScroll: (targetId: string) => void;
  /** Internal use only: registers a ScrollView's native ref for coordinate calculations. */
  _registerScrollRef: (ref: any) => void;
}
